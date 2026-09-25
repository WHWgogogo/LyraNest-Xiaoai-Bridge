import type { XiaomiLoginState, XiaomiLoginStatus, XiaomiTokens } from "../types.js";
import {
  type XiaomiAuthenticator,
  XiaomiAuthenticatorError,
  type XiaomiVerificationMethod,
} from "./miservice-client.js";
import { XiaomiSessionStore, XiaomiSessionStoreError } from "./session-store.js";

export interface XiaomiLoginHooks {
  onAuthenticated?: (tokens: XiaomiTokens) => Promise<void> | void;
  onReauthRequired?: (message: string) => Promise<void> | void;
}

export interface XiaomiLoginManagerOptions {
  authenticator: XiaomiAuthenticator;
  store: XiaomiSessionStore;
  probe?: (tokens: XiaomiTokens) => Promise<void>;
}

export class XiaomiLoginManager {
  private state: XiaomiLoginState = "idle";
  private message = "";
  private tokens: XiaomiTokens | null = null;
  private verificationMethod: XiaomiVerificationMethod | undefined;
  private loginAttempt = 0;
  private readonly probe: (tokens: XiaomiTokens) => Promise<void>;
  private hooks: XiaomiLoginHooks = {};

  constructor(private readonly options: XiaomiLoginManagerOptions) {
    this.probe = options.probe ?? (async () => undefined);
  }

  setHooks(hooks: XiaomiLoginHooks): void {
    this.hooks = hooks;
  }

  getTokens(): XiaomiTokens | null {
    return this.tokens;
  }

  getStatus(): XiaomiLoginStatus {
    return {
      state: this.state,
      message: this.message || undefined,
      verification_method: this.verificationMethod,
    };
  }

  async restore(): Promise<void> {
    try {
      const saved = await this.options.store.load();
      if (!saved) return;
      try {
        await this.probe(saved);
        await this.authenticated(saved);
        return;
      } catch {
        const tokens = await this.options.authenticator.refresh(saved);
        await this.probe(tokens);
        await this.options.store.save(tokens);
        await this.authenticated(tokens);
      }
    } catch (error) {
      await this.reauthRequired(errorMessage(error));
    }
  }

  async startPasswordLogin(username: string, password: string): Promise<XiaomiLoginStatus> {
    if (!username.trim() || !password) {
      this.state = "failed";
      this.message = "请输入小米账号和密码";
      return this.getStatus();
    }
    this.cancelPendingLogin();
    this.tokens = null;
    const attempt = ++this.loginAttempt;
    this.state = "pending";
    this.message = "正在登录小米账号";
    this.verificationMethod = undefined;
    void this.completePasswordLogin(attempt, username.trim(), password);
    return this.getStatus();
  }

  submitVerification(code: string): XiaomiLoginStatus {
    if (this.state !== "verification_required") {
      throw new XiaomiAuthenticatorError("no_verification_pending");
    }
    try {
      this.options.authenticator.submitVerification(code);
      this.state = "pending";
      this.message = "正在验证验证码";
      this.verificationMethod = undefined;
      return this.getStatus();
    } catch (error) {
      this.message = errorMessage(error);
      throw error;
    }
  }

  async recoverAuthentication(): Promise<XiaomiTokens | null> {
    if (!this.tokens) {
      await this.reauthRequired("小米会话不可用");
      return null;
    }
    try {
      const refreshed = await this.options.authenticator.refresh(this.tokens);
      await this.probe(refreshed);
      await this.options.store.save(refreshed);
      await this.authenticated(refreshed);
      return refreshed;
    } catch (error) {
      await this.reauthRequired(errorMessage(error));
      return null;
    }
  }

  async logout(): Promise<void> {
    this.cancelPendingLogin();
    this.tokens = null;
    this.state = "idle";
    this.message = "";
    await this.options.store.clear();
    await this.hooks.onReauthRequired?.("Xiaomi account was signed out");
  }

  private async completePasswordLogin(attempt: number, username: string, password: string): Promise<void> {
    try {
      const tokens = await this.options.authenticator.startLogin(username, password, {
        onVerificationRequired: (method) => {
          if (attempt !== this.loginAttempt) return;
          this.state = "verification_required";
          this.verificationMethod = method;
          this.message = method === "email" ? "请输入邮箱验证码" : "请输入短信验证码";
        },
      });
      if (attempt !== this.loginAttempt) return;
      await this.probe(tokens);
      await this.options.store.save(tokens);
      await this.authenticated(tokens);
    } catch (error) {
      if (attempt !== this.loginAttempt) return;
      this.state = "failed";
      this.message = errorMessage(error);
      console.warn(JSON.stringify({
        level: "warn",
        event: "xiaomi_login_failed",
        code: error instanceof XiaomiAuthenticatorError ? error.code : "authentication_failed",
      }));
    }
  }

  private async authenticated(tokens: XiaomiTokens): Promise<void> {
    this.tokens = tokens;
    this.state = "authenticated";
    this.message = "";
    this.verificationMethod = undefined;
    await this.hooks.onAuthenticated?.(tokens);
  }

  private async reauthRequired(message: string): Promise<void> {
    this.cancelPendingLogin();
    this.tokens = null;
    this.state = "reauth_required";
    this.message = `小米授权需要重新登录：${message}`;
    await this.hooks.onReauthRequired?.(this.message);
  }

  private cancelPendingLogin(): void {
    this.loginAttempt += 1;
    this.options.authenticator.cancel();
    this.verificationMethod = undefined;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof XiaomiAuthenticatorError || error instanceof XiaomiSessionStoreError) return error.message;
  return error instanceof Error ? error.message : "未知小米登录错误";
}
