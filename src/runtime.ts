import { findDevice } from "./xiaomi/device-manager.js";
import { MinaClient, deriveAudioId } from "./xiaomi/mina-client.js";
import { withXiaomiSession } from "./xiaomi/with-session.js";
import { buildStreamUrl } from "./lyranest/url-builder.js";
import { profileFor, type XiaomiDevice, type LyraNestBookChapter, type LyraNestTrack, type LyraNestLibrary, type BridgeConfig } from "./types.js";
import type { BridgeState } from "./index.js";
import type { ParsedCommand } from "./voice/command-parser.js";
import { logger, sanitizeUrl } from "./logger.js";
import { QueueManager } from "./playback/queue-manager.js";
import { LyraNestClient } from "./lyranest/api-client.js";
import { playbackClock } from "./playback/playback-clock.js";

export { playbackClock } from "./playback/playback-clock.js";

export function getQueueManager(state: BridgeState, deviceId?: string): QueueManager {
  if (!deviceId) {
    if (state.selectedDevice?.device_id) {
      return getQueueManager(state, state.selectedDevice.device_id);
    }
    return state.queueManager;
  }
  if (!state.deviceQueues) {
    state.deviceQueues = new Map();
  }
  let qm = state.deviceQueues.get(deviceId);
  if (!qm) {
    if (state.selectedDevice && state.selectedDevice.device_id === deviceId && state.queueManager) {
      qm = state.queueManager;
    } else {
      qm = new QueueManager();
      qm.setMode(state.config.play_mode || "loop");
    }
    state.deviceQueues.set(deviceId, qm);
  }
  return qm;
}

export function getLyraNestClientForDevice(state: BridgeState, deviceId?: string): LyraNestClient {
  if (!deviceId) {
    return state.lyraNest;
  }
  const binding = state.config.device_bindings?.[deviceId];
  if (!binding || !binding.enabled || !binding.lyranest_username || !binding.lyranest_password) {
    return state.lyraNest;
  }
  if (!state.lyraNestClients) {
    state.lyraNestClients = new Map();
  }
  const cached = state.lyraNestClients.get(deviceId);
  if (
    cached &&
    (typeof cached.getUsername !== "function" || cached.getUsername() === binding.lyranest_username) &&
    (typeof cached.getBaseUrl !== "function" || cached.getBaseUrl() === state.config.lyranest_base_url)
  ) {
    return cached;
  }
  const client = new LyraNestClient(
    state.config.lyranest_base_url,
    binding.lyranest_username,
    binding.lyranest_password,
  );
  state.lyraNestClients.set(deviceId, client);
  return client;
}

export function getEnabledDevices(state: BridgeState): XiaomiDevice[] {
  const enabledIds = state.config.enabled_device_ids;
  if (Array.isArray(enabledIds) && enabledIds.length > 0) {
    const matched = (state.allDevices || []).filter((d) => enabledIds.includes(d.device_id));
    if (matched.length > 0) return matched;
  }
  if (state.selectedDevice) {
    return [state.selectedDevice];
  }
  return [];
}

export function resolveDevice(state: BridgeState, deviceId?: string, username?: string): XiaomiDevice | null {
  if (deviceId) {
    if (state.spatialCoordinator?.isSpatialDeviceId(deviceId)) {
      const groupId = state.spatialCoordinator.extractGroupId(deviceId);
      const group = state.spatialCoordinator.getGroup(groupId);
      if (group) return state.spatialCoordinator.toVirtualDevice(group);
    }
    if (state.enabledDevices) {
      const found = state.enabledDevices.find((d) => d.device_id === deviceId);
      if (found) return found;
    }
    if (state.allDevices) {
      const found = state.allDevices.find((d) => d.device_id === deviceId);
      if (found) return found;
    }
    if (state.selectedDevice?.device_id === deviceId) {
      return state.selectedDevice;
    }
    return null;
  }

  // 若未指定 deviceId，优先根据传入的当前登录用户名在专属绑定音箱中寻找匹配项
  if (username && state.config.device_bindings) {
    const trimmedUser = username.trim().toLowerCase();
    const candidateDevices = state.enabledDevices && state.enabledDevices.length > 0
      ? state.enabledDevices
      : (state.allDevices || []);

    const matched = candidateDevices.find((d) => {
      const binding = state.config.device_bindings?.[d.device_id];
      return Boolean(binding?.enabled && (binding.lyranest_username || "").trim().toLowerCase() === trimmedUser);
    });
    if (matched) {
      logger.info("playback", `未指定 device_id，根据用户身份 "${username}" 自动路由至专属音箱: "${matched.name}" (${matched.device_id})`);
      return matched;
    }
  }

  return state.selectedDevice || (state.enabledDevices && state.enabledDevices[0]) || null;
}

export async function restoreSelectedDevice(state: BridgeState): Promise<void> {
  const deviceId = state.config.selected_device_id;
  if (!state.xiaomiTokens) {
    state.selectedDevice = null;
    state.enabledDevices = [];
    state.allDevices = [];
    return;
  }
  try {
    const client = new MinaClient(state.xiaomiTokens);
    const devices = await client.getDevices();
    const mapped: XiaomiDevice[] = devices.map((item) => ({
      device_id: item.deviceID,
      name: item.name,
      hardware: item.hardware,
      miot_did: item.miotDID || undefined,
    }));
    state.allDevices = mapped;

    if (deviceId) {
      const device = findDevice(mapped, deviceId);
      state.selectedDevice = device ?? null;
    } else {
      state.selectedDevice = null;
    }

    state.enabledDevices = getEnabledDevices(state);
    if (!state.selectedDevice && state.enabledDevices.length > 0) {
      state.selectedDevice = state.enabledDevices[0];
    }

    if (state.selectedDevice) {
      getQueueManager(state, state.selectedDevice.device_id);
    }
  } catch {
    state.selectedDevice = null;
    state.enabledDevices = [];
  }
}

export async function handlePlaylistPlayback(
  state: BridgeState,
  selectedDevice: XiaomiDevice,
  keyword: string,
  fallbackToLibrary = true,
  queueMgr?: QueueManager,
  client?: LyraNestClient,
): Promise<{ success: boolean; track_title?: string; error?: string }> {
  const qm = queueMgr || getQueueManager(state, selectedDevice.device_id);
  const lnClient = client || getLyraNestClientForDevice(state, selectedDevice.device_id);
  const playlistKeyword = (keyword || "").trim().toLowerCase();
  logger.info("playback", `正在检索歌单: "${playlistKeyword || "全部歌单"}"`);
  const collections = await lnClient.getCollections();
  const availablePlaylists = collections.playlists || [];

  let matched = availablePlaylists.find((pl) => (pl.name || "").toLowerCase() === playlistKeyword);
  if (!matched && playlistKeyword) {
    matched = availablePlaylists.find((pl) => {
      const name = (pl.name || "").toLowerCase();
      return name.includes(playlistKeyword) || playlistKeyword.includes(name);
    });
  }
  if (!matched && !playlistKeyword && availablePlaylists.length > 0) {
    matched = availablePlaylists.find((pl) => Array.isArray(pl.track_ids) && pl.track_ids.length > 0) || availablePlaylists[0];
  }

  if (matched && matched.track_ids && matched.track_ids.length > 0) {
    logger.info("playback", `已找到歌单 "${matched.name}" (包含 ${matched.track_ids.length} 首歌)，正在获取歌曲详情...`);
    const tracks = await lnClient.getTracksByIds(matched.track_ids);
    if (tracks.length > 0) {
      qm.setQueue(tracks, 0, `歌单《${matched.name}》`);
      const first = tracks[0];
      const ok = await playTrack(state, selectedDevice, first, qm, lnClient);
      return ok
        ? { success: true, track_title: `《${matched.name}》- ${first.title}` }
        : { success: false, error: "speaker rejected play command" };
    }
  }

  // If no keyword specified and no playlist matched, fallback to favorite tracks!
  if (!playlistKeyword && collections.favorite_track_ids && collections.favorite_track_ids.length > 0) {
    logger.info("playback", `正在播放收藏音乐 (包含 ${collections.favorite_track_ids.length} 首歌)...`);
    const tracks = await lnClient.getTracksByIds(collections.favorite_track_ids);
    if (tracks.length > 0) {
      qm.setQueue(tracks, 0, "我喜欢的音乐");
      const first = tracks[0];
      const ok = await playTrack(state, selectedDevice, first, qm, lnClient);
      return ok
        ? { success: true, track_title: `[收藏] ${first.title}` }
        : { success: false, error: "speaker rejected play command" };
    }
  }

  // Fallback: If playlist not found or empty, try matching a Library!
  if (fallbackToLibrary && playlistKeyword) {
    logger.info("playback", `歌单中未匹配到 "${playlistKeyword}"，正在尝试检索同名曲库...`);
    const libResult = await handleLibraryPlayback(state, selectedDevice, keyword, false, qm, lnClient);
    if (libResult.success) {
      return libResult;
    }
  }

  const playlistNames = availablePlaylists.map((pl) => pl.name).filter(Boolean);
  logger.warn("playback", `未找到匹配歌单或歌单为空: "${playlistKeyword}" (当前账号可用歌单: [${playlistNames.join(", ")}])`);
  return { success: false, error: `未找到匹配歌单或歌单为空: "${playlistKeyword}"` };
}

export async function handleLibraryPlayback(
  state: BridgeState,
  selectedDevice: XiaomiDevice,
  keyword: string,
  fallbackToPlaylist = true,
  queueMgr?: QueueManager,
  client?: LyraNestClient,
): Promise<{ success: boolean; track_title?: string; error?: string }> {
  const qm = queueMgr || getQueueManager(state, selectedDevice.device_id);
  const lnClient = client || getLyraNestClientForDevice(state, selectedDevice.device_id);
  const libraryKeyword = (keyword || "").trim().toLowerCase();
  logger.info("playback", `正在检索曲库: "${libraryKeyword || "全部曲库"}"`);
  let libraries: LyraNestLibrary[] = [];
  try {
    libraries = await lnClient.getLibraries();
  } catch (err) {
    logger.warn("playback", `获取曲库列表失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  let matched = libraries.find((lib) => (lib.name || "").toLowerCase() === libraryKeyword);
  if (!matched && libraryKeyword) {
    matched = libraries.find((lib) => {
      const name = (lib.name || "").toLowerCase();
      return name.includes(libraryKeyword) || libraryKeyword.includes(name);
    });
  }

  let tracks: LyraNestTrack[] = [];
  if (matched) {
    logger.info("playback", `已找到曲库 "${matched.name}" (ID: ${matched.id})，正在获取曲库歌曲...`);
    tracks = await lnClient.getTracksByLibrary(matched.id, 200);
    if (tracks.length === 0) {
      logger.warn("playback", `曲库 "${matched.name}" 中暂无可播放歌曲`);
    }
  } else if (!libraryKeyword) {
    for (const lib of libraries) {
      const trks = await lnClient.getTracksByLibrary(lib.id, 200);
      if (trks.length > 0) {
        matched = lib;
        tracks = trks;
        break;
      }
    }
    if (!matched || tracks.length === 0) {
      tracks = await lnClient.getLibraryTracks(200);
      if (tracks.length > 0) {
        matched = { id: "all", name: "全部曲库", kind: "music" };
      }
    }
  }

  if (matched && tracks.length > 0) {
    qm.setQueue(tracks, 0, `曲库《${matched.name}》`);
    const first = tracks[0];
    const ok = await playTrack(state, selectedDevice, first, qm, lnClient);
    return ok
      ? { success: true, track_title: `[曲库: ${matched.name}] ${first.title}` }
      : { success: false, error: "speaker rejected play command" };
  }

  // Fallback: If library not found, try matching a playlist!
  if (fallbackToPlaylist && libraryKeyword) {
    logger.info("playback", `曲库中未匹配到 "${libraryKeyword}"，正在尝试检索同名歌单...`);
    const plResult = await handlePlaylistPlayback(state, selectedDevice, keyword, false, qm, lnClient);
    if (plResult.success) {
      return plResult;
    }
  }

  const libNames = libraries.map((lib) => lib.name).filter(Boolean);
  logger.warn("playback", `未找到匹配曲库或曲库为空: "${libraryKeyword}" (当前可用曲库: [${libNames.join(", ")}])`);
  return { success: false, error: `未找到匹配曲库或曲库为空: "${libraryKeyword}"` };
}

export async function handleArtistPlayback(
  state: BridgeState,
  selectedDevice: XiaomiDevice,
  keyword: string,
  queueMgr?: QueueManager,
  client?: LyraNestClient,
): Promise<{ success: boolean; track_title?: string; error?: string }> {
  const qm = queueMgr || getQueueManager(state, selectedDevice.device_id);
  const lnClient = client || getLyraNestClientForDevice(state, selectedDevice.device_id);
  const artistKeyword = (keyword || "").trim();
  if (!artistKeyword) {
    logger.warn("playback", "艺术家点播指令未包含有效歌手名");
    return { success: false, error: "missing artist keyword" };
  }
  logger.info("playback", `正在检索艺术家 "${artistKeyword}" 的全部歌曲...`);
  const searchResult = await lnClient.searchTracks(artistKeyword, 50);
  const kw = artistKeyword.toLowerCase();
  const matched = searchResult.filter((t) => (t.artist || "").toLowerCase().includes(kw));
  const tracks = matched.length > 0 ? matched : searchResult;

  if (!tracks.length) {
    logger.warn("playback", `LyraNest 曲库中未找到艺术家 "${artistKeyword}" 的歌曲`);
    return { success: false, error: `未找到艺术家 "${artistKeyword}" 的歌曲` };
  }

  qm.setQueue(tracks, 0, `艺术家《${artistKeyword}》`);
  const first = tracks[0];
  logger.info("playback", `检索到艺术家 "${artistKeyword}" 共 ${tracks.length} 首歌曲，准备播放第 1 首: "${first.title}" (歌手: ${first.artist || "未知"})`);
  const ok = await playTrack(state, selectedDevice, first, qm, lnClient);
  return ok
    ? { success: true, track_title: `[${artistKeyword}] ${first.title}` }
    : { success: false, error: "speaker rejected play command" };
}

export const IDLE_DEBOUNCE_COUNT = 2;
export const MIN_TRACK_DURATION_FALLBACK_MS = 30000;
export const VOICE_COOLDOWN_MS = 20000;
export const MAX_AUTO_ADVANCE_FAILURES = 3;
export const BACKOFF_DELAYS_MS = [30000, 60000, 120000];

export const deviceIdleCounts = new Map<string, number>();

export interface DeviceAdvanceFailureState {
  failureCount: number;
  nextRetryAt: number;
}
export const deviceAdvanceFailures = new Map<string, DeviceAdvanceFailureState>();

export async function advanceQueueNextTrack(
  state: BridgeState,
  targetDevice: XiaomiDevice,
  qm: QueueManager,
  lnClient: LyraNestClient,
): Promise<LyraNestTrack | null> {
  if (
    state.config.auto_continue_library &&
    qm.getMode() !== "single_loop" &&
    (qm.size() <= 1 || qm.isAtEnd())
  ) {
    try {
      logger.info("playback", `设备 "${targetDevice.name}" 当前队列（${qm.size()}首）即将播完，正在从曲库自动漫游拉取歌曲连播...`);
      let libTracks = [...(await lnClient.getLibraryTracks(200))];
      if (qm.getMode() === "shuffle") {
        for (let i = libTracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [libTracks[i], libTracks[j]] = [libTracks[j], libTracks[i]];
        }
      }
      const added = qm.appendTracks(libTracks);
      if (added > 0) {
        return qm.next();
      } else if (qm.size() === 0 && libTracks.length > 0) {
        qm.setQueue(libTracks, 0, "全部曲库");
        return qm.current();
      }
    } catch (err) {
      logger.warn("playback", `获取曲库连播歌曲失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return qm.next();
}

export function syncPoller(state: BridgeState): void {
  if (!state.config.enabled) {
    state.poller.stop();
    logger.info("poller", "语音监听未运行: 插件未启用 (enabled: false)，请在管理后台开启 Bridge 启用开关");
    return;
  }
  if (!state.xiaomiTokens) {
    state.poller.stop();
    logger.warn("poller", "语音监听未运行: 小米账号尚未登录，请在管理后台完成小米账号登录");
    return;
  }
  const enabledDevices = state.enabledDevices && state.enabledDevices.length > 0
    ? state.enabledDevices
    : (state.selectedDevice ? [state.selectedDevice] : []);

  if (enabledDevices.length === 0) {
    state.poller.stop();
    logger.warn("poller", "语音监听未运行: 未选择小爱音箱设备，请在管理后台勾选目标音箱");
    return;
  }

  const primaryDevice = state.selectedDevice || enabledDevices[0];
  const deviceNames = enabledDevices.map((d) => `"${d.name}" (${d.hardware})`).join(", ");
  logger.info("poller", `已启动多音箱语音监听: 监听设备 [${deviceNames}]，轮询间隔: ${state.config.poll_interval_sec} 秒`, {
    enabled_device_ids: enabledDevices.map((d) => d.device_id),
    poll_interval_sec: state.config.poll_interval_sec,
  });

  state.poller.start({
    minaClient: new MinaClient(state.xiaomiTokens),
    config: state.config,
    selectedDevice: primaryDevice,
    enabledDevices,
    refreshMinaClient: async () => {
      logger.warn("poller", "小米凭证需刷新，正在恢复认证...");
      const tokens = await state.xiaomiLogin.recoverAuthentication();
      return tokens ? new MinaClient(tokens) : null;
    },
    onCommand: async (parsed, triggeringDevice) => {
      let targetDevice = triggeringDevice || state.selectedDevice || enabledDevices[0];
      if (parsed.targetScope === "whole_house" && state.spatialCoordinator) {
        const groups = state.spatialCoordinator.getGroups();
        const whGroup = groups.find((g) => g.mode === "whole_house" && g.enabled);
        if (whGroup) {
          targetDevice = state.spatialCoordinator.toVirtualDevice(whGroup);
          logger.info("spatial", `识别到全屋指令，自动路由至全屋背景音乐组: "${whGroup.name}" (${targetDevice.device_id})`);
        } else {
          const candidateDevices = enabledDevices.length > 0 ? enabledDevices : (state.allDevices || []);
          if (candidateDevices.length > 0) {
            const slots: Record<string, any> = {};
            candidateDevices.forEach((d, idx) => {
              slots[`ZONE_${idx + 1}`] = {
                role: `ZONE_${idx + 1}`,
                deviceId: d.device_id,
                deviceName: d.name,
                hardware: d.hardware,
                delayMs: 0,
                volumeOffsetDb: 0,
              };
            });
            const autoGroup = state.spatialCoordinator.saveGroup({
              name: "全屋背景音乐",
              mode: "whole_house",
              enabled: true,
              slots,
            });
            targetDevice = state.spatialCoordinator.toVirtualDevice(autoGroup);
            logger.info("spatial", `未发现已保存的全屋组，自动基于当前 ${candidateDevices.length} 台在线音箱创建并启用全屋背景音乐组: "${autoGroup.name}"`);
          }
        }
      }
      if (!state.xiaomiTokens || !targetDevice) {
        logger.warn("playback", "指令无法执行: 小米会话失效或未选择音箱设备");
        return { success: false, error: "Xiaomi session or speaker is unavailable" };
      }
      const qm = getQueueManager(state, targetDevice.device_id);
      const lnClient = getLyraNestClientForDevice(state, targetDevice.device_id);

      try {
        if (parsed.action === "system" || parsed.action === "ignore" || parsed.action === "unknown") {
          logger.info("playback", `识别到非音乐控制语音指令 (action: ${parsed.action})，保持当前播放状态`);
          return { success: true };
        }

        // Actual music-related interaction: update cooldown and clear failure backoff
        state.lastVoiceInteractionAt = Date.now();
        deviceAdvanceFailures.delete(targetDevice.device_id);

        if (parsed.action === "audiobook") {
          if (!parsed.keyword) {
            logger.warn("audiobook", "有声书点播指令未包含有效书名");
            return { success: false, error: "missing audiobook title" };
          }
          logger.info("audiobook", `正在 LyraNest 中检索有声书: "${parsed.keyword}"`, {
            keyword: parsed.keyword,
            specified_chapter: parsed.chapterIndex,
          });

          const books = await lnClient.searchBooks(parsed.keyword);
          if (!books.length) {
            logger.warn("audiobook", `LyraNest 中未找到与 "${parsed.keyword}" 匹配的有声书`, {
              keyword: parsed.keyword,
            });
            return { success: false, error: `no matching audiobook found for "${parsed.keyword}"` };
          }

          const book = books[0];
          logger.info("audiobook", `已找到匹配书籍: "${book.title}" (ID: ${book.id}, 共 ${book.chapter_count} 章)，正在读取章节详情...`, {
            book_id: book.id,
            book_title: book.title,
            chapter_count: book.chapter_count,
          });

          const detail = await lnClient.getBookDetail(book.id);
          if (!detail || !detail.chapters.length) {
            logger.warn("audiobook", `有声书 "${book.title}" 暂无有效章节音频`, { book_id: book.id });
            return { success: false, error: `audiobook "${book.title}" has no chapters` };
          }

          const chapters = detail.chapters;
          let targetChapter: LyraNestBookChapter | undefined;
          let isResume = false;

          if (typeof parsed.chapterIndex === "number") {
            targetChapter = chapters.find((c) => c.chapter_index === parsed.chapterIndex);
            if (!targetChapter) {
              const index = parsed.chapterIndex - 1;
              if (index >= 0 && index < chapters.length) {
                targetChapter = chapters[index];
              }
            }
          }

          if (!targetChapter) {
            const progress = await lnClient.getBookProgress(book.id);
            if (progress?.current_track_id) {
              targetChapter = chapters.find((c) => (c.track_id || c.track?.id) === progress.current_track_id);
              if (targetChapter) {
                isResume = true;
                logger.info("audiobook", `检测到历史收听进度，准备续播第 ${targetChapter.chapter_index} 章: "${targetChapter.chapter_title}"`, {
                  book_title: book.title,
                  chapter_index: targetChapter.chapter_index,
                  position_ms: progress.position_ms,
                });
              }
            }
          }

          if (!targetChapter) {
            targetChapter = chapters[0];
            logger.info("audiobook", `从第 1 章开始播放: "${targetChapter.chapter_title}"`, {
              book_title: book.title,
              chapter_index: targetChapter.chapter_index,
            });
          }

          const trackId = targetChapter.track_id || targetChapter.track?.id;
          if (!trackId) {
            logger.error("audiobook", `目标章节缺少有效 track_id`, { targetChapter });
            return { success: false, error: "chapter track unavailable" };
          }

          const bookTracks: LyraNestTrack[] = chapters.map((c) => {
            const cTrackId = c.track_id || c.track?.id || "";
            const durMs = (typeof c.track?.duration === "number" && c.track.duration > 0)
              ? (c.track.duration < 10000 ? Math.round(c.track.duration * 1000) : Math.round(c.track.duration))
              : 0;
            return {
              id: cTrackId,
              title: `《${book.title}》第${c.chapter_index}章 ${c.chapter_title}`,
              artist: book.author || book.narrator || book.title,
              album: book.title,
              duration_ms: durMs,
            };
          });

          let startIndex = chapters.findIndex((c) => (c.track_id || c.track?.id) === trackId);
          if (startIndex < 0) startIndex = 0;

          qm.setMode("sequence");
          qm.setQueue(bookTracks, startIndex, `有声书:${book.id}:${book.title}`);

          const currentChapterTrack = bookTracks[startIndex];
          logger.info("audiobook", `已构建有声书全本章节队列 (共 ${bookTracks.length} 章)，准备播放第 ${targetChapter.chapter_index} 章`, {
            book_title: book.title,
            chapter_index: targetChapter.chapter_index,
            chapter_title: targetChapter.chapter_title,
            track_id: trackId,
            is_resume: isResume,
          });

          const ok = await playTrack(state, targetDevice, currentChapterTrack, qm, lnClient);
          if (ok) {
            const displayTitle = currentChapterTrack.title;
            logger.info("audiobook", `音箱已成功开始播放有声书: ${displayTitle}`, {
              book_title: book.title,
              chapter_index: targetChapter.chapter_index,
              track_id: trackId,
              device_name: targetDevice.name,
            });
            void lnClient.updateBookProgress(book.id, trackId, 0).catch(() => undefined);
            return { success: true, track_title: displayTitle };
          } else {
            logger.error("audiobook", `音箱拒绝了有声书播放指令 (playTrack 失败)`, {
              book_title: book.title,
              chapter_index: targetChapter.chapter_index,
              device_name: targetDevice.name,
            });
            return { success: false, error: "speaker rejected audiobook play command" };
          }
        }

        if (parsed.action === "play_mode") {
          const targetMode = parsed.playMode || "loop";
          qm.setMode(targetMode);
          logger.info("playback", `播放模式已切换为: ${targetMode}`);

          if (qm.isActive() && qm.current()) {
            if (targetMode === "shuffle") {
              qm.shuffle();
            }
            return {
              success: true,
              track_title: qm.current()?.title,
            };
          }

          logger.info("playback", `检测到未处于播放状态，正在从曲库拉取歌曲开启${targetMode === "shuffle" ? "随机" : "循环"}播放...`);
          let libTracks = [...(await lnClient.getLibraryTracks(200))];
          if (!libTracks.length) {
            logger.warn("playback", "曲库中暂无可播放歌曲");
            return { success: false, error: "曲库中暂无可播放歌曲" };
          }
          if (targetMode === "shuffle") {
            for (let i = libTracks.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [libTracks[i], libTracks[j]] = [libTracks[j], libTracks[i]];
            }
          }
          const start = qm.setQueue(libTracks, 0, "曲库漫游");
          if (start) {
            const ok = await playTrack(state, targetDevice, start, qm, lnClient);
            return ok
              ? { success: true, track_title: start.title }
              : { success: false, error: "speaker rejected play command" };
          }
          return { success: true };
        }

        if (parsed.action === "playlist") {
          return await handlePlaylistPlayback(state, targetDevice, parsed.keyword || "", true, qm, lnClient);
        }

        if (parsed.action === "library") {
          return await handleLibraryPlayback(state, targetDevice, parsed.keyword || "", true, qm, lnClient);
        }

        if (parsed.action === "artist") {
          return await handleArtistPlayback(state, targetDevice, parsed.keyword || parsed.artist || "", qm, lnClient);
        }

        if (parsed.action === "favorite") {
          logger.info("playback", "正在获取收藏（我喜欢的音乐）列表...");
          const collections = await lnClient.getCollections();
          if (!collections.favorite_track_ids.length) {
            logger.warn("playback", "收藏列表中暂无歌曲");
            return { success: false, error: "收藏列表中暂无歌曲" };
          }
          logger.info("playback", `已获取到 ${collections.favorite_track_ids.length} 首收藏歌曲，正在拉取详情...`);
          const tracks = await lnClient.getTracksByIds(collections.favorite_track_ids);
          if (!tracks.length) {
            logger.warn("playback", "收藏歌曲详情读取失败");
            return { success: false, error: "收藏歌曲详情读取失败" };
          }
          qm.setQueue(tracks, 0, "我喜欢的音乐");
          const first = tracks[0];
          const ok = await playTrack(state, targetDevice, first, qm, lnClient);
          return ok
            ? { success: true, track_title: `[收藏] ${first.title}` }
            : { success: false, error: "speaker rejected play command" };
        }

        if (parsed.action === "play") {
          if (!parsed.keyword && !parsed.title) {
            if (parsed.targetScope === "whole_house") {
              logger.info("playback", "收到全屋背景音乐播放指令，正在从曲库拉取歌曲开启全屋背景漫游...");
              let libTracks = [...(await lnClient.getLibraryTracks(100))];
              if (!libTracks.length) {
                logger.warn("playback", "曲库中暂无可播放歌曲");
                return { success: false, error: "曲库中暂无可播放歌曲" };
              }
              for (let i = libTracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [libTracks[i], libTracks[j]] = [libTracks[j], libTracks[i]];
              }
              const first = qm.setQueue(libTracks, 0, "全屋背景音乐漫游");
              if (first) {
                const ok = await playTrack(state, targetDevice, first, qm, lnClient);
                return ok
                  ? { success: true, track_title: `[全屋背景漫游] ${first.title}` }
                  : { success: false, error: "speaker rejected play command" };
              }
            }
            logger.warn("playback", "点歌指令未包含有效歌名关键词");
            return { success: false, error: "missing search keyword" };
          }
          const rawKeyword = parsed.keyword || parsed.title || "";
          logger.info("playback", `正在 LyraNest 曲库中检索歌曲: "${rawKeyword}"`, {
            keyword: rawKeyword,
            artist: parsed.artist,
            title: parsed.title,
            search_limit: state.config.search_limit,
          });

          let tracks: LyraNestTrack[] = [];

          // 策略 1: 若包含限定词（如歌手 "周杰伦" + 歌名 "晴天"），优先联合匹配
          if (parsed.artist && parsed.title && parsed.artist !== rawKeyword) {
            try {
              const candidateTracks = await lnClient.searchTracks(parsed.title, 20);
              const artistLower = parsed.artist.toLowerCase();
              const exact = candidateTracks.filter((t) => (t.artist || "").toLowerCase().includes(artistLower));
              if (exact.length > 0) {
                logger.info("playback", `通过“歌手: ${parsed.artist} + 歌名: ${parsed.title}”精确定位到歌曲: "${exact[0].title}" (${exact[0].artist || "未知"})`);
                tracks = exact;
              }
            } catch (err) {
              logger.warn("playback", `限定词歌曲检索异常: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          // 策略 2: 直接以完整关键词搜索
          if (!tracks.length) {
            tracks = await lnClient.searchTracks(rawKeyword, state.config.search_limit);
          }

          // 策略 3: 启发式分词拆分（针对无连接词的复合词，如 "张学友吻别"、"刘德华忘情水"）
          if (!tracks.length && rawKeyword.length >= 4) {
            for (const prefixLen of [3, 2, 4]) {
              if (rawKeyword.length > prefixLen) {
                const pArtist = rawKeyword.slice(0, prefixLen);
                const pTitle = rawKeyword.slice(prefixLen);
                try {
                  const candidateTracks = await lnClient.searchTracks(pTitle, 10);
                  const matched = candidateTracks.filter((t) => (t.artist || "").toLowerCase().includes(pArtist.toLowerCase()));
                  if (matched.length > 0) {
                    logger.info("playback", `启发式拆分“歌手: ${pArtist} + 歌名: ${pTitle}”精确定位到歌曲: "${matched[0].title}" (${matched[0].artist || "未知"})`);
                    tracks = matched;
                    break;
                  }
                } catch {
                  // ignore
                }
              }
            }
          }

          if (!tracks.length) {
            logger.info("playback", `单曲搜索未找到 "${rawKeyword}"，正在尝试检索同名歌单或曲库...`);
            const plRes = await handlePlaylistPlayback(state, targetDevice, rawKeyword, true, qm, lnClient);
            if (plRes.success) return plRes;

            logger.warn("playback", `LyraNest 曲库中未找到与关键词 "${rawKeyword}" 匹配的歌曲、歌单或曲库`, {
              keyword: rawKeyword,
            });
            return { success: false, error: `no matching LyraNest track for "${rawKeyword}"` };
          }
          const targetTrack = tracks[0];
          let enrichedTracks = [...tracks];
          if (state.config.auto_continue_library) {
            try {
              const existingIds = new Set(enrichedTracks.map((t) => t.id));
              // 1. 同歌手其他歌曲漫游
              if (targetTrack.artist) {
                const artistTracks = await lnClient.searchTracks(targetTrack.artist, 30);
                for (const at of artistTracks) {
                  if (at.id && !existingIds.has(at.id)) {
                    existingIds.add(at.id);
                    enrichedTracks.push(at);
                  }
                }
              }
              // 2. 若队列仍然较短（< 20 首），从曲库拉取歌曲洗牌后扩充入队
              if (enrichedTracks.length < 20) {
                const libTracks = [...(await lnClient.getLibraryTracks(50))];
                for (let i = libTracks.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [libTracks[i], libTracks[j]] = [libTracks[j], libTracks[i]];
                }
                for (const lt of libTracks) {
                  if (lt.id && !existingIds.has(lt.id)) {
                    existingIds.add(lt.id);
                    enrichedTracks.push(lt);
                  }
                }
              }
            } catch (err) {
              logger.warn("playback", `单曲伴随漫游扩充异常: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          qm.setQueue(enrichedTracks, 0, `点播《${targetTrack.title}》伴随漫游`);
          logger.info("playback", `检索到匹配歌曲: "${targetTrack.title}" (已构建 ${enrichedTracks.length} 首连播队列)，准备播放`, {
            track_id: targetTrack.id,
            track_title: targetTrack.title,
            artist: targetTrack.artist,
            queue_count: enrichedTracks.length,
          });
          const ok = await playTrack(state, targetDevice, targetTrack, qm, lnClient);
          return ok
            ? { success: true, track_title: targetTrack.title }
            : { success: false, error: "speaker rejected play command" };
        }

        if (parsed.action === "resume") {
          const current = qm.current();
          if (current && !qm.isActive()) {
            logger.info("playback", `收到继续播放指令，恢复播放当前歌曲: "${current.title}"`);
            const ok = await playTrack(state, targetDevice, current, qm, lnClient);
            return ok
              ? { success: true, track_title: current.title }
              : { success: false, error: "speaker rejected play command" };
          }
          logger.info("playback", "向音箱下发播控操作: play (继续播放)");
          qm.setActive(true);
          playbackClock.resume(targetDevice.device_id);
          let accepted = false;
          if (state.spatialCoordinator?.isSpatialDeviceId(targetDevice.device_id)) {
            const res = await state.spatialCoordinator.controlGroup(
              state,
              state.spatialCoordinator.extractGroupId(targetDevice.device_id),
              "play",
            );
            accepted = res.success;
          } else {
            accepted = await withXiaomiSession(
              state,
              (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "play"),
            );
          }
          return accepted
            ? { success: true, track_title: current?.title }
            : { success: false, error: "speaker rejected resume operation" };
        }

        if (parsed.action === "next") {
          const nextTrack = await advanceQueueNextTrack(state, targetDevice, qm, lnClient);
          if (nextTrack) {
            logger.info("playback", `切换到下一首: "${nextTrack.title}" (${qm.getIndex() + 1}/${qm.size()}) [模式: ${qm.getMode()}]`);
            const ok = await playTrack(state, targetDevice, nextTrack, qm, lnClient);
            return ok
              ? { success: true, track_title: nextTrack.title }
              : { success: false, error: "speaker rejected play command" };
          }

          logger.info("playback", "队列已尽，向音箱下发硬件切歌指令: next");
          const accepted = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "next"),
          );
          return accepted
            ? { success: true }
            : { success: false, error: "speaker rejected next operation" };
        }

        if (parsed.action === "previous") {
          const prevTrack = qm.previous();
          if (prevTrack) {
            logger.info("playback", `切换到上一首: "${prevTrack.title}" (${qm.getIndex() + 1}/${qm.size()}) [模式: ${qm.getMode()}]`);
            const ok = await playTrack(state, targetDevice, prevTrack, qm, lnClient);
            return ok
              ? { success: true, track_title: prevTrack.title }
              : { success: false, error: "speaker rejected play command" };
          }

          logger.info("playback", "队列已在首曲，向音箱下发硬件切歌指令: prev");
          const accepted = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "prev"),
          );
          return accepted
            ? { success: true }
            : { success: false, error: "speaker rejected prev operation" };
        }

        if (parsed.action === "pause" || parsed.action === "stop") {
          qm.setActive(false);
          playbackClock.pause(targetDevice.device_id);
          const operation = parsed.action === "stop" ? "stop" : "pause";
          logger.info("playback", `向音箱下发播控操作: "${operation}"`);
          let accepted = false;
          if (state.spatialCoordinator?.isSpatialDeviceId(targetDevice.device_id)) {
            const res = await state.spatialCoordinator.controlGroup(
              state,
              state.spatialCoordinator.extractGroupId(targetDevice.device_id),
              operation,
            );
            accepted = res.success;
          } else {
            accepted = await withXiaomiSession(
              state,
              (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, operation),
            );
          }
          return accepted
            ? { success: true }
            : { success: false, error: `speaker rejected ${operation} operation` };
        }

        return { success: false, error: `unknown action: ${(parsed as ParsedCommand).action}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown command error";
        logger.error("playback", `指令执行失败: ${message}`, {
          action: parsed.action,
          keyword: parsed.keyword,
          error: message,
        });
        state.lastError = message;
        return { success: false, error: state.lastError };
      }
    },
    onAutoAdvance: async (devices) => {
      if (!state.config.enabled || !state.xiaomiTokens) return;
      const listToCheck = devices && devices.length > 0
        ? devices
        : (state.enabledDevices && state.enabledDevices.length > 0 ? state.enabledDevices : (state.selectedDevice ? [state.selectedDevice] : []));
      if (!listToCheck.length) return;

      const uniqueDevices = Array.from(new Map(listToCheck.map((d) => [d.device_id, d])).values());

      // F3: 语音交互冷却窗（20s 内）：禁止切歌，并在冷却期内清零所有设备的 idle 计数器，冷却结束后重新执行完整防抖
      if (state.lastVoiceInteractionAt && Date.now() - state.lastVoiceInteractionAt < VOICE_COOLDOWN_MS) {
        for (const dev of uniqueDevices) {
          deviceIdleCounts.delete(dev.device_id);
        }
        return;
      }

      for (const dev of uniqueDevices) {
        const qm = getQueueManager(state, dev.device_id);
        if (!qm.isActive()) continue;

        const currentTrack = qm.current();
        const trackDurationMs = currentTrack?.duration_ms && currentTrack.duration_ms > 0
          ? currentTrack.duration_ms
          : 0;

        // 若时钟未设置时长，则同步初始化
        if (trackDurationMs > 0 && playbackClock.getDurationMs(dev.device_id) <= 0) {
          playbackClock.start(dev.device_id, currentTrack?.id || "", trackDurationMs, currentTrack?.title);
        }

        const clockElapsed = playbackClock.getElapsedMs(dev.device_id);
        const wallElapsed = Date.now() - qm.getLastStartedAt();
        const elapsedMs = Math.max(clockElapsed, wallElapsed);

        // Ignore status during initial 6 seconds to allow audio buffering and speaker playback startup
        if (elapsedMs < 6000) continue;

        try {
          const proto = resolvePlaybackProtocol(state.config, dev.hardware, dev.device_id);
          const useMusicApi = proto === "play_music";
          const playStatus = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).getStatus(dev.device_id, useMusicApi),
          );
          if (!playStatus) continue;

          // 核心加固 1：虚拟播放时钟到点判断（带暂停冻结与异常短音频保护）
          // 仅在歌曲时长具有合理下限（>= 5000ms），且时钟处于播放中状态时触发，防止几百毫秒的损坏音频导致频繁切歌打崩音箱
          const isClockFinished = trackDurationMs >= 5000 &&
            (playbackClock.isFinished(dev.device_id, 500) || (playbackClock.isPlaying(dev.device_id) && elapsedMs >= trackDurationMs + 500));

          // Status === 1: 正在播放中（且虚拟时钟未到点），恢复/保持时钟走动，清空 idle 防抖计数与失败退避状态，确保 active 状态
          if (!isClockFinished && playStatus.status === 1) {
            playbackClock.resume(dev.device_id);
            deviceIdleCounts.delete(dev.device_id);
            deviceAdvanceFailures.delete(dev.device_id);
            qm.setActive(true);
            continue;
          }

          // F4: 连播失败退避检查，在退避期内不进行切歌尝试
          const failureState = deviceAdvanceFailures.get(dev.device_id);
          if (failureState && failureState.nextRetryAt > Date.now()) {
            continue;
          }

          if (!isClockFinished) {

            // Status === 2: 暂停中
            // 若已经播完大半（>=80% 时长），通常是音箱流播完暂停在末尾，允许进入播完流程
            // 仅在歌曲播放前中期（<80% 时长）读到 status=2 时视为人工暂停，【同步冻结时钟】并跳过
            const isNearTrackEnd = trackDurationMs > 0
              ? (elapsedMs >= Math.max(8000, trackDurationMs * 0.8) || (playStatus.position > 0 && playStatus.position >= trackDurationMs - 8000))
              : elapsedMs >= 20000;
            if (playStatus.status === 2 && !isNearTrackEnd) {
              playbackClock.pause(dev.device_id);
              deviceIdleCounts.delete(dev.device_id);
              continue;
            }

            // F2: 曲目身份核对（针对 play_music 机型）
            // 仅在音箱非空闲 (status !== 0) 且 audioId 匹配时，核对是否尚未播完；空闲 (status === 0) 时 audioId 为残留值，不阻断判完
            const lastAudioId = qm.getLastPushedAudioId();
            if (playStatus.status !== 0 && playStatus.audioId && lastAudioId && playStatus.audioId === lastAudioId) {
              const reachedEnd = (trackDurationMs > 0 && playStatus.position >= trackDurationMs - 8000) ||
                                 (trackDurationMs > 0 && elapsedMs >= trackDurationMs * 0.8) ||
                                 (trackDurationMs <= 0 && elapsedMs >= 20000);
              if (!reachedEnd) {
                deviceIdleCounts.delete(dev.device_id);
                continue;
              }
            }

            // F6: 时长判定与兜底下限
            let isFinished = false;
            if (trackDurationMs > 0) {
              const positionReached = playStatus.position > 0 && (
                playStatus.position >= trackDurationMs - 8000
              );
              const timeElapsedReached = elapsedMs >= Math.max(6000, trackDurationMs * 0.7);
              isFinished = positionReached || timeElapsedReached;
            } else if (playStatus.status === 0) {
              isFinished = elapsedMs >= 10000;
            } else {
              isFinished = elapsedMs >= 20000;
            }

            if (!isFinished) continue;

            // F1: 统一防抖，连续 IDLE_DEBOUNCE_COUNT 次确认
            const idleCount = (deviceIdleCounts.get(dev.device_id) || 0) + 1;
            deviceIdleCounts.set(dev.device_id, idleCount);
            if (idleCount < IDLE_DEBOUNCE_COUNT) {
              continue;
            }
          }

          deviceIdleCounts.delete(dev.device_id);

          const finishReason = isClockFinished ? "虚拟时钟到点(+500ms)" : `连续 ${IDLE_DEBOUNCE_COUNT} 次空闲确认`;
          logger.info("playback", `检测到设备 "${dev.name}" 当前歌曲已播放完毕 (${finishReason})，准备自动连播下一首...`, {
            device_id: dev.device_id,
            track_title: currentTrack?.title,
            elapsed_ms: elapsedMs,
            track_duration_ms: trackDurationMs,
            speaker_status: playStatus.status,
            clock_finished: isClockFinished,
          });

          const lnClient = getLyraNestClientForDevice(state, dev.device_id);
          const nextTrack = await advanceQueueNextTrack(state, dev, qm, lnClient);

          if (!nextTrack) {
            logger.info("playback", `设备 "${dev.name}" 播放队列已空，停止自动连播`, {
              device_id: dev.device_id,
            });
            qm.setActive(false);
            playbackClock.reset(dev.device_id);
            continue;
          }

          if (qm.getSource().startsWith("有声书:")) {
            const parts = qm.getSource().split(":");
            const bookId = parts[1];
            if (bookId && nextTrack.id) {
              void lnClient.updateBookProgress(bookId, nextTrack.id, 0).catch(() => undefined);
            }
          }

          logger.info("playback", `设备 "${dev.name}" 自动连播下一首: "${nextTrack.title}" (${qm.getIndex() + 1}/${qm.size()}) [模式: ${qm.getMode()}]`);

          // 首次推送
          let ok = await playTrack(state, dev, nextTrack, qm, lnClient);

          // F4: 重试。同一首连续失败 2 次视为流地址失效，强制刷新 mediaToken 重建流 URL
          if (!ok) {
            await new Promise((r) => setTimeout(r, 1500));
            lnClient.invalidateMediaToken();
            ok = await playTrack(state, dev, nextTrack, qm, lnClient);
          }

          // F4: fallback 曲目与失败曲目不得为同一首
          if (!ok) {
            logger.warn("playback", `设备 "${dev.name}" 连播歌曲 "${nextTrack.title}" 重试失败，尝试跳过该曲目播放下一首...`);
            const fallbackTrack = await advanceQueueNextTrack(state, dev, qm, lnClient);
            if (fallbackTrack && fallbackTrack.id !== nextTrack.id) {
              ok = await playTrack(state, dev, fallbackTrack, qm, lnClient);
            }
          }

          // F4: 连播结果与指数退避（熔断可恢复，不得永久停摆）
          if (ok) {
            deviceAdvanceFailures.delete(dev.device_id);
            deviceIdleCounts.delete(dev.device_id);
          } else {
            const prevFailures = deviceAdvanceFailures.get(dev.device_id)?.failureCount || 0;
            const newFailures = prevFailures + 1;
            if (newFailures <= MAX_AUTO_ADVANCE_FAILURES) {
              const backoffMs = BACKOFF_DELAYS_MS[newFailures - 1] || 120_000;
              deviceAdvanceFailures.set(dev.device_id, {
                failureCount: newFailures,
                nextRetryAt: Date.now() + backoffMs,
              });
              logger.warn("playback", `设备 "${dev.name}" 自动连播失败 (${newFailures}/${MAX_AUTO_ADVANCE_FAILURES})，进入退避重试 (将于 ${backoffMs / 1000}s 后重试)`, {
                device_id: dev.device_id,
                failure_count: newFailures,
                backoff_ms: backoffMs,
              });
            } else {
              logger.warn("playback", `设备 "${dev.name}" 连续连播失败已达上限 (${MAX_AUTO_ADVANCE_FAILURES}次)，暂时暂停看门狗连播`, {
                device_id: dev.device_id,
              });
              qm.setActive(false);
              deviceAdvanceFailures.delete(dev.device_id);
            }
          }
        } catch (err) {
          logger.warn("playback", `设备 "${dev.name}" 连播状态检测异常: ${err instanceof Error ? err.message : String(err)}`, {
            device_id: dev.device_id,
          });
        }
      }
    },
  });
}

export const deviceProtocolCache = new Map<string, "play_music" | "play_url">();

export function resolvePlaybackProtocol(
  config: BridgeConfig,
  hardware?: string,
  deviceId?: string,
): "play_music" | "play_url" {
  const binding = deviceId ? config.device_bindings?.[deviceId] : undefined;
  if (binding?.playback_protocol && binding.playback_protocol !== "auto") {
    return binding.playback_protocol;
  }
  if (config.playback_protocol && config.playback_protocol !== "auto") {
    return config.playback_protocol;
  }
  const profile = profileFor(hardware);
  if (profile.playbackProtocol && profile.playbackProtocol !== "auto") {
    return profile.playbackProtocol;
  }
  return profile.playByMusicUrl ? "play_music" : "play_url";
}

export function resolveTranscode(
  config: BridgeConfig,
  hardware?: string,
  deviceId?: string,
): string | undefined {
  const binding = deviceId ? config.device_bindings?.[deviceId] : undefined;
  if (binding?.transcode && binding.transcode !== "auto") {
    return binding.transcode === "never" ? undefined : binding.transcode;
  }
  if (config.transcode && config.transcode !== "auto") {
    return config.transcode === "never" ? undefined : config.transcode;
  }
  const profile = profileFor(hardware);
  if (profile.transcode && profile.transcode !== "never" && profile.transcode !== "auto") {
    return profile.transcode;
  }
  return undefined;
}

export async function playTrack(
  state: BridgeState,
  selectedDevice: XiaomiDevice,
  track: LyraNestTrack,
  queueMgr?: QueueManager,
  client?: LyraNestClient,
): Promise<boolean> {
  const lnClient = client || getLyraNestClientForDevice(state, selectedDevice.device_id);
  const qm = queueMgr || getQueueManager(state, selectedDevice.device_id);

  if (state.spatialCoordinator?.isSpatialDeviceId(selectedDevice.device_id)) {
    const groupId = state.spatialCoordinator.extractGroupId(selectedDevice.device_id);
    const group = state.spatialCoordinator.getGroup(groupId);
    if (group) {
      return await state.spatialCoordinator.playTrack(state, group, track, qm, lnClient);
    }
  }

  const mediaToken = await lnClient.getMediaToken();
  const transcode = resolveTranscode(state.config, selectedDevice.hardware, selectedDevice.device_id);
  const streamUrl = buildStreamUrl(state.config.speaker_base_url, track.id, mediaToken, transcode);
  const preferredProtocol = resolvePlaybackProtocol(state.config, selectedDevice.hardware, selectedDevice.device_id);

  // F2: 记录推送到音箱的曲目标识，供看门狗状态核对
  if (track.id) {
    qm.setLastPushedAudioId(deriveAudioId(track.id));
  }
  qm.setLastPushedTrackTitle(track.title);

  logger.info("playback", `音频流构建成功，正在向音箱下发播放指令 (首选协议: ${preferredProtocol}${transcode ? `, 转码: ${transcode}` : ""})`, {
    device_id: selectedDevice.device_id,
    device_name: selectedDevice.name,
    track_id: track.id,
    track_title: track.title,
    artist: track.artist,
    stream_url: sanitizeUrl(streamUrl),
    preferred_protocol: preferredProtocol,
    transcode: transcode || "original",
  });

  const playResult = await withXiaomiSession(
    state,
    (tokens) => new MinaClient(tokens).playByUrlWithFallback(
      selectedDevice.device_id,
      streamUrl,
      preferredProtocol,
      track.id,
    ),
  );

  if (playResult.ok) {
    deviceProtocolCache.set(selectedDevice.device_id, playResult.protocolUsed);
    qm.setActive(true);
    deviceAdvanceFailures.delete(selectedDevice.device_id);
    playbackClock.start(
      selectedDevice.device_id,
      track.id,
      track.duration_ms || 0,
      track.title,
      track.id ? deriveAudioId(track.id) : undefined,
    );
    logger.info("playback", `音箱已成功接受播放指令: "${track.title}" (生效协议: ${playResult.protocolUsed})`, {
      track_title: track.title,
      track_id: track.id,
      device_name: selectedDevice.name,
      protocol: playResult.protocolUsed,
    });
    return true;
  } else {
    logger.error("playback", `音箱拒绝了播放指令: "${track.title}" (播放下发失败)`, {
      track_title: track.title,
      track_id: track.id,
      device_name: selectedDevice.name,
      hardware: selectedDevice.hardware,
    });
    return false;
  }
}
