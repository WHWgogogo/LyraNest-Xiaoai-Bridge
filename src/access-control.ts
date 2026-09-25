import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

interface StoredAccessToken {
  version: 1;
  salt: string;
  hash: string;
}

export class AccessControl {
  private storedToken: StoredAccessToken | null;

  private constructor(
    private readonly filePath: string,
    private readonly environmentToken: string,
    storedToken: StoredAccessToken | null,
  ) {
    this.storedToken = storedToken;
  }

  static async load(filePath: string, environmentToken: string): Promise<AccessControl> {
    let storedToken: StoredAccessToken | null = null;
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<StoredAccessToken>;
      if (
        parsed.version === 1
        && typeof parsed.salt === "string"
        && typeof parsed.hash === "string"
        && parsed.salt
        && parsed.hash
      ) {
        storedToken = { version: 1, salt: parsed.salt, hash: parsed.hash };
      }
    } catch {
      // A missing token file means the Bridge needs first-time setup.
    }
    return new AccessControl(filePath, environmentToken.trim(), storedToken);
  }

  needsSetup(): boolean {
    return !this.environmentToken && this.storedToken === null;
  }

  isAuthorized(candidate: string): boolean {
    const token = typeof candidate === "string" ? candidate.trim() : "";
    if (!token) return false;
    if (this.environmentToken) return safelyMatches(token, this.environmentToken);
    if (!this.storedToken) return false;
    const expected = Buffer.from(this.storedToken.hash, "base64url");
    const actual = deriveToken(token, this.storedToken.salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async setup(candidate: string): Promise<void> {
    if (!this.needsSetup()) throw new Error("access token is already configured");
    await this.save(candidate);
  }

  async change(candidate: string): Promise<void> {
    if (this.environmentToken) {
      throw new Error("access token is managed by BRIDGE_ACCESS_TOKEN");
    }
    if (!this.storedToken) throw new Error("access token is not configured");
    await this.save(candidate);
  }

  private async save(candidate: string): Promise<void> {
    const token = candidate.trim();
    if (!/^\d{6}$/.test(token)) throw new Error("access token must be exactly 6 digits");
    const salt = randomBytes(16).toString("base64url");
    const storedToken: StoredAccessToken = {
      version: 1,
      salt,
      hash: deriveToken(token, salt).toString("base64url"),
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(storedToken, null, 2), { encoding: "utf8", mode: 0o600 });
    this.storedToken = storedToken;
  }
}

function deriveToken(token: string, salt: string): Buffer {
  return scryptSync(token, salt, 32);
}

function safelyMatches(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
