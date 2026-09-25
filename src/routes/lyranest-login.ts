import type { RouteHandler } from "./router.js";
import { readJsonBody, sendJson } from "./router.js";
import { saveConfig, isHttpUrl } from "../config.js";
import type { BridgeState } from "../index.js";
import type { BridgeConfig } from "../types.js";

interface LyraNestLoginRequest {
  base_url?: string;
  lyranest_base_url?: string;
  username?: string;
  password?: string;
}

export function lyraNestLogin(state: BridgeState): RouteHandler {
  return async (req, res) => {
    try {
      const body = await readJsonBody<LyraNestLoginRequest>(req);
      const reqUrl = (body.base_url || body.lyranest_base_url || "").trim();
      const targetBaseUrl = reqUrl || state.config.lyranest_base_url;
      if (reqUrl) {
        if (!isHttpUrl(reqUrl)) {
          sendJson(res, 400, { error: "lyranest_base_url must be an HTTP or HTTPS URL" });
          return;
        }
        state.lyraNest.updateBaseUrl(reqUrl);
      }

      const username = (body.username ?? state.lyraNest.getUsername() ?? state.config.lyranest_username ?? "").trim();
      if (!username || !targetBaseUrl) {
        sendJson(res, 400, { error: "LyraNest base URL and username are required" });
        return;
      }

      const password = body.password ? body.password : state.lyraNest.getPassword();
      if (!password) {
        sendJson(res, 400, { error: "password is required" });
        return;
      }

      await state.lyraNest.verifyCredentials(username, password);

      const configUpdate: Partial<BridgeConfig> = { lyranest_username: username };
      if (reqUrl) {
        configUpdate.lyranest_base_url = reqUrl;
      }
      state.config = await saveConfig(configUpdate);

      if (state.lyraNestStore) {
        await state.lyraNestStore.save({
          username,
          password,
          session_token: state.lyraNest.getSessionToken(),
        });
      }

      state.lastError = "";
      sendJson(res, 200, {
        success: true,
        lyranest_connected: await state.lyraNest.isConnected(),
        lyranest_username: username,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LyraNest login failed";
      state.lastError = message;
      sendJson(res, 401, { success: false, error: message });
    }
  };
}
