import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

export interface LyraNestCredentials {
  username: string;
  password: string;
  session_token?: string | null;
}

interface EncryptedEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class LyraNestCredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LyraNestCredentialStoreError";
  }
}

/**
 * The data directory is a trusted persistence boundary. The local key and
 * encrypted credentials must be backed up and protected together.
 */
export class LyraNestCredentialStore {
  readonly keyPath: string;
  readonly credentialsPath: string;

  constructor(dataDirectory: string) {
    this.keyPath = join(dataDirectory, "credentials.key");
    this.credentialsPath = join(dataDirectory, "lyranest-credentials.enc");
  }

  async load(): Promise<LyraNestCredentials | null> {
    let raw: string;
    try {
      raw = await readFile(this.credentialsPath, "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new LyraNestCredentialStoreError("could not read saved LyraNest credentials");
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
      throw new LyraNestCredentialStoreError("saved LyraNest credentials are malformed");
    }

    try {
      const key = await this.readKey();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return validateCredentials(JSON.parse(plain));
    } catch (error) {
      if (error instanceof LyraNestCredentialStoreError) throw error;
      throw new LyraNestCredentialStoreError("saved LyraNest credentials cannot be decrypted");
    }
  }

  async save(credentials: LyraNestCredentials): Promise<void> {
    const valid = validateCredentials(credentials);
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

    await mkdir(dirname(this.credentialsPath), { recursive: true });
    const temporaryPath = `${this.credentialsPath}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    await rename(temporaryPath, this.credentialsPath);
    await chmod(this.credentialsPath, 0o600).catch(() => undefined);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.credentialsPath);
    } catch (error) {
      if (!isNotFound(error)) throw new LyraNestCredentialStoreError("could not clear saved LyraNest credentials");
    }
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    try {
      return await this.readKey();
    } catch (error) {
      if (!(error instanceof LyraNestCredentialStoreError) || !error.message.includes("does not exist")) throw error;
    }

    const key = randomBytes(32);
    await mkdir(dirname(this.keyPath), { recursive: true });
    try {
      await writeFile(this.keyPath, key, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw new LyraNestCredentialStoreError("could not create local credential key");
    }
    await chmod(this.keyPath, 0o600).catch(() => undefined);
    return this.readKey();
  }

  private async readKey(): Promise<Buffer> {
    let key: Buffer;
    try {
      key = await readFile(this.keyPath);
    } catch (error) {
      if (isNotFound(error)) throw new LyraNestCredentialStoreError("local credential key does not exist");
      throw new LyraNestCredentialStoreError("could not read local credential key");
    }
    if (key.length !== 32) throw new LyraNestCredentialStoreError("local credential key has an invalid length");
    return key;
  }
}

function validateCredentials(value: unknown): LyraNestCredentials {
  if (!value || typeof value !== "object") throw new LyraNestCredentialStoreError("saved credentials are invalid");
  const creds = value as Partial<LyraNestCredentials>;
  if (typeof creds.username !== "string" || !creds.username || typeof creds.password !== "string") {
    throw new LyraNestCredentialStoreError("saved credentials are incomplete");
  }
  return {
    username: creds.username.trim(),
    password: creds.password,
    session_token: typeof creds.session_token === "string" ? creds.session_token : null,
  };
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
