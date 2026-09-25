import type { RouteHandler } from "./router.js";
import { sendJson } from "./router.js";
import type { BridgeState } from "../index.js";

export function status(state: BridgeState): RouteHandler {
  return async (_req, res) => {
    const xiaomiStatus = state.xiaomiLogin.getStatus();
    const loginError = xiaomiStatus.state === "failed" || xiaomiStatus.state === "reauth_required"
      ? xiaomiStatus.message ?? ""
      : "";
    sendJson(res, 200, {
      version: state.version,
      enabled: state.config.enabled,
      lyranest_connected: await state.lyraNest.isConnected(),
      lyranest_authenticated: state.lyraNest.hasPassword(),
      lyranest_username: state.lyraNest.getUsername(),
      xiaomi_logged_in: xiaomiStatus.state === "authenticated",
      xiaomi_login_state: xiaomiStatus.state,
      xiaomi_login_message: xiaomiStatus.message,
      xiaomi_verification_method: xiaomiStatus.verification_method,
      configured_device_id: state.config.selected_device_id,
      selected_device_name: state.selectedDevice?.name ?? (state.enabledDevices?.[0]?.name || ""),
      enabled_device_count: state.enabledDevices?.length || (state.selectedDevice ? 1 : 0),
      enabled_device_ids: state.enabledDevices?.map((d) => d.device_id) || (state.selectedDevice ? [state.selectedDevice.device_id] : []),
      last_error: state.lastError || loginError,
      uptime_sec: Math.floor((Date.now() - state.startTime) / 1000),
    });
  };
}
