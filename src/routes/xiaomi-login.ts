import type { BridgeState } from "../index.js";
import type { RouteHandler } from "./router.js";
import { readJsonBody, sendJson } from "./router.js";

interface PasswordLoginRequest {
  username?: string;
  password?: string;
}

interface VerificationRequest {
  code?: string;
}

export function xiaomiLoginPassword(state: BridgeState): RouteHandler {
  return async (req, res) => {
    let body: PasswordLoginRequest;
    try {
      body = await readJsonBody<PasswordLoginRequest>(req);
    } catch {
      sendJson(res, 400, { error: "请输入小米账号和密码" });
      return;
    }
    state.lastError = "";
    const status = await state.xiaomiLogin.startPasswordLogin(body.username ?? "", body.password ?? "");
    if (status.state === "failed") {
      state.lastError = status.message ?? "小米账号登录失败";
      sendJson(res, 400, loginPayload(status));
      return;
    }
    sendJson(res, 202, loginPayload(status));
  };
}

export function xiaomiLoginVerification(state: BridgeState): RouteHandler {
  return async (req, res) => {
    let body: VerificationRequest;
    try {
      body = await readJsonBody<VerificationRequest>(req);
    } catch {
      sendJson(res, 400, { error: "请输入验证码" });
      return;
    }
    try {
      const status = state.xiaomiLogin.submitVerification(body.code ?? "");
      sendJson(res, 202, loginPayload(status));
    } catch (error) {
      const message = error instanceof Error ? error.message : "验证码提交失败";
      state.lastError = message;
      sendJson(res, 409, { error: message });
    }
  };
}

export function xiaomiLoginSms(state: BridgeState): RouteHandler {
  return (_req, res) => {
    state.lastError = "短信验证码接口已迁移，请使用 /api/xiaomi/login/verification";
    sendJson(res, 410, { error: state.lastError });
  };
}

export function xiaomiLoginQr(_state: BridgeState): RouteHandler {
  return (_req, res) => {
    sendJson(res, 410, { error: "二维码登录已停用，请使用小米账号和密码登录" });
  };
}

export function xiaomiLoginStatus(state: BridgeState): RouteHandler {
  return (_req, res) => {
    sendJson(res, 200, loginPayload(state.xiaomiLogin.getStatus()));
  };
}

function loginPayload(status: ReturnType<BridgeState["xiaomiLogin"]["getStatus"]>) {
  return {
    state: status.state,
    message: status.message,
    verification_method: status.verification_method,
    error: status.state === "authenticated" ? undefined : status.message,
  };
}
