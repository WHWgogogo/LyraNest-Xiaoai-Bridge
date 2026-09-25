import type { RouteHandler } from "./router.js";
import { sendJson, readJsonBody } from "./router.js";
import { isHttpUrl, saveConfig } from "../config.js";
import { restoreSelectedDevice, syncPoller } from "../runtime.js";
import type { BridgeConfig } from "../types.js";
import type { BridgeState } from "../index.js";

export function getConfig(state: BridgeState): RouteHandler {
  return (_req, res) => {
    const sanitized = { ...state.config };
    if (sanitized.device_bindings) {
      const bindings: Record<string, any> = {};
      for (const [did, b] of Object.entries(sanitized.device_bindings)) {
        bindings[did] = {
          device_id: b.device_id,
          enabled: b.enabled,
          lyranest_username: b.lyranest_username,
          has_password: Boolean(b.lyranest_password),
          playback_protocol: b.playback_protocol,
          transcode: b.transcode,
        };
      }
      sanitized.device_bindings = bindings as any;
    }
    sendJson(res, 200, sanitized);
  };
}

export function updateConfig(state: BridgeState): RouteHandler {
  return async (req, res) => {
    try {
      const body = await readJsonBody<Partial<BridgeConfig>>(req);
      validateUrlUpdate(body, "lyranest_base_url");
      validateUrlUpdate(body, "speaker_base_url");
      delete body.lyranest_username;

      if (body.device_bindings) {
        const mergedBindings = { ...(state.config.device_bindings || {}) };
        for (const [did, binding] of Object.entries(body.device_bindings)) {
          const prev = mergedBindings[did];
          mergedBindings[did] = {
            device_id: did,
            enabled: binding.enabled ?? prev?.enabled ?? true,
            lyranest_username: binding.lyranest_username ?? prev?.lyranest_username ?? "",
            lyranest_password:
              binding.lyranest_password !== undefined && binding.lyranest_password !== ""
                ? binding.lyranest_password
                : (prev?.lyranest_password ?? ""),
            playback_protocol: binding.playback_protocol !== undefined ? binding.playback_protocol : prev?.playback_protocol,
            transcode: binding.transcode !== undefined ? binding.transcode : prev?.transcode,
          };
        }
        body.device_bindings = mergedBindings;
      }

      const merged: BridgeConfig = { ...state.config, ...body };
      const enabling = body.enabled === true;
      if (merged.enabled && (!merged.lyranest_base_url || !merged.speaker_base_url)) {
        if (enabling) {
          sendJson(res, 409, { error: "lyranest_base_url and speaker_base_url are required before enabling" });
          return;
        }
        merged.enabled = false;
      }
      if (enabling && !state.lyraNest.hasPassword()) {
        sendJson(res, 409, { error: "LyraNest credentials are required before enabling" });
        return;
      }
      if (enabling && !state.xiaomiTokens) {
        sendJson(res, 409, { error: "Xiaomi login is required before enabling" });
        return;
      }
      if (
        enabling &&
        !merged.selected_device_id &&
        (!merged.enabled_device_ids || merged.enabled_device_ids.length === 0)
      ) {
        sendJson(res, 409, { error: "a Xiaomi speaker must be selected before enabling" });
        return;
      }
      state.config = await saveConfig(merged);
      state.lyraNest.updateBaseUrl(state.config.lyranest_base_url);
      state.lyraNestClients.clear();
      await restoreSelectedDevice(state);
      if (state.config.enabled && !state.selectedDevice && state.enabledDevices.length === 0) {
        state.config = await saveConfig({ enabled: false });
        sendJson(res, 409, { error: "selected Xiaomi speaker is unavailable; Bridge remains disabled" });
        return;
      }
      syncPoller(state);
      sendJson(res, 200, state.config);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "invalid request" });
    }
  };
}

export function validateUrlUpdate(update: Partial<BridgeConfig>, field: "lyranest_base_url" | "speaker_base_url"): void {
  const value = update[field];
  if (value === undefined || value === "") return;
  if (!isHttpUrl(value)) {
    throw new Error(`${field} must be an HTTP or HTTPS URL`);
  }
}
