import type { RouteHandler } from "./router.js";
import { sendJson, readJsonBody } from "./router.js";
import { playTrack, getQueueManager, getLyraNestClientForDevice, resolveDevice, advanceQueueNextTrack, deviceProtocolCache, resolvePlaybackProtocol } from "../runtime.js";
import { playbackClock } from "../playback/playback-clock.js";
import { MinaClient } from "../xiaomi/mina-client.js";
import { withXiaomiSession } from "../xiaomi/with-session.js";
import { profileFor, type LyraNestTrack } from "../types.js";
import type { BridgeState } from "../index.js";
import { logger } from "../logger.js";

function extractUsername(req: import("http").IncomingMessage, fallbackUser?: string): string | undefined {
  const header = req?.headers?.["x-lyranest-username"];
  const headerVal = typeof header === "string" ? header : (Array.isArray(header) ? header[0] : undefined);
  return (headerVal && headerVal.trim()) || (fallbackUser && fallbackUser.trim()) || undefined;
}

interface PlayRequest {
  device_id?: string;
  username?: string;
  track_id?: string;
  track?: LyraNestTrack;
  keyword?: string;
  url?: string;
}

interface QueueRequest {
  device_id?: string;
  username?: string;
  playlist_id?: string;
  playlist_name?: string;
  track_ids?: string[];
  tracks?: LyraNestTrack[];
  start_index?: number;
  queue_name?: string;
}

interface ControlRequest {
  device_id?: string;
  username?: string;
  action: "play" | "pause" | "stop" | "next" | "previous" | "shuffle" | "mode" | "volume";
  mode?: "sequence" | "loop" | "shuffle" | "single_loop";
  volume?: number;
  delta?: number;
}

export function playerPlay(state: BridgeState): RouteHandler {
  return async (req, res) => {
    try {
      if (!state.xiaomiTokens) {
        sendJson(res, 409, { error: "Xiaomi session is not available" });
        return;
      }
      const body = await readJsonBody<PlayRequest>(req);
      const username = extractUsername(req, body.username);
      const targetDevice = resolveDevice(state, body.device_id, username);
      if (!targetDevice) {
        sendJson(res, 404, {
          error: body.device_id
            ? `device "${body.device_id}" not found or not available`
            : "no speaker device is available",
        });
        return;
      }
      const qm = getQueueManager(state, targetDevice.device_id);
      const lnClient = getLyraNestClientForDevice(state, targetDevice.device_id);

      let targetTrack: LyraNestTrack | null = null;

      if (body.track && body.track.id) {
        targetTrack = body.track;
        qm.setQueue([targetTrack], 0, `单曲推送《${targetTrack.title}》`);
      } else if (body.track_id) {
        const fetched = await lnClient.getTracksByIds([body.track_id]);
        if (!fetched.length) {
          sendJson(res, 404, { error: `track with id "${body.track_id}" not found` });
          return;
        }
        targetTrack = fetched[0];
        qm.setQueue([targetTrack], 0, `单曲推送《${targetTrack.title}》`);
      } else if (body.keyword) {
        const searched = await lnClient.searchTracks(body.keyword, state.config.search_limit);
        if (!searched.length) {
          sendJson(res, 404, { error: `no track found for keyword "${body.keyword}"` });
          return;
        }
        qm.setQueue(searched, 0, `点播《${body.keyword}》`);
        targetTrack = searched[0];
      } else if (body.url) {
        const preferredProtocol = resolvePlaybackProtocol(state.config, targetDevice.hardware, targetDevice.device_id);
        const ok = await withXiaomiSession(
          state,
          (tokens) => new MinaClient(tokens).playByUrl(targetDevice.device_id, body.url!, preferredProtocol),
        );
        qm.clear();
        if (ok) {
          sendJson(res, 200, {
            success: true,
            stream_url: body.url,
            device_id: targetDevice.device_id,
            device: targetDevice.name,
          });
        } else {
          sendJson(res, 502, { error: "speaker rejected direct stream url" });
        }
        return;
      } else {
        sendJson(res, 400, { error: "track_id, track, keyword, or url is required" });
        return;
      }

      if (!targetTrack) {
        sendJson(res, 404, { error: "target track could not be resolved" });
        return;
      }

      const ok = await playTrack(state, targetDevice, targetTrack, qm, lnClient);
      if (ok) {
        sendJson(res, 200, {
          success: true,
          track: targetTrack,
          device_id: targetDevice.device_id,
          device: targetDevice.name,
        });
      } else {
        sendJson(res, 502, { error: "speaker rejected play command" });
      }
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "play request failed" });
    }
  };
}

export function playerQueue(state: BridgeState): RouteHandler {
  return async (req, res) => {
    try {
      if (!state.xiaomiTokens) {
        sendJson(res, 409, { error: "Xiaomi session is not available" });
        return;
      }
      const body = await readJsonBody<QueueRequest>(req);
      const username = extractUsername(req, body.username);
      const targetDevice = resolveDevice(state, body.device_id, username);
      if (!targetDevice) {
        sendJson(res, 404, {
          error: body.device_id
            ? `device "${body.device_id}" not found or not available`
            : "no speaker device is available",
        });
        return;
      }
      const qm = getQueueManager(state, targetDevice.device_id);
      const lnClient = getLyraNestClientForDevice(state, targetDevice.device_id);

      let tracks: LyraNestTrack[] = [];
      let queueName = body.queue_name || "外部推送队列";

      if (body.playlist_id || body.playlist_name) {
        const collections = await lnClient.getCollections();
        const pl = collections.playlists.find(
          (p) => p.id === body.playlist_id || p.name.toLowerCase() === (body.playlist_name || "").toLowerCase(),
        );
        if (!pl || !pl.track_ids?.length) {
          sendJson(res, 404, { error: "playlist not found or is empty" });
          return;
        }
        queueName = `歌单《${pl.name}》`;
        tracks = await lnClient.getTracksByIds(pl.track_ids);
      } else if (Array.isArray(body.track_ids) && body.track_ids.length > 0) {
        tracks = await lnClient.getTracksByIds(body.track_ids);
      } else if (Array.isArray(body.tracks) && body.tracks.length > 0) {
        const validTracks = body.tracks.filter((t) => t && t.id);
        const missingDuration = validTracks.some((t) => !t.duration_ms || t.duration_ms <= 0);
        if (missingDuration && validTracks.length > 0) {
          try {
            const fetched = await lnClient.getTracksByIds(validTracks.map((t) => t.id));
            const fetchedMap = new Map(fetched.map((f) => [f.id, f]));
            tracks = validTracks.map((t) => {
              const full = fetchedMap.get(t.id);
              return {
                ...t,
                duration_ms: (t.duration_ms && t.duration_ms > 0) ? t.duration_ms : (full?.duration_ms || 0),
                artist: t.artist || full?.artist,
                album: t.album || full?.album,
              };
            });
          } catch {
            tracks = validTracks;
          }
        } else {
          tracks = validTracks;
        }
      } else {
        sendJson(res, 400, { error: "playlist_id, track_ids, or tracks is required" });
        return;
      }

      if (!tracks.length) {
        sendJson(res, 404, { error: "queue tracks could not be loaded or is empty" });
        return;
      }

      const startIndex = Math.max(0, Math.min(body.start_index ?? 0, tracks.length - 1));
      qm.setQueue(tracks, startIndex, queueName);
      const current = qm.current();

      if (!current) {
        sendJson(res, 500, { error: "failed to select start track from queue" });
        return;
      }

      const ok = await playTrack(state, targetDevice, current, qm, lnClient);
      if (ok) {
        sendJson(res, 200, {
          success: true,
          queue_name: queueName,
          count: tracks.length,
          start_index: startIndex,
          current_track: current,
          device_id: targetDevice.device_id,
          device: targetDevice.name,
        });
      } else {
        sendJson(res, 502, { error: "speaker rejected queue playback" });
      }
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "queue request failed" });
    }
  };
}

export function playerControl(state: BridgeState): RouteHandler {
  return async (req, res) => {
    try {
      if (!state.xiaomiTokens) {
        sendJson(res, 409, { error: "Xiaomi session is not available" });
        return;
      }
      const body = await readJsonBody<ControlRequest>(req);
      const username = extractUsername(req, body.username);
      const targetDevice = resolveDevice(state, body.device_id, username);
      if (!targetDevice) {
        sendJson(res, 404, {
          error: body.device_id
            ? `device "${body.device_id}" not found or not available`
            : "no speaker device is available",
        });
        return;
      }
      const qm = getQueueManager(state, targetDevice.device_id);
      const lnClient = getLyraNestClientForDevice(state, targetDevice.device_id);
      const action = body.action;

      if (action === "next") {
        const nextTrack = await advanceQueueNextTrack(state, targetDevice, qm, lnClient);
        if (nextTrack) {
          const ok = await playTrack(state, targetDevice, nextTrack, qm, lnClient);
          sendJson(res, ok ? 200 : 502, {
            success: ok,
            action: "next",
            current_track: nextTrack,
            device_id: targetDevice.device_id,
          });
        } else {
          const ok = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "next"),
          );
          sendJson(res, ok ? 200 : 502, { success: ok, action: "next", device_id: targetDevice.device_id });
        }
        return;
      }

      if (action === "previous") {
        const prevTrack = qm.previous();
        if (prevTrack) {
          const ok = await playTrack(state, targetDevice, prevTrack, qm, lnClient);
          sendJson(res, ok ? 200 : 502, {
            success: ok,
            action: "previous",
            current_track: prevTrack,
            device_id: targetDevice.device_id,
          });
        } else {
          const ok = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "prev"),
          );
          sendJson(res, ok ? 200 : 502, { success: ok, action: "previous", device_id: targetDevice.device_id });
        }
        return;
      }

      if (action === "pause") {
        qm.setActive(false);
        playbackClock.pause(targetDevice.device_id);
        let ok = false;
        if (state.spatialCoordinator?.isSpatialDeviceId(targetDevice.device_id)) {
          const res = await state.spatialCoordinator.controlGroup(
            state,
            state.spatialCoordinator.extractGroupId(targetDevice.device_id),
            "pause",
          );
          ok = res.success;
        } else {
          ok = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "pause"),
          ).catch(() => false);
        }
        sendJson(res, 200, { success: true, action: "pause", speaker_accepted: ok, device_id: targetDevice.device_id });
        return;
      }

      if (action === "stop") {
        qm.setActive(false);
        playbackClock.pause(targetDevice.device_id);
        let ok = false;
        if (state.spatialCoordinator?.isSpatialDeviceId(targetDevice.device_id)) {
          const res = await state.spatialCoordinator.controlGroup(
            state,
            state.spatialCoordinator.extractGroupId(targetDevice.device_id),
            "stop",
          );
          ok = res.success;
        } else {
          ok = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "stop"),
          ).catch(() => false);
        }
        sendJson(res, ok ? 200 : 502, { success: ok, action: "stop", device_id: targetDevice.device_id });
        return;
      }

      if (action === "play") {
        const current = qm.current();
        if (current && !qm.isActive()) {
          const ok = await playTrack(state, targetDevice, current, qm, lnClient);
          sendJson(res, ok ? 200 : 502, {
            success: ok,
            action: "play",
            current_track: current,
            device_id: targetDevice.device_id,
          });
        } else {
          let ok = false;
          if (state.spatialCoordinator?.isSpatialDeviceId(targetDevice.device_id)) {
            const res = await state.spatialCoordinator.controlGroup(
              state,
              state.spatialCoordinator.extractGroupId(targetDevice.device_id),
              "play",
            );
            ok = res.success;
          } else {
            ok = await withXiaomiSession(
              state,
              (tokens) => new MinaClient(tokens).playOperation(targetDevice.device_id, "play"),
            ).catch(() => false);
          }
          qm.setActive(true);
          playbackClock.resume(targetDevice.device_id);
          sendJson(res, ok ? 200 : 502, {
            success: ok,
            action: "play",
            current_track: current,
            device_id: targetDevice.device_id,
          });
        }
        return;
      }

      if (action === "shuffle") {
        qm.setMode("shuffle");
        qm.shuffle();
        const current = qm.current();
        sendJson(res, 200, {
          success: true,
          action: "shuffle",
          current_track: current,
          mode: qm.getMode(),
          device_id: targetDevice.device_id,
        });
        return;
      }

      if (action === "mode" && body.mode) {
        qm.setMode(body.mode);
        sendJson(res, 200, {
          success: true,
          action: "mode",
          mode: qm.getMode(),
          device_id: targetDevice.device_id,
        });
        return;
      }

      if (action === "volume") {
        let targetVolume = body.volume;
        if (targetVolume === undefined && body.delta !== undefined) {
          let curVol = 50;
          try {
            const status = await withXiaomiSession(
              state,
              (tokens) => new MinaClient(tokens).getStatus(targetDevice.device_id),
            );
            if (status && typeof status.volume === "number") {
              curVol = status.volume;
            }
          } catch {
            // fallback to default 50
          }
          targetVolume = curVol + body.delta;
        }

        if (targetVolume === undefined) {
          sendJson(res, 400, { error: "volume or delta is required when action is 'volume'" });
          return;
        }

        const clamped = Math.max(0, Math.min(100, Math.round(targetVolume)));
        let ok = false;
        if (state.spatialCoordinator?.isSpatialDeviceId(targetDevice.device_id)) {
          const res = await state.spatialCoordinator.setGroupVolume(
            state,
            state.spatialCoordinator.extractGroupId(targetDevice.device_id),
            clamped,
          );
          ok = res.success;
        } else {
          ok = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).setVolume(targetDevice.device_id, clamped),
          ).catch(() => false);
        }

        sendJson(res, ok ? 200 : 502, {
          success: ok,
          action: "volume",
          volume: clamped,
          device_id: targetDevice.device_id,
        });
        return;
      }

      sendJson(res, 400, { error: `unsupported action: ${action}` });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "control request failed" });
    }
  };
}

interface VolumeRequest {
  device_id?: string;
  username?: string;
  volume?: number;
  delta?: number;
}

export function playerVolume(state: BridgeState): RouteHandler {
  return async (req, res) => {
    try {
      if (!state.xiaomiTokens) {
        sendJson(res, 409, { error: "Xiaomi session is not available" });
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const username = extractUsername(req, url.searchParams.get("username") || undefined);

      if (req.method === "GET") {
        const deviceId = url.searchParams.get("device_id") || undefined;
        const targetDevice = resolveDevice(state, deviceId, username);
        if (!targetDevice) {
          sendJson(res, 404, {
            error: deviceId ? `device "${deviceId}" not found` : "no speaker device is available",
          });
          return;
        }

        const status = await withXiaomiSession(
          state,
          (tokens) => new MinaClient(tokens).getStatus(targetDevice.device_id),
        ).catch(() => null);

        const volume = status?.volume ?? 50;
        sendJson(res, 200, {
          success: true,
          device_id: targetDevice.device_id,
          device: targetDevice.name,
          volume,
        });
        return;
      }

      if (req.method === "POST") {
        const body = await readJsonBody<VolumeRequest>(req);
        const effectiveUser = extractUsername(req, body.username) || username;
        const targetDevice = resolveDevice(state, body.device_id, effectiveUser);
        if (!targetDevice) {
          sendJson(res, 404, {
            error: body.device_id ? `device "${body.device_id}" not found` : "no speaker device is available",
          });
          return;
        }

        let targetVolume = body.volume;
        if (targetVolume === undefined && body.delta !== undefined) {
          let curVol = 50;
          try {
            const status = await withXiaomiSession(
              state,
              (tokens) => new MinaClient(tokens).getStatus(targetDevice.device_id),
            );
            if (status && typeof status.volume === "number") {
              curVol = status.volume;
            }
          } catch {
            // fallback to default 50
          }
          targetVolume = curVol + body.delta;
        }

        if (targetVolume === undefined) {
          sendJson(res, 400, { error: "volume or delta is required" });
          return;
        }

        const clamped = Math.max(0, Math.min(100, Math.round(targetVolume)));
        let ok = false;
        if (state.spatialCoordinator?.isSpatialDeviceId(targetDevice.device_id)) {
          const res = await state.spatialCoordinator.setGroupVolume(
            state,
            state.spatialCoordinator.extractGroupId(targetDevice.device_id),
            clamped,
          );
          ok = res.success;
        } else {
          ok = await withXiaomiSession(
            state,
            (tokens) => new MinaClient(tokens).setVolume(targetDevice.device_id, clamped),
          ).catch(() => false);
        }

        sendJson(res, ok ? 200 : 502, {
          success: ok,
          device_id: targetDevice.device_id,
          device: targetDevice.name,
          volume: clamped,
        });
        return;
      }

      sendJson(res, 405, { error: "Method Not Allowed" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "volume request failed" });
    }
  };
}

export function playerStatus(state: BridgeState): RouteHandler {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const deviceId = url.searchParams.get("device_id") || undefined;
    const username = extractUsername(req, url.searchParams.get("username") || undefined);

    if (deviceId) {
      const targetDevice = resolveDevice(state, deviceId, username);
      if (!targetDevice) {
        sendJson(res, 404, { error: `device "${deviceId}" not found` });
        return;
      }
      const qm = getQueueManager(state, targetDevice.device_id);
      const binding = state.config.device_bindings?.[targetDevice.device_id];
      const devUsername = (binding?.enabled && binding.lyranest_username) || state.config.lyranest_username;
      sendJson(res, 200, {
        active: qm.isActive(),
        play_mode: qm.getMode(),
        current_track: qm.current(),
        current_index: qm.getIndex(),
        queue_size: qm.size(),
        queue_source: qm.getSource(),
        has_more: qm.hasMore(),
        device: {
          device_id: targetDevice.device_id,
          name: targetDevice.name,
          hardware: targetDevice.hardware,
        },
        lyranest_username: devUsername,
        is_user_device: username ? (devUsername?.trim().toLowerCase() === username.trim().toLowerCase()) : false,
      });
      return;
    }

    const effectiveDevice = username ? resolveDevice(state, undefined, username) : state.selectedDevice;
    const primaryQm = effectiveDevice
      ? getQueueManager(state, effectiveDevice.device_id)
      : (state.selectedDevice ? getQueueManager(state, state.selectedDevice.device_id) : state.queueManager);

    const enabledList = state.enabledDevices && state.enabledDevices.length > 0
      ? state.enabledDevices
      : (state.selectedDevice ? [state.selectedDevice] : []);

    const devicesStatus = enabledList.map((dev) => {
      const qm = getQueueManager(state, dev.device_id);
      const binding = state.config.device_bindings?.[dev.device_id];
      const devUsername = (binding?.enabled && binding.lyranest_username) || state.config.lyranest_username;
      const isUserDevice = username ? (devUsername?.trim().toLowerCase() === username.trim().toLowerCase()) : false;
      return {
        device_id: dev.device_id,
        name: dev.name,
        hardware: dev.hardware,
        active: qm.isActive(),
        play_mode: qm.getMode(),
        current_track: qm.current(),
        current_index: qm.getIndex(),
        queue_size: qm.size(),
        queue_source: qm.getSource(),
        has_more: qm.hasMore(),
        lyranest_username: devUsername,
        is_user_device: isUserDevice,
      };
    });

    const userDevice = username ? devicesStatus.find((d) => d.is_user_device) : undefined;

    sendJson(res, 200, {
      active: primaryQm.isActive(),
      play_mode: primaryQm.getMode(),
      current_track: primaryQm.current(),
      current_index: primaryQm.getIndex(),
      queue_size: primaryQm.size(),
      queue_source: primaryQm.getSource(),
      has_more: primaryQm.hasMore(),
      selected_device: state.selectedDevice ? {
        device_id: state.selectedDevice.device_id,
        name: state.selectedDevice.name,
        hardware: state.selectedDevice.hardware,
      } : null,
      user_device_id: userDevice ? userDevice.device_id : null,
      devices: devicesStatus,
    });
  };
}
