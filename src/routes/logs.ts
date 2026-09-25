import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteHandler } from "./router.js";
import { logger } from "../logger.js";
import type { BridgeState } from "../index.js";

function formatTimestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${m}${d}-${h}${min}${s}`;
}

export function exportLogs(state: BridgeState): RouteHandler {
  return (req: IncomingMessage, res: ServerResponse) => {
    let hours = 1;
    if (req.url) {
      try {
        const parsedUrl = new URL(req.url, "http://localhost");
        const hoursParam = parsedUrl.searchParams.get("hours");
        if (hoursParam) {
          const parsedHours = Number.parseFloat(hoursParam);
          if (!Number.isNaN(parsedHours) && parsedHours > 0) {
            hours = Math.min(parsedHours, 72); // Max 72 hours
          }
        }
      } catch {
        // ignore url parse error
      }
    }

    const envInfo: Record<string, unknown> = {
      bridge_version: state.version || "unknown",
      node_runtime: process.version,
      platform: `${process.platform} (${process.arch})`,
      runtime_mode: process.env.BRIDGE_RUNTIME || "native",
      uptime_seconds: Math.floor((Date.now() - (state.startTime || Date.now())) / 1000),
      xiaomi_login_state: state.xiaomiTokens ? "authenticated" : "not_logged_in",
      xiaomi_user_id: state.xiaomiTokens?.user_id || "none",
      selected_device: state.selectedDevice
        ? `${state.selectedDevice.name} (${state.selectedDevice.device_id}, hardware: ${state.selectedDevice.hardware})`
        : "none",
      enabled_devices_count: state.enabledDevices?.length ?? 0,
      all_devices_count: state.allDevices?.length ?? 0,
      lyranest_base_url: state.config?.lyranest_base_url || "not_configured",
      speaker_base_url: state.config?.speaker_base_url || "not_configured",
      last_error: state.lastError || "none",
    };

    const formattedLog = logger.formatExport(envInfo, hours);
    const filename = `lyranest-bridge-log-${formatTimestampForFilename(new Date())}.txt`;

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": Buffer.byteLength(formattedLog, "utf8"),
      "Cache-Control": "no-store",
    });
    res.end(formattedLog);
  };
}
