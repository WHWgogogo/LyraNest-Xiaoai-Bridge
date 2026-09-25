import type { LyraNestTrack } from "../types.js";

export type PlayMode = "sequence" | "loop" | "shuffle" | "single_loop";

export class QueueManager {
  private queue: LyraNestTrack[] = [];
  private index = -1;
  private active = false;
  private source = "";
  private lastStartedAt = 0;
  private mode: PlayMode = "loop";
  private lastPushedAudioId?: string;
  private lastPushedTrackTitle?: string;

  getMode(): PlayMode {
    return this.mode;
  }

  setMode(mode: PlayMode): void {
    this.mode = mode;
    if (mode === "shuffle" && this.queue.length > 1) {
      this.shuffle();
    }
  }

  setQueue(tracks: LyraNestTrack[], startIndex = 0, source = ""): LyraNestTrack | null {
    this.queue = Array.isArray(tracks) ? [...tracks] : [];
    this.source = source;
    if (this.queue.length === 0) {
      this.index = -1;
      this.active = false;
      return null;
    }
    const safeIndex = Math.max(0, Math.min(startIndex, this.queue.length - 1));
    this.index = safeIndex;
    this.active = true;
    this.lastStartedAt = Date.now();

    if (this.mode === "shuffle" && this.queue.length > 1) {
      this.shuffle();
    }

    return this.queue[this.index] ?? null;
  }

  appendTracks(newTracks: LyraNestTrack[]): number {
    if (!Array.isArray(newTracks) || newTracks.length === 0) return 0;
    const existingIds = new Set(this.queue.map((t) => t.id));
    const added: LyraNestTrack[] = [];
    for (const t of newTracks) {
      if (!t?.id || existingIds.has(t.id)) continue;
      existingIds.add(t.id);
      added.push(t);
    }
    this.queue.push(...added);
    return added.length;
  }

  current(): LyraNestTrack | null {
    if (this.index < 0 || this.index >= this.queue.length) return null;
    return this.queue[this.index] ?? null;
  }

  next(): LyraNestTrack | null {
    if (this.queue.length === 0) return null;

    if (this.mode === "single_loop") {
      this.active = true;
      this.lastStartedAt = Date.now();
      return this.current();
    }

    if (this.index + 1 < this.queue.length) {
      this.index += 1;
      this.active = true;
      this.lastStartedAt = Date.now();
      return this.queue[this.index];
    }

    // End of queue reached: check loop / shuffle modes
    if (this.mode === "loop") {
      this.index = 0;
      this.active = true;
      this.lastStartedAt = Date.now();
      return this.queue[0];
    }

    if (this.mode === "shuffle") {
      this.shuffleAll();
      this.index = 0;
      this.active = true;
      this.lastStartedAt = Date.now();
      return this.queue[0];
    }

    return null;
  }

  previous(): LyraNestTrack | null {
    if (this.queue.length === 0) return null;

    if (this.mode === "single_loop") {
      this.active = true;
      this.lastStartedAt = Date.now();
      return this.current();
    }

    if (this.index - 1 >= 0) {
      this.index -= 1;
      this.active = true;
      this.lastStartedAt = Date.now();
      return this.queue[this.index];
    }

    if (this.mode === "loop" || this.mode === "shuffle") {
      this.index = this.queue.length - 1;
      this.active = true;
      this.lastStartedAt = Date.now();
      return this.queue[this.index];
    }

    return this.queue[0] ?? null;
  }

  hasMore(): boolean {
    if (this.mode === "loop" || this.mode === "shuffle" || this.mode === "single_loop") {
      return this.queue.length > 0;
    }
    return this.index + 1 < this.queue.length;
  }

  isAtEnd(): boolean {
    if (this.queue.length === 0) return true;
    return this.index + 1 >= this.queue.length;
  }

  size(): number {
    return this.queue.length;
  }

  getIndex(): number {
    return this.index;
  }

  getSource(): string {
    return this.source;
  }

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.lastStartedAt = Date.now();
  }

  getLastStartedAt(): number {
    return this.lastStartedAt;
  }

  getLastPushedAudioId(): string | undefined {
    return this.lastPushedAudioId;
  }

  setLastPushedAudioId(audioId?: string): void {
    this.lastPushedAudioId = audioId;
  }

  getLastPushedTrackTitle(): string | undefined {
    return this.lastPushedTrackTitle;
  }

  setLastPushedTrackTitle(title?: string): void {
    this.lastPushedTrackTitle = title;
  }

  clear(): void {
    this.queue = [];
    this.index = -1;
    this.active = false;
    this.source = "";
    this.lastStartedAt = 0;
    this.lastPushedAudioId = undefined;
    this.lastPushedTrackTitle = undefined;
  }

  shuffle(): void {
    if (this.queue.length <= 1) return;
    const current = this.current();
    const remaining = this.queue.filter((t) => t.id !== current?.id);
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    this.queue = current ? [current, ...remaining] : remaining;
    this.index = 0;
  }

  shuffleAll(): void {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.index = 0;
  }
}
