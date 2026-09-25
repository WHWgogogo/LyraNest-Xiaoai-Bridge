import type { RouteHandler } from "./router.js";
import { sendJson, readJsonBody } from "./router.js";
import { buildStreamUrl } from "../lyranest/url-builder.js";
import { MinaClient } from "../xiaomi/mina-client.js";
import { withXiaomiSession } from "../xiaomi/with-session.js";
import { profileFor } from "../types.js";
import type { BridgeState } from "../index.js";
import { logger, sanitizeUrl } from "../logger.js";
import { parseCommand } from "../voice/command-parser.js";
import { resolveDevice, getQueueManager, getLyraNestClientForDevice, playTrack, deviceProtocolCache, resolvePlaybackProtocol, resolveTranscode } from "../runtime.js";

interface TestPlayRequest {
  keyword: string;
  device_id?: string;
}

export function testPlay(state: BridgeState): RouteHandler {
  return async (req, res) => {
    let keyword = "";
    try {
      const body = await readJsonBody<TestPlayRequest>(req);
      keyword = body.keyword?.trim() || "";
      if (!keyword) {
        logger.warn("test-play", "测试播放请求未提供搜索关键词");
        sendJson(res, 400, { error: "keyword is required" });
        return;
      }
      const targetDevice = resolveDevice(state, body.device_id);
      if (!state.xiaomiTokens || !targetDevice) {
        logger.warn("test-play", "测试播放无法执行: 小米账号未登录或未选择音箱设备");
        sendJson(res, 409, { error: "Xiaomi not logged in or device not selected" });
        return;
      }
      const qm = getQueueManager(state, targetDevice.device_id);
      const lnClient = getLyraNestClientForDevice(state, targetDevice.device_id);

      const parsed = parseCommand(keyword, state.config);
      if (parsed.action === "audiobook") {
        const bookKeyword = parsed.keyword || keyword;
        logger.info("test-play", `后台测试播放有声书: "${bookKeyword}"`, {
          keyword: bookKeyword,
          specified_chapter: parsed.chapterIndex,
          target_device: targetDevice.name,
        });

        const books = await lnClient.searchBooks(bookKeyword);
        if (!books.length) {
          logger.warn("test-play", `测试播放失败: 未找到与 "${bookKeyword}" 匹配的有声书`, { keyword: bookKeyword });
          sendJson(res, 404, { error: `no audiobook found for "${bookKeyword}"` });
          return;
        }

        const book = books[0];
        const detail = await lnClient.getBookDetail(book.id);
        if (!detail || !detail.chapters.length) {
          logger.warn("test-play", `有声书 "${book.title}" 暂无有效章节音频`, { book_id: book.id });
          sendJson(res, 404, { error: `audiobook "${book.title}" has no chapters` });
          return;
        }

        const chapters = detail.chapters;
        let targetChapter = parsed.chapterIndex !== undefined
          ? chapters.find((c) => c.chapter_index === parsed.chapterIndex) || chapters[parsed.chapterIndex - 1]
          : undefined;

        if (!targetChapter) {
          const progress = await lnClient.getBookProgress(book.id);
          if (progress?.current_track_id) {
            targetChapter = chapters.find((c) => (c.track_id || c.track?.id) === progress.current_track_id);
          }
        }
        if (!targetChapter) {
          targetChapter = chapters[0];
        }

        const trackId = targetChapter.track_id || targetChapter.track?.id;
        if (!trackId) {
          sendJson(res, 500, { error: "chapter track unavailable" });
          return;
        }

        const mediaToken = await lnClient.getMediaToken();
        const transcode = resolveTranscode(state.config, targetDevice.hardware, targetDevice.device_id);
        const streamUrl = buildStreamUrl(state.config.speaker_base_url, trackId, mediaToken, transcode);
        const preferredProtocol = resolvePlaybackProtocol(state.config, targetDevice.hardware, targetDevice.device_id);

        logger.info("test-play", `测试播放有声书音频流构建成功，正在向音箱下发播放 (协议模式: ${preferredProtocol}${transcode ? `, 转码: ${transcode}` : ""})`, {
          book_title: book.title,
          chapter_index: targetChapter.chapter_index,
          chapter_title: targetChapter.chapter_title,
          stream_url: sanitizeUrl(streamUrl),
          transcode: transcode || "original",
          protocol: preferredProtocol,
        });

        const playResult = await withXiaomiSession(
          state,
          (tokens) => new MinaClient(tokens).playByUrlWithFallback(
            targetDevice.device_id,
            streamUrl,
            preferredProtocol,
            trackId,
          ),
        );

        if (!playResult.ok) {
          logger.error("test-play", `测试播放失败: 音箱拒绝了有声书播放指令`, {
            book_title: book.title,
            device_name: targetDevice.name,
          });
          state.lastError = `play failed on ${targetDevice.name}`;
          sendJson(res, 502, { error: "speaker rejected play command" });
          return;
        }
        deviceProtocolCache.set(targetDevice.device_id, playResult.protocolUsed);

        const displayTitle = `《${book.title}》第${targetChapter.chapter_index}章 ${targetChapter.chapter_title}`;
        logger.info("test-play", `测试播放成功: 音箱已开始播放有声书 ${displayTitle}`, {
          book_title: book.title,
          chapter_index: targetChapter.chapter_index,
        });
        qm.setActive(false);
        void lnClient.updateBookProgress(book.id, trackId, 0).catch(() => undefined);

        sendJson(res, 200, {
          playing: true,
          track: { id: trackId, title: displayTitle },
          device_id: targetDevice.device_id,
          device: targetDevice.name,
        });
        return;
      }

      if (parsed.action === "playlist") {
        const playlistKeyword = (parsed.keyword || keyword).trim().toLowerCase();
        const collections = await lnClient.getCollections();
        const matched = collections.playlists.find((pl) => {
          const name = (pl.name || "").toLowerCase();
          return name.includes(playlistKeyword) || playlistKeyword.includes(name);
        });
        if (!matched || !matched.track_ids?.length) {
          sendJson(res, 404, { error: `未找到匹配歌单或歌单为空: "${playlistKeyword}"` });
          return;
        }
        const tracks = await lnClient.getTracksByIds(matched.track_ids);
        if (!tracks.length) {
          sendJson(res, 404, { error: `歌单 "${matched.name}" 中的歌曲无法读取` });
          return;
        }
        qm.setQueue(tracks, 0, `歌单《${matched.name}》`);
        const track = tracks[0];
        const ok = await playTrack(state, targetDevice, track, qm, lnClient);
        if (!ok) {
          sendJson(res, 502, { error: "speaker rejected play command" });
          return;
        }
        sendJson(res, 200, {
          playing: true,
          track: { id: track.id, title: `《${matched.name}》- ${track.title}` },
          device_id: targetDevice.device_id,
          device: targetDevice.name,
        });
        return;
      }

      if (parsed.action === "favorite") {
        const collections = await lnClient.getCollections();
        if (!collections.favorite_track_ids.length) {
          sendJson(res, 404, { error: "收藏列表中暂无歌曲" });
          return;
        }
        const tracks = await lnClient.getTracksByIds(collections.favorite_track_ids);
        if (!tracks.length) {
          sendJson(res, 404, { error: "收藏歌曲详情读取失败" });
          return;
        }
        qm.setQueue(tracks, 0, "我喜欢的音乐");
        const track = tracks[0];
        const ok = await playTrack(state, targetDevice, track, qm, lnClient);
        if (!ok) {
          sendJson(res, 502, { error: "speaker rejected play command" });
          return;
        }
        sendJson(res, 200, {
          playing: true,
          track: { id: track.id, title: `《我喜欢的音乐》- ${track.title}` },
          device_id: targetDevice.device_id,
          device: targetDevice.name,
        });
        return;
      }

      logger.info("test-play", `收到后台测试播放请求，搜索词: "${keyword}"`, {
        keyword,
        target_device: targetDevice.name,
        target_device_id: targetDevice.device_id,
      });

      const tracks = await lnClient.searchTracks(keyword, state.config.search_limit);
      if (!tracks.length) {
        logger.warn("test-play", `测试播放失败: LyraNest 曲库中未找到与 "${keyword}" 匹配的歌曲`, { keyword });
        sendJson(res, 404, { error: `no tracks found for "${keyword}"` });
        return;
      }

      qm.setQueue(tracks, 0, `测试点播《${keyword}》`);
      const track = tracks[0];
      logger.info("test-play", `测试播放检索到匹配歌曲: "${track.title}" (ID: ${track.id})，正在下发播放...`, {
        track_title: track.title,
        track_id: track.id,
      });

      const ok = await playTrack(state, targetDevice, track, qm, lnClient);

      if (!ok) {
        logger.error("test-play", `测试播放失败: 音箱 "${targetDevice.name}" 拒绝了播放指令`, {
          device_name: targetDevice.name,
          hardware: targetDevice.hardware,
          track_title: track.title,
        });
        state.lastError = `play failed on ${targetDevice.name}`;
        sendJson(res, 502, { error: "speaker rejected play command" });
        return;
      }

      logger.info("test-play", `测试播放成功: 音箱 "${targetDevice.name}" 已接受并开始播放 "${track.title}"`, {
        device_name: targetDevice.name,
        track_title: track.title,
      });

      sendJson(res, 200, {
        playing: true,
        track: { id: track.id, title: track.title },
        device_id: targetDevice.device_id,
        device: targetDevice.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown test-play error";
      logger.error("test-play", `测试播放发生异常: ${message}`, {
        error: message,
        keyword,
      });
      state.lastError = message;
      sendJson(res, 500, { error: state.lastError });
    }
  };
}
