import type { RouteHandler } from "./router.js";
import { sendJson } from "./router.js";
import { mapDevices } from "../xiaomi/device-manager.js";
import { MinaClient } from "../xiaomi/mina-client.js";
import { withXiaomiSession } from "../xiaomi/with-session.js";
import { getQueueManager, resolvePlaybackProtocol, resolveTranscode } from "../runtime.js";
import { profileFor } from "../types.js";
import type { BridgeState } from "../index.js";

export function devices(state: BridgeState): RouteHandler {
  return async (req, res) => {
    if (!state.xiaomiTokens) {
      sendJson(res, 409, { error: "not logged in to Xiaomi" });
      return;
    }
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const queryUser = url.searchParams.get("username");
      const headerUser = req?.headers?.["x-lyranest-username"];
      const headerVal = typeof headerUser === "string" ? headerUser : (Array.isArray(headerUser) ? headerUser[0] : undefined);
      const username = (headerVal && headerVal.trim()) || (queryUser && queryUser.trim()) || undefined;
      const trimmedUsername = username ? username.toLowerCase() : undefined;

      const raw = await withXiaomiSession(state, (tokens) => new MinaClient(tokens).getDevices());
      const mapped = mapDevices(raw);
      state.allDevices = mapped;

      const enabledIds = new Set(
        Array.isArray(state.config.enabled_device_ids) && state.config.enabled_device_ids.length > 0
          ? state.config.enabled_device_ids
          : (state.config.selected_device_id ? [state.config.selected_device_id] : []),
      );

      const enhanced = mapped.map((d) => {
        const qm = getQueueManager(state, d.device_id);
        const binding = state.config.device_bindings?.[d.device_id];
        const effectiveProtocol = resolvePlaybackProtocol(state.config, d.hardware, d.device_id);
        const effectiveTranscode = resolveTranscode(state.config, d.hardware, d.device_id) || "original";
        const hasCustomAuth = Boolean(binding?.enabled && binding?.lyranest_username);
        const boundUser = (hasCustomAuth && binding?.lyranest_username) ? binding.lyranest_username : "";
        const isUserDevice = trimmedUsername
          ? Boolean(hasCustomAuth && boundUser.trim().toLowerCase() === trimmedUsername)
          : false;
        return {
          ...d,
          enabled: enabledIds.has(d.device_id),
          is_selected: d.device_id === state.config.selected_device_id,
          lyranest_username: boundUser,
          has_custom_account: hasCustomAuth,
          is_user_device: isUserDevice,
          is_playing: qm.isActive(),
          current_track: qm.current(),
          play_mode: qm.getMode(),
          playback_protocol: binding?.playback_protocol || "auto",
          effective_protocol: effectiveProtocol,
          transcode: binding?.transcode || "auto",
          effective_transcode: effectiveTranscode,
        };
      });

      const spatialGroups = state.spatialCoordinator ? state.spatialCoordinator.getGroups() : [];
      const spatialDevices = spatialGroups.filter((g) => g.enabled).map((g) => {
        const v = state.spatialCoordinator!.toVirtualDevice(g);
        const qm = getQueueManager(state, v.device_id);
        return {
          ...v,
          enabled: true,
          is_selected: v.device_id === state.config.selected_device_id,
          lyranest_username: "",
          has_custom_account: false,
          is_user_device: false,
          is_playing: qm.isActive(),
          current_track: qm.current(),
          play_mode: qm.getMode(),
          is_spatial_group: true,
          spatial_group_id: g.id,
        };
      });

      const combinedDevices = [...enhanced, ...spatialDevices];
      const userDevice = trimmedUsername ? combinedDevices.find((d) => d.is_user_device) : undefined;

      sendJson(res, 200, {
        devices: combinedDevices,
        selected_device_id: state.config.selected_device_id,
        user_device_id: userDevice ? userDevice.device_id : null,
        enabled_device_ids: Array.from(enabledIds),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to fetch Xiaomi devices";
      state.lastError = message;
      sendJson(res, 502, { error: message });
    }
  };
}
