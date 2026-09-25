import type { XiaomiTokens, DevicePlayStatus } from "../types.js";

const MINA_API = "https://api2.mina.mi.com";
const USERPROFILE_API = "https://userprofile.mina.mi.com";
const MINA_USER_AGENT =
  "MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103";

interface UbusResponse {
  code?: number;
  message?: string;
  data?: unknown;
}

export class MinaAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinaAuthenticationError";
  }
}

export class MinaClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinaClientError";
  }
}

export class MinaClient {
  private tokens: XiaomiTokens;

  constructor(tokens: XiaomiTokens, private readonly fetchImpl: typeof fetch = fetch) {
    this.tokens = tokens;
  }

  updateTokens(tokens: XiaomiTokens): void {
    this.tokens = tokens;
  }

  private headers(deviceId?: string): Record<string, string> {
    const cookies: string[] = [];
    if (deviceId) {
      cookies.push(`deviceId=${deviceId}`);
    }
    cookies.push(`userId=${this.tokens.user_id}`);
    cookies.push(`serviceToken=${this.tokens.service_token}`);

    return {
      Cookie: cookies.join("; "),
      Accept: "application/json",
      "User-Agent": MINA_USER_AGENT,
    };
  }

  private async get<T>(path: string): Promise<T> {
    try {
      const target = new URL(`${MINA_API}${path}`);
      target.searchParams.set("requestId", requestId());
      const response = await this.fetchImpl(target, { headers: this.headers() });
      return await readMinaResponse<T>(response, "MiNA request");
    } catch (error) {
      if (error instanceof MinaAuthenticationError || error instanceof MinaClientError) throw error;
      throw new MinaClientError(`MiNA network request failed: ${errorMessage(error)}`);
    }
  }

  async getDevices(): Promise<Array<{ deviceID: string; name: string; hardware: string; miotDID: string }>> {
    const result = await this.get<{
      code?: number;
      message?: string;
      data?: Array<{ deviceID: string; name: string; alias: string; hardware: string; miotDID?: string; miot_did?: string }>;
    }>("/admin/v2/device_list?master=0");
    if (result.code && result.code !== 0) throwMinaResultError(result.code, result.message);
    if (!result.data) return [];
    return result.data.map((item) => ({
      deviceID: item.deviceID,
      name: item.alias || item.name,
      hardware: item.hardware,
      miotDID: item.miotDID ?? item.miot_did ?? "",
    }));
  }

  async playByUrl(
    deviceId: string,
    url: string,
    protocol: boolean | "auto" | "play_music" | "play_url" = "auto",
    trackId?: string,
  ): Promise<boolean> {
    const res = await this.playByUrlWithFallback(deviceId, url, protocol, trackId);
    return res.ok;
  }

  async playByUrlWithFallback(
    deviceId: string,
    url: string,
    protocol: boolean | "auto" | "play_music" | "play_url" = "auto",
    trackId?: string,
  ): Promise<{ ok: boolean; protocolUsed: "play_music" | "play_url" }> {
    const mode = typeof protocol === "boolean"
      ? (protocol ? "play_music" : "play_url")
      : (protocol || "auto");

    if (mode === "play_music") {
      const result = await this.ubus(deviceId, "player_play_music", "mediaplayer", playMusicMessage(url, trackId));
      return { ok: result?.code === 0, protocolUsed: "play_music" };
    }

    if (mode === "play_url") {
      const result = await this.ubus(deviceId, "player_play_url", "mediaplayer", {
        url,
        type: 1,
        media: "app_ios",
      });
      return { ok: result?.code === 0, protocolUsed: "play_url" };
    }

    // mode === "auto": 默认使用更安全通用的 player_play_url (媒体音乐模式)
    try {
      const urlResult = await this.ubus(deviceId, "player_play_url", "mediaplayer", {
        url,
        type: 1,
        media: "app_ios",
      });
      if (urlResult?.code === 0) {
        return { ok: true, protocolUsed: "play_url" };
      }
    } catch {
      // 忽略异常，尝试备选
    }

    // 备选协议尝试：player_play_music
    const fallbackResult = await this.ubus(deviceId, "player_play_music", "mediaplayer", playMusicMessage(url, trackId));
    return { ok: fallbackResult?.code === 0, protocolUsed: "play_music" };
  }

  async playOperation(deviceId: string, operation: string, useMusicApi?: boolean): Promise<boolean> {
    const preferMusic = useMusicApi === true;
    const candidates = preferMusic
      ? [
          { action: operation },
          { action: operation, media: "app_ios" },
          { action: operation, media: "common" },
        ]
      : [
          { action: operation, media: "app_ios" },
          { action: operation },
          { action: operation, media: "common" },
        ];

    for (const params of candidates) {
      const result = await this.ubus(deviceId, "player_play_operation", "mediaplayer", params);
      if (result?.code === 0) return true;
    }

    if (operation === "pause") {
      const stopCandidates = preferMusic
        ? [
            { action: "stop" },
            { action: "stop", media: "app_ios" },
            { action: "stop", media: "common" },
          ]
        : [
            { action: "stop", media: "app_ios" },
            { action: "stop" },
            { action: "stop", media: "common" },
          ];

      for (const params of stopCandidates) {
        const stopResult = await this.ubus(deviceId, "player_play_operation", "mediaplayer", params);
        if (stopResult?.code === 0) return true;
      }
    }

    return false;
  }

  async textToSpeech(deviceId: string, text: string): Promise<boolean> {
    try {
      const result = await this.ubus(deviceId, "text_to_speech", "mibrain", { text });
      return result?.code === 0;
    } catch {
      return false;
    }
  }

  async setVolume(deviceId: string, volume: number): Promise<boolean> {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    const candidates = [
      { volume: clamped, media: "app_ios" },
      { volume: clamped },
      { volume: clamped, media: "common" },
    ];

    for (const params of candidates) {
      try {
        const result = await this.ubus(deviceId, "player_set_volume", "mediaplayer", params);
        if (result?.code === 0) return true;
      } catch {
        // try next candidate
      }
    }

    return false;
  }

  async getStatus(
    deviceId: string,
    useMusicApi?: boolean,
  ): Promise<DevicePlayStatus | null> {
    const preferMusic = useMusicApi !== false;
    const primaryParams = preferMusic ? {} : { media: "app_ios" };
    let result = await this.ubus(deviceId, "player_get_play_status", "mediaplayer", primaryParams);
    let parsed = this.parseStatusPayload(result?.data);

    // Only fallback if primary query failed to return valid play status payload at all
    if (!parsed) {
      const fallbackParams = useMusicApi ? { media: "app_ios" } : {};
      const fallbackResult = await this.ubus(deviceId, "player_get_play_status", "mediaplayer", fallbackParams);
      const fallbackParsed = this.parseStatusPayload(fallbackResult?.data);
      if (fallbackParsed) {
        parsed = fallbackParsed;
      }
    }

    if (parsed && parsed.status === 0 && parsed.position === 0 && parsed.duration === 0) {
      parsed.unreliable = true;
    }

    return parsed;
  }

  private parseStatusPayload(
    rawData: unknown,
  ): DevicePlayStatus | null {
    if (!rawData) return null;
    try {
      let data = rawData;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          // ignore
        }
      }
      const record = asRecord(data);
      let infoObj: Record<string, unknown> | null = null;
      if (record && typeof record.info === "string") {
        infoObj = parseJsonRecord(record.info);
      } else if (record && typeof record.info === "object" && record.info !== null) {
        infoObj = asRecord(record.info);
      } else {
        infoObj = record;
      }

      if (!infoObj) return null;

      const rawStatus = infoObj.status ?? infoObj.play_status ?? infoObj.playStatus;
      const status = typeof rawStatus === "number"
        ? rawStatus
        : (typeof rawStatus === "string" && rawStatus !== "" ? Number(rawStatus) : 0);

      const rawVol = infoObj.volume;
      const volume = typeof rawVol === "number"
        ? rawVol
        : (typeof rawVol === "string" && rawVol !== "" ? Number(rawVol) : 50);

      const songDetail = asRecord(infoObj.play_song_detail) ?? asRecord(infoObj.extra) ?? asRecord(infoObj.song_detail);
      const position = typeof songDetail?.position === "number"
        ? songDetail.position
        : (typeof infoObj.position === "number" ? infoObj.position : (typeof infoObj.cur_time === "number" ? infoObj.cur_time * 1000 : 0));
      const duration = typeof songDetail?.duration === "number"
        ? songDetail.duration
        : (typeof infoObj.duration === "number" ? infoObj.duration : (typeof infoObj.total_time === "number" ? infoObj.total_time * 1000 : 0));

      let audioId: string | undefined;
      if (typeof songDetail?.audio_id === "string" || typeof songDetail?.audio_id === "number") {
        audioId = String(songDetail.audio_id);
      } else if (typeof infoObj.audio_id === "string" || typeof infoObj.audio_id === "number") {
        audioId = String(infoObj.audio_id);
      } else if (typeof infoObj.audioId === "string" || typeof infoObj.audioId === "number") {
        audioId = String(infoObj.audioId);
      } else {
        const curSong = asRecord(infoObj.cur_song) || asRecord(songDetail?.cur_song);
        if (curSong) {
          const rawId = curSong.audio_id ?? curSong.audioId ?? curSong.id;
          if (rawId !== undefined && rawId !== null) audioId = String(rawId);
        }
      }

      let songTitle: string | undefined;
      if (typeof songDetail?.song_name === "string") {
        songTitle = songDetail.song_name;
      } else if (typeof songDetail?.title === "string") {
        songTitle = songDetail.title;
      } else if (typeof songDetail?.name === "string") {
        songTitle = songDetail.name;
      } else if (typeof infoObj.song_name === "string") {
        songTitle = infoObj.song_name;
      } else if (typeof infoObj.title === "string") {
        songTitle = infoObj.title;
      } else {
        const curSong = asRecord(infoObj.cur_song) || asRecord(songDetail?.cur_song);
        if (curSong) {
          const rawName = curSong.song_name ?? curSong.title ?? curSong.name;
          if (typeof rawName === "string") songTitle = rawName;
        }
      }

      const result: DevicePlayStatus = {
        status: Number.isFinite(status) ? status : 0,
        volume: Number.isFinite(volume) ? volume : 50,
        position: Number.isFinite(position) ? position : 0,
        duration: Number.isFinite(duration) ? duration : 0,
      };
      if (audioId) result.audioId = audioId;
      if (songTitle) result.songTitle = songTitle;
      return result;
    } catch {
      return null;
    }
  }

  async getConversation(
    deviceId: string,
    hardware?: string,
    limit = 2,
  ): Promise<{ time: number; query: string } | null> {
    try {
      const target = new URL(`${USERPROFILE_API}/device_profile/v2/conversation`);
      target.searchParams.set("source", "dialogu");
      if (hardware) {
        target.searchParams.set("hardware", hardware);
      }
      target.searchParams.set("timestamp", String(Date.now()));
      target.searchParams.set("limit", String(limit));
      target.searchParams.set("requestId", requestId());

      const response = await this.fetchImpl(target, {
        headers: this.headers(deviceId),
      });
      const result = await readMinaResponse<{
        code?: number | string;
        message?: string;
        data?: unknown;
      }>(response, "MiNA conversation request");

      const numericCode = typeof result.code === "string" ? Number(result.code) : result.code;
      if (numericCode && isAuthenticationFailure(numericCode, result.message)) {
        throw new MinaAuthenticationError("MiNA rejected the Xiaomi session");
      }
      if (numericCode !== undefined && numericCode !== 0) {
        return null;
      }

      const rawData = result.data;
      const dataObj = typeof rawData === "string" ? parseJsonRecord(rawData) : asRecord(rawData);
      const records = Array.isArray(dataObj?.records) ? dataObj.records : [];
      for (const item of records) {
        const rec = asRecord(item);
        if (!rec) continue;

        let query = typeof rec.query === "string" ? rec.query.trim() : "";
        if (!query && Array.isArray(rec.answers)) {
          for (const ans of rec.answers) {
            const ansObj = asRecord(ans);
            const intention = asRecord(ansObj?.intention);
            if (typeof intention?.query === "string" && intention.query.trim()) {
              query = intention.query.trim();
              break;
            }
          }
        }

        const rawTime = rec.time ?? rec.timestamp;
        let time = typeof rawTime === "number"
          ? rawTime
          : typeof rawTime === "string" ? Number(rawTime) : Number.NaN;
        if (Number.isFinite(time) && time >= 1e9 && time < 1e11) {
          time *= 1000;
        }

        if (query && Number.isFinite(time)) {
          return { time, query };
        }
      }
      return null;
    } catch (error) {
      if (error instanceof MinaAuthenticationError) throw error;
      return null;
    }
  }

  async getLatestAsk(deviceId: string, hardware: string): Promise<{ time: number; query: string } | null> {
    try {
      const conversation = await this.getConversation(deviceId, hardware);
      if (conversation) return conversation;
    } catch (error) {
      if (error instanceof MinaAuthenticationError) throw error;
    }
    return await this.getLatestAskByUbus(deviceId);
  }

  private async getLatestAskByUbus(deviceId: string): Promise<{ time: number; query: string } | null> {
    const result = await this.ubus(deviceId, "nlp_result_get", "mibrain", {});
    const data = asRecord(result?.data);
    if (!data || (typeof data.code === "number" && data.code !== 0)) return null;

    const info = typeof data.info === "string" ? parseJsonRecord(data.info) : asRecord(data.info);
    const records = Array.isArray(info?.result) ? info.result : [];
    for (const record of records) {
      const rec = asRecord(record);
      if (!rec) continue;

      let query = typeof rec.query === "string" ? rec.query.trim() : "";

      const nlp = typeof rec.nlp === "string" ? parseJsonRecord(rec.nlp) : asRecord(rec.nlp);
      const meta = asRecord(nlp?.meta);
      const answers = asRecord(nlp?.response)?.answer;
      const answer = Array.isArray(answers) ? asRecord(answers[0]) : null;
      const intention = asRecord(answer?.intention);

      if (!query) {
        query = (
          (typeof intention?.query === "string" && intention.query) ||
          (typeof answer?.question === "string" && answer.question) ||
          (typeof nlp?.query === "string" && nlp.query) ||
          ""
        ).trim();
      }

      const rawTimestamp = meta?.timestamp ?? meta?.time ?? rec.timestamp ?? rec.time;
      let timestamp = typeof rawTimestamp === "number"
        ? rawTimestamp
        : typeof rawTimestamp === "string" ? Number(rawTimestamp) : Number.NaN;
      if (Number.isFinite(timestamp) && timestamp >= 1e9 && timestamp < 1e11) {
        timestamp *= 1000;
      }

      if (query && Number.isFinite(timestamp)) return { time: timestamp, query };
    }
    return null;
  }

  private async ubus(deviceId: string, method: string, path: string, message: Record<string, unknown>): Promise<UbusResponse | null> {
    try {
      const response = await this.fetchImpl(`${MINA_API}/remote/ubus`, {
        method: "POST",
        headers: { ...this.headers(deviceId), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          deviceId,
          message: JSON.stringify(message),
          path,
          method,
          requestId: requestId(),
        }),
      });
      const result = await readMinaResponse<UbusResponse>(response, "MiNA ubus request");
      if (result.code && isAuthenticationFailure(result.code, result.message)) {
        throw new MinaAuthenticationError("MiNA rejected the Xiaomi session");
      }
      return result;
    } catch (error) {
      if (error instanceof MinaAuthenticationError || error instanceof MinaClientError) throw error;
      throw new MinaClientError(`MiNA ubus request failed: ${errorMessage(error)}`);
    }
  }
}

export function isMinaAuthenticationError(error: unknown): error is MinaAuthenticationError {
  return error instanceof MinaAuthenticationError;
}

async function readMinaResponse<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new MinaAuthenticationError("MiNA rejected the Xiaomi session");
  }
  if (!response.ok) {
    throw new MinaClientError(`${context} returned HTTP ${response.status}${describeBody(text)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MinaClientError(`${context} returned unreadable data${describeBody(text)}`);
  }
}

function throwMinaResultError(code: number, message?: string): never {
  if (isAuthenticationFailure(code, message)) {
    throw new MinaAuthenticationError("MiNA rejected the Xiaomi session");
  }
  throw new MinaClientError(`MiNA request failed with code ${code}${message ? `: ${message}` : ""}`);
}

function isAuthenticationFailure(code: number, message?: string): boolean {
  return code === 70016 || /auth|login|token|session/i.test(message ?? "");
}

function describeBody(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^<!doctype html|^<html|^<head|^<body/i.test(text)) return ": HTML verification page";
  return `: ${text.slice(0, 160)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function requestId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "app_ios_";
  for (let index = 0; index < 30; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

export function deriveAudioId(trackId?: string): string {
  if (!trackId) {
    const randNum = Math.floor(Math.random() * 1000000000);
    const suffix = String(randNum).padStart(10, "0").slice(-10);
    return `158297${suffix}000`;
  }
  let hashNum = 0;
  for (let i = 0; i < trackId.length; i++) {
    hashNum = (hashNum * 31 + trackId.charCodeAt(i)) >>> 0;
  }
  const suffix = String(hashNum).padStart(10, "0").slice(-10);
  const hash3 = String(hashNum % 997).padStart(3, "0");
  return `158297${suffix}${hash3}`;
}

function playMusicMessage(url: string, trackId?: string): Record<string, unknown> {
  const audioId = deriveAudioId(trackId);

  return {
    startaudioid: audioId,
    music: JSON.stringify({
      payload: {
        audio_type: "MUSIC",
        audio_items: [{
          item_id: {
            audio_id: audioId,
            cp: {
              album_id: "-1",
              episode_index: 0,
              id: "355454500",
              name: "xiaowei",
            },
          },
          stream: { url },
        }],
        list_params: {
          listId: "-1",
          loadmore_offset: 0,
          origin: "xiaowei",
          type: "MUSIC",
        },
      },
      play_behavior: "REPLACE_ALL",
    }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}
