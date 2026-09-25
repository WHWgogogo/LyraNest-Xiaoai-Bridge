import type { RouteHandler } from "./router.js";
import { sendJson } from "./router.js";
import type { BridgeState } from "../index.js";

export function login(state: BridgeState): RouteHandler {
  return (_req, res) => {
    state.lastError = "旧登录接口已停用，请使用 /api/xiaomi/login/password";
    sendJson(res, 410, { error: state.lastError });
  };
}
