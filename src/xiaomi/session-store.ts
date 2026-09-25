import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { XiaomiTokens } from "../types.js";

interface EncryptedEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class XiaomiSessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XiaomiSessionStoreError";
  }
}

/**
 * The data directory is a trusted persistence boundary. The local key and
 * encrypted session must be backed up and protected together.
 */
export class XiaomiSessionStore {
  readonly keyPath: string;
  readonly sessionPath: string;

  constructor(dataDirectory: string) {
    this.keyPath = join(dataDirectory, "credentials.key");
    this.sessionPath = join(dataDirectory, "xiaomi-session.enc");
  }

  async load(): Promise<XiaomiTokens | null> {
    let raw: string;
    try {
      raw = await readFile(this.sessionPath, "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new XiaomiSessionStoreError("could not read saved Xiaomi session");
    }

    let envelope: EncryptedEnvelope;
    try {
      envelope = JSON.parse(raw) as EncryptedEnvelope;
      if (
        envelope.version !== 1
        || !isBase64Url(envelope.iv)
        || !isBase64Url(envelope.tag)
        || !isBase64Url(envelope.ciphertext)
      ) {
        throw new Error("invalid envelope");
      }
    } catch {
      throw new XiaomiSessionStoreError("saved Xiaomi session is malformed");
    }

    try {
      const key = await this.readKey();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return validateTokens(JSON.parse(plain));
    } catch (error) {
      if (error instanceof XiaomiSessionStoreError) throw error;
      throw new XiaomiSessionStoreError("saved Xiaomi session cannot be decrypted");
    }
  }

  async save(tokens: XiaomiTokens): Promise<void> {
    const valid = validateTokens(tokens);
    const key = await this.loadOrCreateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(valid), "utf8"), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };

    await mkdir(dirname(this.sessionPath), { recursive: true });
    const temporaryPath = `${this.sessionPath}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    await rename(temporaryPath, this.sessionPath);
    await chmod(this.sessionPath, 0o600).catch(() => undefined);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.sessionPath);
    } catch (error) {
      if (!isNotFound(error)) throw new XiaomiSessionStoreError("could not clear saved Xiaomi session");
    }
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    try {
      return await this.readKey();
    } catch (error) {
      if (!(error instanceof XiaomiSessionStoreError) || !error.message.includes("does not exist")) throw error;
    }

    const key = randomBytes(32);
    await mkdir(dirname(this.keyPath), { recursive: true });
    try {
      await writeFile(this.keyPath, key, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw new XiaomiSessionStoreError("could not create local credential key");
    }
    await chmod(this.keyPath, 0o600).catch(() => undefined);
    return this.readKey();
  }

  private async readKey(): Promise<Buffer> {
    let key: Buffer;
    try {
      key = await readFile(this.keyPath);
    } catch (error) {
      if (isNotFound(error)) throw new XiaomiSessionStoreError("local credential key does not exist");
      throw new XiaomiSessionStoreError("could not read local credential key");
    }
    if (key.length !== 32) throw new XiaomiSessionStoreError("local credential key has an invalid length");
    return key;
  }
}

function validateTokens(value: unknown): XiaomiTokens {
  if (!value || typeof value !== "object") throw new XiaomiSessionStoreError("saved Xiaomi session is invalid");
  const token = value as Partial<XiaomiTokens>;
  if (
    typeof token.user_id !== "string" || !token.user_id
    || typeof token.device_id !== "string" || !token.device_id
    || typeof token.pass_token !== "string" || !token.pass_token
    || typeof token.service_token !== "string"
  ) {
    throw new XiaomiSessionStoreError("saved Xiaomi session is incomplete");
  }
  const restored: XiaomiTokens = {
    user_id: token.user_id,
    device_id: token.device_id,
    pass_token: token.pass_token,
    service_token: token.service_token,
  };
  if (typeof token.c_user_id === "string") restored.c_user_id = token.c_user_id;
  if (typeof token.ssecurity === "string") restored.ssecurity = token.ssecurity;
  if (typeof token.expires_at === "number") restored.expires_at = token.expires_at;
  return restored;
}

function isBase64Url(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
