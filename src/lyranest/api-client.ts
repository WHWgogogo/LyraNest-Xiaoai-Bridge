import type { LyraNestTrack, LyraNestBook, LyraNestBookChapter, LyraNestBookProgress, LyraNestCollections, LyraNestLibrary } from "../types.js";

interface LoginResponse {
  token: string;
}

interface MediaTokenResponse {
  token: string;
  expires_at: string;
}

interface TrackListResponse {
  tracks: LyraNestTrack[];
  total: number;
}

export function normalizeTrack(raw: unknown): LyraNestTrack {
  if (!raw || typeof raw !== "object") {
    return { id: "", title: "" };
  }
  const r = raw as Record<string, unknown>;
  let durationMs: number | undefined;
  if (typeof r.duration_ms === "number" && r.duration_ms > 0) {
    durationMs = Math.round(r.duration_ms);
  } else if (typeof r.durationMs === "number" && r.durationMs > 0) {
    durationMs = Math.round(r.durationMs);
  } else if (typeof r.duration === "number" && r.duration > 0) {
    // If duration < 10000, it is likely in seconds -> convert to ms
    durationMs = r.duration < 10000 ? Math.round(r.duration * 1000) : Math.round(r.duration);
  }

  return {
    id: String(r.id || ""),
    title: String(r.title || ""),
    artist: r.artist ? String(r.artist) : undefined,
    album: r.album ? String(r.album) : undefined,
    duration_ms: durationMs,
  };
}

export class LyraNestClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private sessionToken: string | null = null;
  private mediaToken: string | null = null;
  private mediaTokenExpiresAt = 0;

  constructor(baseUrl: string, username: string, password: string, sessionToken: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.username = username;
    this.password = password;
    this.sessionToken = sessionToken;
  }

  updateBaseUrl(url: string): void {
    const normalized = url.replace(/\/+$/, "");
    if (this.baseUrl === normalized) return;
    this.baseUrl = normalized;
    this.sessionToken = null;
    this.mediaToken = null;
    this.mediaTokenExpiresAt = 0;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getUsername(): string {
    return this.username;
  }

  getPassword(): string {
    return this.password;
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  hasPassword(): boolean {
    return this.password.length > 0;
  }

  setPassword(password: string): void {
    this.password = password;
    this.sessionToken = null;
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!response.ok) throw new Error(`LyraNest login failed with HTTP ${response.status}`);
    const body = (await response.json()) as LoginResponse;
    if (!body.token) throw new Error("LyraNest login returned empty token");
    this.sessionToken = body.token;
    return body.token;
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionToken) return this.sessionToken;
    return await this.login();
  }

  private async authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
    let session = await this.ensureSession();
    const makeHeaders = (s: string) => {
      const h = new Headers(options.headers || {});
      h.set("Authorization", `Bearer ${s}`);
      return h;
    };
    let response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: makeHeaders(session),
    });
    if (response.status === 401 && this.password) {
      this.sessionToken = null;
      try {
        session = await this.login();
        response = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers: makeHeaders(session),
        });
      } catch {
        // If re-login fails, return original 401 response
      }
    }
    return response;
  }

  invalidateMediaToken(): void {
    this.mediaToken = null;
    this.mediaTokenExpiresAt = 0;
  }

  async getMediaToken(): Promise<string> {
    if (this.mediaToken && this.mediaTokenExpiresAt > Date.now() + 30_000) {
      return this.mediaToken;
    }
    const response = await this.authenticatedFetch("/api/v1/auth/media-token");
    if (!response.ok) {
      if (response.status === 401) this.sessionToken = null;
      throw new Error(`media-token request returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as MediaTokenResponse;
    this.mediaToken = body.token;
    this.mediaTokenExpiresAt = new Date(body.expires_at).getTime();
    return body.token;
  }

  async searchTracks(query: string, limit: number): Promise<LyraNestTrack[]> {
    const params = new URLSearchParams({ query, limit: String(Math.min(limit, 50)) });
    const response = await this.authenticatedFetch(`/api/v1/tracks?${params}`);
    if (!response.ok) {
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      throw new Error(`tracks search returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as TrackListResponse;
    return (body.tracks ?? []).map(normalizeTrack);
  }

  async getCollections(): Promise<LyraNestCollections> {
    const response = await this.authenticatedFetch("/api/v1/me/collections");
    if (!response.ok) {
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      throw new Error(`collections request returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as LyraNestCollections;
    return {
      revision: body.revision,
      favorite_track_ids: Array.isArray(body.favorite_track_ids) ? body.favorite_track_ids : [],
      playlists: Array.isArray(body.playlists) ? body.playlists : [],
    };
  }

  async getTracksByIds(ids: string[]): Promise<LyraNestTrack[]> {
    const validIds = ids.filter((id) => typeof id === "string" && id.trim().length > 0);
    if (!validIds.length) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < validIds.length; i += 50) {
      chunks.push(validIds.slice(i, i + 50));
    }
    const allTracks: LyraNestTrack[] = [];
    for (const chunk of chunks) {
      const params = new URLSearchParams({ ids: chunk.join(",") });
      const response = await this.authenticatedFetch(`/api/v1/tracks?${params}`);
      if (!response.ok) {
        if (response.status === 401) {
          this.sessionToken = null;
          throw new Error("LyraNest session expired; retry needed");
        }
        throw new Error(`tracks by ids request returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as TrackListResponse;
      if (Array.isArray(body?.tracks)) {
        allTracks.push(...body.tracks.map(normalizeTrack));
      }
    }
    const trackMap = new Map(allTracks.map((t) => [t.id, t]));
    return validIds.map((id) => trackMap.get(id)).filter((t): t is LyraNestTrack => Boolean(t));
  }

  async getLibraryTracks(limit = 100, offset = 0): Promise<LyraNestTrack[]> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(limit, 500))),
      offset: String(Math.max(0, offset)),
    });
    const response = await this.authenticatedFetch(`/api/v1/tracks?${params}`);
    if (!response.ok) {
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      throw new Error(`library tracks request returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as TrackListResponse;
    return (body.tracks ?? []).map(normalizeTrack);
  }

  async getLibraries(): Promise<LyraNestLibrary[]> {
    const response = await this.authenticatedFetch("/api/v1/libraries");
    if (!response.ok) {
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      throw new Error(`libraries request returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as { libraries?: LyraNestLibrary[] } | LyraNestLibrary[];
    const list = Array.isArray(body) ? body : (Array.isArray(body?.libraries) ? body.libraries : []);
    return list.filter((lib) => lib && lib.kind !== "audiobook");
  }

  async getTracksByLibrary(libraryId: string, limit = 200, offset = 0): Promise<LyraNestTrack[]> {
    const params = new URLSearchParams({
      library_id: libraryId,
      limit: String(Math.max(1, Math.min(limit, 500))),
      offset: String(Math.max(0, offset)),
    });
    const response = await this.authenticatedFetch(`/api/v1/tracks?${params}`);
    if (!response.ok) {
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      throw new Error(`tracks by library request returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as TrackListResponse;
    return (body.tracks ?? []).map(normalizeTrack);
  }

  async listBooks(): Promise<LyraNestBook[]> {
    const response = await this.authenticatedFetch("/api/v1/books");
    if (!response.ok) {
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      throw new Error(`books request returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as { books?: Array<{ book: LyraNestBook }> };
    if (!Array.isArray(body?.books)) return [];
    return body.books.map((item) => item.book).filter(Boolean);
  }

  async searchBooks(keyword: string): Promise<LyraNestBook[]> {
    const books = await this.listBooks();
    const q = keyword.trim().toLowerCase();
    if (!q) return books;
    return books
      .filter((b) => {
        const title = (b.title || "").toLowerCase();
        const author = (b.author || "").toLowerCase();
        const narrator = (b.narrator || "").toLowerCase();
        return title.includes(q) || author.includes(q) || narrator.includes(q);
      })
      .sort((a, b) => {
        const aExact = (a.title || "").toLowerCase() === q;
        const bExact = (b.title || "").toLowerCase() === q;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        const aStarts = (a.title || "").toLowerCase().startsWith(q);
        const bStarts = (b.title || "").toLowerCase().startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return 0;
      });
  }

  async getBookDetail(bookId: string): Promise<{ book: LyraNestBook; chapters: LyraNestBookChapter[] } | null> {
    const response = await this.authenticatedFetch(`/api/v1/books/${encodeURIComponent(bookId)}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      throw new Error(`book detail request returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as { book: LyraNestBook; chapters?: LyraNestBookChapter[] };
    return {
      book: body.book,
      chapters: Array.isArray(body.chapters) ? body.chapters : [],
    };
  }

  async getBookProgress(bookId: string): Promise<LyraNestBookProgress | null> {
    const response = await this.authenticatedFetch(`/api/v1/me/books/${encodeURIComponent(bookId)}/progress`);
    if (!response.ok) {
      if (response.status === 404) return null;
      if (response.status === 401) {
        this.sessionToken = null;
        throw new Error("LyraNest session expired; retry needed");
      }
      return null;
    }
    const body = (await response.json()) as Partial<LyraNestBookProgress>;
    if (!body?.current_track_id) return null;
    return {
      book_id: body.book_id || bookId,
      current_track_id: body.current_track_id,
      position_ms: body.position_ms || 0,
    };
  }

  async updateBookProgress(bookId: string, trackId: string, positionMs = 0): Promise<void> {
    try {
      await this.authenticatedFetch(`/api/v1/me/books/${encodeURIComponent(bookId)}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_track_id: trackId,
          position_ms: positionMs,
        }),
      });
    } catch {
      // 进度更新为旁路记录，不阻塞播放
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async verifyCredentials(username: string, password: string): Promise<void> {
    const previous = {
      username: this.username,
      password: this.password,
      session: this.sessionToken,
      mediaToken: this.mediaToken,
      mediaTokenExpiresAt: this.mediaTokenExpiresAt,
    };
    this.username = username;
    this.password = password;
    this.sessionToken = null;
    this.mediaToken = null;
    this.mediaTokenExpiresAt = 0;
    try {
      await this.login();
    } catch (error) {
      this.username = previous.username;
      this.password = previous.password;
      this.sessionToken = previous.session;
      this.mediaToken = previous.mediaToken;
      this.mediaTokenExpiresAt = previous.mediaTokenExpiresAt;
      throw error;
    }
  }
}
