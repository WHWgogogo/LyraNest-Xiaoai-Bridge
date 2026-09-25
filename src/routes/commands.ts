import type { RouteHandler } from "./router.js";
import { sendJson } from "./router.js";
import type { BridgeState } from "../index.js";

export function commands(state: BridgeState): RouteHandler {
  return (_req, res) => {
    sendJson(res, 200, { commands: state.poller.getHistory() });
  };
}
