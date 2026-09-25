import type { RouteHandler } from "./router.js";
import { sendJson } from "./router.js";

export function healthz(state: { version: string }): RouteHandler {
  return (_req, res) => {
    sendJson(res, 200, { status: "ok", version: state.version });
  };
}
