export interface ClockState {
  deviceId: string;
  trackId?: string;
  trackTitle?: string;
  durationMs: number;
  isPlaying: boolean;
  lastStateChangeAt: number;
  accumulatedMs: number;
  lastAudioId?: string;
}

export class PlaybackClock {
  private clocks = new Map<string, ClockState>();

  start(deviceId: string, trackId: string, durationMs: number, trackTitle?: string, audioId?: string): void {
    this.clocks.set(deviceId, {
      deviceId,
      trackId,
      trackTitle,
      durationMs: durationMs > 0 ? durationMs : 0,
      isPlaying: true,
      lastStateChangeAt: Date.now(),
      accumulatedMs: 0,
      lastAudioId: audioId,
    });
  }

  pause(deviceId: string): void {
    const clock = this.clocks.get(deviceId);
    if (!clock || !clock.isPlaying) return;
    const now = Date.now();
    clock.accumulatedMs += Math.max(0, now - clock.lastStateChangeAt);
    clock.isPlaying = false;
    clock.lastStateChangeAt = now;
  }

  resume(deviceId: string): void {
    const clock = this.clocks.get(deviceId);
    if (!clock || clock.isPlaying) return;
    clock.isPlaying = true;
    clock.lastStateChangeAt = Date.now();
  }

  getElapsedMs(deviceId: string): number {
    const clock = this.clocks.get(deviceId);
    if (!clock) return 0;
    if (clock.isPlaying) {
      return clock.accumulatedMs + Math.max(0, Date.now() - clock.lastStateChangeAt);
    }
    return clock.accumulatedMs;
  }

  isPlaying(deviceId: string): boolean {
    const clock = this.clocks.get(deviceId);
    return Boolean(clock?.isPlaying);
  }

  getDurationMs(deviceId: string): number {
    return this.clocks.get(deviceId)?.durationMs || 0;
  }

  isFinished(deviceId: string, bufferMs = 500): boolean {
    const clock = this.clocks.get(deviceId);
    if (!clock || !clock.isPlaying || clock.durationMs <= 0) return false;
    return this.getElapsedMs(deviceId) >= clock.durationMs + bufferMs;
  }

  getClock(deviceId: string): ClockState | undefined {
    return this.clocks.get(deviceId);
  }

  getCurrentTrackId(deviceId: string): string | undefined {
    return this.clocks.get(deviceId)?.trackId;
  }

  getCurrentAudioId(deviceId: string): string | undefined {
    return this.clocks.get(deviceId)?.lastAudioId;
  }

  reset(deviceId: string): void {
    this.clocks.delete(deviceId);
  }
}

export const playbackClock = new PlaybackClock();
