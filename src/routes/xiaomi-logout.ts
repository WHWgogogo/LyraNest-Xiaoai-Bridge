import type { RouteHandler } from "./router.js";
import { sendJson } from "./router.js";
import type { BridgeState } from "../index.js";

export function xiaomiLogout(state: BridgeState): RouteHandler {
  return async (_req, res) => {
    await state.xiaomiLogin.logout();
    sendJson(res, 200, { success: true });
  };
}
