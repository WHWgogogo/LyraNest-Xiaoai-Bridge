import type { RouteHandler } from "./router.js";
import { readJsonBody, sendJson } from "./router.js";
import type { BridgeState } from "../index.js";

interface AccessTokenSetupRequest {
  access_token?: string;
}

export function accessBootstrap(state: BridgeState): RouteHandler {
  return (_req, res) => {
    sendJson(res, 200, { setup_required: state.accessControl.needsSetup() });
  };
}

export function setupAccessToken(state: BridgeState): RouteHandler {
  return updateAccessToken(state, 201);
}

export function changeAccessToken(state: BridgeState): RouteHandler {
  return updateAccessToken(state, 200);
}

function updateAccessToken(state: BridgeState, successStatus: 200 | 201): RouteHandler {
  return async (req, res) => {
    try {
      const body = await readJsonBody<AccessTokenSetupRequest>(req);
      if (successStatus === 201) await state.accessControl.setup(body.access_token ?? "");
      else await state.accessControl.change(body.access_token ?? "");
      sendJson(res, successStatus, { success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "access token setup failed";
      const status = message === "access token is already configured" || message === "access token is managed by BRIDGE_ACCESS_TOKEN"
        ? 409
        : 400;
      sendJson(res, status, { error: message });
    }
  };
}
