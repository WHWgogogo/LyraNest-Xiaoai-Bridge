import { isMinaAuthenticationError, type MinaClient } from "../xiaomi/mina-client.js";
import type { BridgeConfig, XiaomiDevice } from "../types.js";
import type { CommandResult } from "../types.js";
import { parseCommand, type ParsedCommand } from "./command-parser.js";
import { logger } from "../logger.js";

export interface PollContext {
  minaClient: MinaClient;
  config: BridgeConfig;
  selectedDevice?: XiaomiDevice;
  enabledDevices?: XiaomiDevice[];
  refreshMinaClient?: () => Promise<MinaClient | null>;
  onCommand: (parsed: ParsedCommand, device?: XiaomiDevice) => Promise<CommandExecutionResult>;
  onAutoAdvance?: (devices?: XiaomiDevice[]) => Promise<void>;
}

export interface CommandExecutionResult {
  success: boolean;
  track_title?: string;
  error?: string;
}

const MAX_COMMAND_HISTORY = 20;

export class ConversationPoller {
  private lastTimestamps = new Map<string, number>();
  private history: CommandResult[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private isPolling = false;

  start(ctx: PollContext): void {
    this.stop();
    this.startedAt = Date.now() - 5000;
    const intervalMs = Math.max(1000, ctx.config.poll_interval_sec * 1000);
    this.timer = setInterval(() => {
      void this.pollOnce(ctx);
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isPolling = false;
  }

  getHistory(): CommandResult[] {
    return [...this.history].reverse();
  }

  private record(result: Omit<CommandResult, "timestamp">): void {
    this.history.push({ ...result, timestamp: Date.now() });
    if (this.history.length > MAX_COMMAND_HISTORY) {
      this.history.shift();
    }
  }

  async pollOnce(ctx: PollContext): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this.doPollOnce(ctx);
    } finally {
      this.isPolling = false;
    }
  }

  private async doPollOnce(ctx: PollContext): Promise<void> {
    const devices = (ctx.enabledDevices && ctx.enabledDevices.length > 0)
      ? ctx.enabledDevices
      : (ctx.selectedDevice ? [ctx.selectedDevice] : []);

    if (!devices.length) return;

    for (const device of devices) {
      try {
        let latest;
        try {
          latest = await ctx.minaClient.getLatestAsk(device.device_id, device.hardware);
        } catch (error) {
          if (!isMinaAuthenticationError(error) || !ctx.refreshMinaClient) throw error;
          logger.warn("poller", "MiNA 语音会话鉴权失效，正在尝试恢复小米会话...", {
            device_id: device.device_id,
            device_name: device.name,
          });
          const refreshed = await ctx.refreshMinaClient();
          if (!refreshed) throw error;
          latest = await refreshed.getLatestAsk(device.device_id, device.hardware);
        }
        if (!latest?.query) continue;

        const lastTs = this.lastTimestamps.get(device.device_id) ?? this.startedAt;
        if (latest.time <= lastTs) continue;

        this.lastTimestamps.set(device.device_id, latest.time);
        const parsed = parseCommand(latest.query, ctx.config);
        logger.info("poller", `音箱 "${device.name}" 捕获到新语音: "${latest.query}"`, {
          device_id: device.device_id,
          device_name: device.name,
          query: latest.query,
          timestamp: latest.time,
          parsed_action: parsed.action,
          parsed_keyword: parsed.keyword,
        });

        try {
          const result = await ctx.onCommand(parsed, device);
          if (result.success) {
            logger.info("poller", `音箱 "${device.name}" 语音指令 "${latest.query}" 处理成功`, {
              device_name: device.name,
              action: parsed.action,
              track_title: result.track_title,
            });
          } else {
            logger.warn("poller", `音箱 "${device.name}" 语音指令 "${latest.query}" 处理失败: ${result.error}`, {
              device_name: device.name,
              action: parsed.action,
              error: result.error,
            });
          }
          this.record({
            query: latest.query,
            action: parsed.action,
            success: result.success,
            track_title: result.track_title,
            error: result.error,
            device_id: device.device_id,
            device_name: device.name,
          });
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : "command handling failed";
          logger.error("poller", `音箱 "${device.name}" 语音指令 "${latest.query}" 执行异常: ${errMessage}`, {
            device_name: device.name,
            action: parsed.action,
            error: errMessage,
          });
          this.record({
            query: latest.query,
            action: parsed.action,
            success: false,
            error: errMessage,
            device_id: device.device_id,
            device_name: device.name,
          });
        }
      } catch (error) {
        logger.error("poller", `轮询音箱 "${device.name}" 语音对话失败: ${error instanceof Error ? error.message : "unknown"}`, {
          device_id: device?.device_id,
          device_name: device?.name,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    if (ctx.onAutoAdvance) {
      try {
        await ctx.onAutoAdvance(devices);
      } catch (err) {
        logger.warn("poller", `自动连播检查异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
