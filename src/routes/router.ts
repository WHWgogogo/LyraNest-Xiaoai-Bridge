import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

export interface StaticRoute {
  pattern: RegExp;
  contentType: string;
  filePath: string;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];
  private staticRoutes: StaticRoute[] = [];
  private publicApiRoutes = new Set<string>();
  private accessToken = "";
  private accessDenied = false;
  private accessTokenVerifier: ((candidate: string) => boolean) | null = null;
  private gatewayPrefix = "";

  get(path: string, handler: RouteHandler): void {
    this.routes.push({ method: "GET", pattern: pathToRegex(path), handler });
  }

  getStatic(path: string, filePath: string, contentType: string): void {
    this.staticRoutes.push({ pattern: pathToRegex(path), contentType, filePath: resolve(filePath) });
  }

  requireAccessToken(token: string): void {
    this.accessDenied = token.trim() === "";
    this.accessToken = token.trim();
    this.accessTokenVerifier = null;
  }

  setAccessTokenVerifier(verifier: (candidate: string) => boolean): void {
    this.accessDenied = false;
    this.accessToken = "";
    this.accessTokenVerifier = verifier;
  }

  setGatewayPrefix(prefix: string): void {
    const normalized = prefix.trim().replace(/\/+$/, "");
    if (!normalized) {
      this.gatewayPrefix = "";
      return;
    }
    if (!normalized.startsWith("/") || normalized.includes("?") || normalized.includes("#")) {
      throw new Error("gateway prefix must be an absolute path");
    }
    this.gatewayPrefix = normalized;
  }

  getPublic(path: string, handler: RouteHandler): void {
    this.publicApiRoutes.add(routeKey("GET", path));
    this.get(path, handler);
  }

  postPublic(path: string, handler: RouteHandler): void {
    this.publicApiRoutes.add(routeKey("POST", path));
    this.post(path, handler);
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (this.accessDenied) return false;
    const header = req.headers.authorization;
    let candidate = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;
    if (!candidate) {
      const bridgeToken = req.headers["x-bridge-token"];
      if (typeof bridgeToken === "string") {
        candidate = bridgeToken.trim();
      } else if (Array.isArray(bridgeToken) && bridgeToken.length > 0) {
        candidate = bridgeToken[0]?.trim();
      }
    }
    if (!candidate && req.url) {
      try {
        const queryToken = new URL(req.url, "http://localhost").searchParams.get("token");
        if (queryToken) candidate = queryToken.trim();
      } catch {
        // ignore parse error
      }
    }
    if (!candidate) return false;
    if (this.accessTokenVerifier) return this.accessTokenVerifier(candidate);
    return candidate === this.accessToken;
  }

  private sendUnauthorized(res: ServerResponse): void {
    sendJson(res, 401, { error: "unauthorized" });
  }

  private async dispatchStatic(url: string, res: ServerResponse): Promise<boolean> {
    const route = this.staticRoutes.find((item) => item.pattern.test(url));
    if (!route) return false;
    if (!existsSync(route.filePath) || !statSync(route.filePath).isFile()) {
      sendJson(res, 404, { error: "static file not found" });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": route.contentType,
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "no-referrer",
    });
    createReadStream(route.filePath).pipe(res);
    return true;
  }

  post(path: string, handler: RouteHandler): void {
    this.routes.push({ method: "POST", pattern: pathToRegex(path), handler });
  }

  put(path: string, handler: RouteHandler): void {
    this.routes.push({ method: "PUT", pattern: pathToRegex(path), handler });
  }

  delete(path: string, handler: RouteHandler): void {
    this.routes.push({ method: "DELETE", pattern: pathToRegex(path), handler });
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = this.normalizedPath(req.url?.split("?")[0] ?? "/");
    if (!url) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (method === "GET" && await this.dispatchStatic(url, res)) return;
    if (url.startsWith("/api/") && !this.publicApiRoutes.has(routeKey(method, url)) && !this.isAuthorized(req)) {
      this.sendUnauthorized(res);
      return;
    }
    for (const route of this.routes) {
      if (route.method === method && route.pattern.test(url)) {
        await route.handler(req, res);
        return;
      }
    }
    sendJson(res, 404, { error: "not found" });
  }

  listen(address: number | string, callback?: () => void): Server {
    const server = createServer((req, res) => {
      void this.dispatch(req, res).catch(() => {
        sendJson(res, 500, { error: "internal error" });
      });
    });
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        logger.error("bridge", `端口或套接字已被占用 (EADDRINUSE): ${address}。请在应用中心或配置中修改服务端口，或停止占用该端口的冲突进程/Docker容器。`, {
          address,
          error: error.message,
        });
      } else {
        logger.error("bridge", `HTTP 服务监听失败: ${error.message}`, {
          address,
          error: error.message,
        });
      }
      if (server.listenerCount("error") <= 1) {
        process.exit(1);
      }
    });
    server.listen(address, callback);
    return server;
  }

  private normalizedPath(pathname: string): string | null {
    if (!this.gatewayPrefix) return pathname;
    if (pathname === this.gatewayPrefix || pathname === `${this.gatewayPrefix}/`) return "/";
    if (pathname.startsWith(`${this.gatewayPrefix}/`)) {
      return pathname.slice(this.gatewayPrefix.length);
    }
    return pathname;
  }
}

function pathToRegex(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`);
}

function routeKey(method: string, path: string): string {
  return `${method} ${path}`;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new Error("empty body");
  return JSON.parse(raw) as T;
}
