import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { XiaomiTokens } from "../types.js";

export type XiaomiVerificationMethod = "sms" | "email";

export interface XiaomiAuthenticationCallbacks {
  onPending?(): void;
  onVerificationRequired?(method: XiaomiVerificationMethod): void;
}

export interface XiaomiAuthenticator {
  startLogin(
    username: string,
    password: string,
    callbacks?: XiaomiAuthenticationCallbacks,
  ): Promise<XiaomiTokens>;
  submitVerification(code: string): void;
  refresh(tokens: XiaomiTokens): Promise<XiaomiTokens>;
  cancel(): void;
}

export class XiaomiAuthenticatorError extends Error {
  constructor(
    readonly code: string,
    message = authenticationMessage(code),
  ) {
    super(message);
    this.name = "XiaomiAuthenticatorError";
  }
}

interface HelperEvent {
  event: "pending" | "verification_required" | "authenticated" | "failed";
  method?: XiaomiVerificationMethod;
  tokens?: XiaomiTokens;
  code?: string;
}

interface ActiveProcess {
  child: ChildProcessWithoutNullStreams;
  reject: (error: Error) => void;
  settled: boolean;
  stderrBytes: number;
}

export interface MiServiceAuthenticatorOptions {
  pythonBin?: string;
  helperPath?: string;
  spawnImpl?: typeof spawn;
}

export class MiServiceAuthenticator implements XiaomiAuthenticator {
  private readonly pythonBin: string;
  private readonly helperPath: string;
  private readonly spawnImpl: typeof spawn;
  private active: ActiveProcess | null = null;

  constructor(options: MiServiceAuthenticatorOptions = {}) {
    this.pythonBin = options.pythonBin ?? process.env.XIAOMI_PYTHON_BIN ?? "python3";
    this.helperPath = options.helperPath
      ?? process.env.XIAOMI_AUTH_HELPER
      ?? join(process.cwd(), "python", "xiaomi_auth.py");
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  startLogin(
    username: string,
    password: string,
    callbacks: XiaomiAuthenticationCallbacks = {},
  ): Promise<XiaomiTokens> {
    if (!username.trim() || !password) {
      return Promise.reject(new XiaomiAuthenticatorError("invalid_credentials"));
    }
    return this.run({ action: "login", username: username.trim(), password }, callbacks);
  }

  submitVerification(code: string): void {
    if (!/^[A-Za-z0-9]{4,12}$/.test(code.trim())) {
      throw new XiaomiAuthenticatorError("invalid_verification_code");
    }
    const active = this.active;
    if (!active || active.settled) throw new XiaomiAuthenticatorError("no_verification_pending");
    active.child.stdin.write(`${JSON.stringify({ action: "submit_otp", code: code.trim() })}\n`);
  }

  refresh(tokens: XiaomiTokens): Promise<XiaomiTokens> {
    return this.run({ action: "refresh", tokens });
  }

  cancel(): void {
    const active = this.active;
    if (!active || active.settled) return;
    active.settled = true;
    if (this.active === active) this.active = null;
    active.child.kill("SIGTERM");
    active.reject(new XiaomiAuthenticatorError("login_cancelled"));
  }

  private run(command: Record<string, unknown>, callbacks: XiaomiAuthenticationCallbacks = {}): Promise<XiaomiTokens> {
    this.cancel();
    return new Promise<XiaomiTokens>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnImpl(this.pythonBin, [this.helperPath], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch {
        reject(new XiaomiAuthenticatorError("helper_unavailable"));
        return;
      }

      const active: ActiveProcess = { child, reject, settled: false, stderrBytes: 0 };
      this.active = active;
      const output = createInterface({ input: child.stdout });

      const settle = (result: XiaomiTokens | Error): void => {
        if (active.settled) return;
        active.settled = true;
        output.close();
        if (this.active === active) this.active = null;
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      output.on("line", (line) => {
        let event: HelperEvent;
        try {
          event = parseHelperEvent(line);
        } catch (error) {
          console.warn(JSON.stringify({
            level: "warn",
            event: "xiaomi_auth_helper_protocol_invalid",
            ...helperLineDiagnostics(line),
            stderr_bytes: active.stderrBytes,
          }));
          settle(error instanceof Error ? error : new XiaomiAuthenticatorError("helper_protocol_error"));
          return;
        }
        if (event.event === "pending") {
          callbacks.onPending?.();
          return;
        }
        if (event.event === "verification_required") {
          callbacks.onVerificationRequired?.(event.method ?? "sms");
          return;
        }
        if (event.event === "authenticated") {
          settle(event.tokens ?? new XiaomiAuthenticatorError("helper_protocol_error"));
          return;
        }
        settle(new XiaomiAuthenticatorError(event.code ?? "xiaomi_login_failed"));
      });

      child.stderr.on("data", (chunk: Buffer) => {
        active.stderrBytes += chunk.length;
      });
      child.once("error", () => settle(new XiaomiAuthenticatorError("helper_unavailable")));
      child.once("close", () => {
        if (!active.settled) settle(new XiaomiAuthenticatorError("helper_terminated"));
      });
      child.stdin.once("error", () => settle(new XiaomiAuthenticatorError("helper_terminated")));
      child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }
}

export function parseHelperEvent(line: string): HelperEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new XiaomiAuthenticatorError("helper_protocol_error");
  }
  if (!value || typeof value !== "object") throw new XiaomiAuthenticatorError("helper_protocol_error");
  const event = value as Partial<HelperEvent>;
  if (event.event === "pending") return { event: "pending" };
  if (event.event === "verification_required") {
    return { event: "verification_required", method: event.method === "email" ? "email" : "sms" };
  }
  if (event.event === "authenticated" && validTokens(event.tokens)) {
    return { event: "authenticated", tokens: event.tokens };
  }
  if (event.event === "failed" && typeof event.code === "string") {
    return { event: "failed", code: event.code };
  }
  throw new XiaomiAuthenticatorError("helper_protocol_error");
}

export function helperLineDiagnostics(line: string): {
  line_length: number;
  is_json: boolean;
  event_type: string;
} {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object") {
      return { line_length: line.length, is_json: true, event_type: typeof value };
    }
    const event = (value as { event?: unknown }).event;
    return {
      line_length: line.length,
      is_json: true,
      event_type: typeof event,
    };
  } catch {
    return { line_length: line.length, is_json: false, event_type: "unavailable" };
  }
}

function validTokens(value: unknown): value is XiaomiTokens {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<XiaomiTokens>;
  return typeof token.user_id === "string" && Boolean(token.user_id)
    && typeof token.device_id === "string" && Boolean(token.device_id)
    && typeof token.pass_token === "string" && Boolean(token.pass_token)
    && typeof token.service_token === "string" && Boolean(token.service_token)
    && typeof token.ssecurity === "string" && Boolean(token.ssecurity);
}

function authenticationMessage(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return "请输入小米账号和密码";
    case "invalid_verification_code":
      return "请输入 4 至 12 位短信或邮箱验证码";
    case "no_verification_pending":
      return "当前没有等待验证的登录请求";
    case "saved_session_rejected":
      return "保存的小米授权已失效，请重新登录";
    case "helper_unavailable":
      return "小米登录组件不可用";
    case "helper_terminated":
      return "小米登录进程意外结束";
    case "login_cancelled":
      return "小米登录已取消";
    case "invalid_request":
      return "小米登录请求格式无效，请重新填写账号和密码";
    case "token_shape_invalid":
      return "小米登录返回的授权信息格式不兼容";
    case "missing_user_id":
      return "小米登录结果缺少账户标识";
    case "missing_device_id":
      return "小米登录结果缺少设备标识";
    case "missing_pass_token":
      return "小米登录结果缺少会话凭据";
    case "missing_service_token":
      return "小米登录结果缺少音箱服务凭据";
    case "missing_ssecurity":
      return "小米登录结果缺少安全凭据";
    case "helper_protocol_error":
      return "小米登录组件通信异常";
    case "xiaomi_login_rejected":
      return "小米未接受账号登录，请检查账号、密码或账号安全验证后重试";
    default:
      return "小米账号登录失败，请稍后重试";
  }
}
