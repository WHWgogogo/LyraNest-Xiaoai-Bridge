import { mkdir, readdir, stat, unlink, utimes } from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "./logger.js";

export interface MediaRelayOptions {
  dataDir: string;
  port?: number;
  maxFiles?: number;
  maxBytes?: number;
}

export interface RangeInfo {
  start: number;
  end: number;
}

export class MediaRelay {
  private cacheDir: string;
  private port: number;
  private maxFiles: number;
  private maxBytes: number;
  private inFlight = new Map<string, Promise<string>>();
  private authorizedTokens = new Map<string, number>();

  constructor(options: MediaRelayOptions) {
    this.cacheDir = join(options.dataDir, "cache", "transcode");
    this.port = options.port ?? 8090;
    this.maxFiles = options.maxFiles ?? 50;
    this.maxBytes = options.maxBytes ?? 250 * 1024 * 1024; // 250MB
  }

  getCacheDir(): string {
    return this.cacheDir;
  }

  trackIdToFilename(trackId: string): string {
    const hex = Buffer.from(trackId, "utf8").toString("hex");
    return `${hex}.mp3`;
  }

  getFilePath(trackId: string): string {
    return join(this.cacheDir, this.trackIdToFilename(trackId));
  }

  registerToken(token: string, expiresAt: number): void {
    if (!token || typeof token !== "string") return;
    this.authorizedTokens.set(token.trim(), expiresAt);
  }

  isTokenValid(candidate?: string): boolean {
    if (!candidate || typeof candidate !== "string") return false;
    const token = candidate.trim();
    const expiresAt = this.authorizedTokens.get(token);
    if (!expiresAt) return false;
    if (expiresAt < Date.now()) {
      this.authorizedTokens.delete(token);
      return false;
    }
    return true;
  }

  cleanExpiredTokens(): void {
    const now = Date.now();
    for (const [token, exp] of this.authorizedTokens.entries()) {
      if (exp < now) {
        this.authorizedTokens.delete(token);
      }
    }
  }

  buildRelayUrl(bridgeBaseUrl: string, trackId: string, mediaToken?: string): string {
    const base = (bridgeBaseUrl || "").replace(/\/+$/, "");
    let url = `${base}/stream/${encodeURIComponent(trackId)}`;
    if (mediaToken) {
      url += `?token=${encodeURIComponent(mediaToken)}`;
    }
    return url;
  }

  async ensureCached(
    lyranestBaseUrl: string,
    trackId: string,
    mediaToken: string,
  ): Promise<string> {
    const filePath = this.getFilePath(trackId);

    // If cache already exists and is non-empty, touch and return
    if (existsSync(filePath)) {
      try {
        const st = statSync(filePath);
        if (st.size > 0) {
          const now = new Date();
          await utimes(filePath, now, now).catch(() => undefined);
          return filePath;
        }
      } catch {
        // stat failed, re-download
      }
    }

    // Single-flight lock: coalesce concurrent requests for the same track
    const existing = this.inFlight.get(trackId);
    if (existing) {
      return await existing;
    }

    const downloadPromise = this.downloadAndCache(lyranestBaseUrl, trackId, mediaToken, filePath);
    this.inFlight.set(trackId, downloadPromise);

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.inFlight.delete(trackId);
    }
  }

  private async downloadAndCache(
    lyranestBaseUrl: string,
    trackId: string,
    mediaToken: string,
    targetPath: string,
  ): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true });

    const tmpPath = join(this.cacheDir, `${this.trackIdToFilename(trackId)}.${Date.now()}.tmp`);
    const baseUrl = lyranestBaseUrl.replace(/\/+$/, "");
    const transcodeUrl = `${baseUrl}/api/v1/tracks/${encodeURIComponent(trackId)}/stream?access_token=${encodeURIComponent(mediaToken)}&transcode=mp3`;

    logger.info("media-relay", `开始向 LyraNest 服务端请求 MP3 转码流并缓存至本地...`, {
      track_id: trackId,
      transcode_url: transcodeUrl.replace(/access_token=[^&]+/, "access_token=***"),
      tmp_path: tmpPath,
    });

    const startTime = Date.now();
    try {
      const response = await fetch(transcodeUrl);
      if (!response.ok) {
        throw new Error(`LyraNest 服务端转码流响应失败 (HTTP ${response.status})`);
      }
      if (!response.body) {
        throw new Error("LyraNest 服务端转码流响应体为空");
      }

      const fileStream = createWriteStream(tmpPath);
      const webStream = response.body as unknown as Parameters<typeof Readable.fromWeb>[0];
      await pipeline(Readable.fromWeb(webStream), fileStream);

      const st = await stat(tmpPath);
      if (st.size === 0) {
        await unlink(tmpPath).catch(() => undefined);
        throw new Error("转码流缓存落盘文件大小为 0 字节");
      }

      // Rename tmp to final file
      await utimes(tmpPath, new Date(), new Date()).catch(() => undefined);
      const { rename } = await import("node:fs/promises");
      await rename(tmpPath, targetPath);

      const elapsedMs = Date.now() - startTime;
      logger.info("media-relay", `MP3 转码流缓存完成并成功落盘: 大小 ${(st.size / 1024 / 1024).toFixed(2)} MB, 耗时 ${elapsedMs} ms`, {
        track_id: trackId,
        size_bytes: st.size,
        file_path: targetPath,
        elapsed_ms: elapsedMs,
      });

      // Trigger LRU eviction asynchronously
      void this.pruneCache().catch((err) => {
        logger.warn("media-relay", `清理 LRU 缓存失败: ${err instanceof Error ? err.message : String(err)}`);
      });

      return targetPath;
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      logger.error("media-relay", `拉取或缓存转码音频失败: ${err instanceof Error ? err.message : String(err)}`, {
        track_id: trackId,
      });
      throw err;
    }
  }

  async pruneCache(): Promise<void> {
    if (!existsSync(this.cacheDir)) return;
    const entries = await readdir(this.cacheDir);
    const files: Array<{ name: string; path: string; size: number; mtime: number }> = [];

    for (const name of entries) {
      if (!name.endsWith(".mp3")) continue;
      const fullPath = join(this.cacheDir, name);
      try {
        const s = await stat(fullPath);
        if (s.isFile()) {
          files.push({ name, path: fullPath, size: s.size, mtime: s.mtimeMs });
        }
      } catch {
        // ignore
      }
    }

    let totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    if (files.length <= this.maxFiles && totalBytes <= this.maxBytes) {
      return;
    }

    // Sort by mtime ascending (oldest first)
    files.sort((a, b) => a.mtime - b.mtime);

    for (const f of files) {
      if (files.length <= this.maxFiles * 0.8 && totalBytes <= this.maxBytes * 0.8) {
        break;
      }
      try {
        await unlink(f.path);
        totalBytes -= f.size;
        logger.info("media-relay", `LRU 淘汰旧转码缓存: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch {
        // ignore
      }
    }
  }

  parseRange(rangeHeader: string | undefined, totalSize: number): RangeInfo | "invalid" | null {
    if (!rangeHeader || !rangeHeader.trim()) return null;
    const trimmed = rangeHeader.trim();
    if (!trimmed.startsWith("bytes=")) return null;

    const raw = trimmed.slice("bytes=".length).trim();
    // Only single range supported
    if (raw.includes(",")) {
      return null;
    }

    const parts = raw.split("-");
    if (parts.length !== 2) return "invalid";

    const startStr = parts[0].trim();
    const endStr = parts[1].trim();

    if (startStr === "" && endStr === "") return "invalid";

    if (startStr === "") {
      // Suffix range: bytes=-500
      const suffix = parseInt(endStr, 10);
      if (Number.isNaN(suffix) || suffix <= 0) return "invalid";
      const start = Math.max(0, totalSize - suffix);
      const end = totalSize - 1;
      return { start, end };
    }

    const start = parseInt(startStr, 10);
    if (Number.isNaN(start) || start < 0 || start >= totalSize) {
      return "invalid";
    }

    let end = totalSize - 1;
    if (endStr !== "") {
      const parsedEnd = parseInt(endStr, 10);
      if (Number.isNaN(parsedEnd) || parsedEnd < start) {
        return "invalid";
      }
      end = Math.min(parsedEnd, totalSize - 1);
    }

    return { start, end };
  }

  async serveAudioFileWithRange(
    req: IncomingMessage,
    res: ServerResponse,
    filePath: string,
  ): Promise<void> {
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "audio file not found" }));
      return;
    }

    const s = await stat(filePath);
    const totalSize = s.size;
    const isHead = req.method === "HEAD";
    const rangeHeader = req.headers.range;

    const baseHeaders: Record<string, string | number> = {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-cache",
      "Connection": "keep-alive",
    };

    if (!rangeHeader) {
      // 200 OK
      res.writeHead(200, {
        ...baseHeaders,
        "Content-Length": totalSize,
      });
      if (isHead) {
        res.end();
        return;
      }
      const stream = createReadStream(filePath);
      stream.pipe(res);
      return;
    }

    const range = this.parseRange(rangeHeader, totalSize);

    if (range === "invalid") {
      // 416 Range Not Satisfiable
      res.writeHead(416, {
        "Content-Range": `bytes */${totalSize}`,
        "Content-Type": "text/plain",
      });
      res.end("416 Requested Range Not Satisfiable");
      return;
    }

    if (!range) {
      // Fallback 200 OK
      res.writeHead(200, {
        ...baseHeaders,
        "Content-Length": totalSize,
      });
      if (isHead) {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
      return;
    }

    // 206 Partial Content
    const contentLength = range.end - range.start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
      "Content-Length": contentLength,
    });

    if (isHead) {
      res.end();
      return;
    }

    const stream = createReadStream(filePath, { start: range.start, end: range.end });
    stream.pipe(res);
  }
}
