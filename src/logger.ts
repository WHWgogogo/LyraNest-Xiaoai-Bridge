export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  [key: string]: unknown;
}

export function sanitizeUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const parsed = new URL(rawUrl);
    for (const key of ["token", "media_token", "mediaToken", "access_token"]) {
      if (parsed.searchParams.has(key)) {
        const val = parsed.searchParams.get(key) || "";
        const masked = val.length > 6 ? `${val.slice(0, 4)}...${val.slice(-2)}` : "***";
        parsed.searchParams.set(key, masked);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/([?&](?:token|media_token|mediaToken)=)[^&]+/gi, "$1***");
  }
}

export class Logger {
  private writer: (entry: LogEntry) => void;
  private ringBuffer: LogEntry[] = [];
  private maxBufferSize: number;

  constructor(writer?: (entry: LogEntry) => void, maxBufferSize = 10000) {
    this.maxBufferSize = maxBufferSize;
    this.writer = writer || ((entry: LogEntry) => {
      const line = JSON.stringify(entry);
      if (entry.level === "error") {
        console.error(line);
      } else if (entry.level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    });
  }

  log(level: LogLevel, component: string, message: string, extra?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...(extra || {}),
    };

    if (this.ringBuffer.length >= this.maxBufferSize) {
      this.ringBuffer.shift();
    }
    this.ringBuffer.push(entry);

    this.writer(entry);
  }

  info(component: string, message: string, extra?: Record<string, unknown>): void {
    this.log("info", component, message, extra);
  }

  warn(component: string, message: string, extra?: Record<string, unknown>): void {
    this.log("warn", component, message, extra);
  }

  error(component: string, message: string, extra?: Record<string, unknown>): void {
    this.log("error", component, message, extra);
  }

  debug(component: string, message: string, extra?: Record<string, unknown>): void {
    this.log("debug", component, message, extra);
  }

  getRecentLogs(hours = 1): LogEntry[] {
    const cutoff = Date.now() - Math.max(0.1, hours) * 3600 * 1000;
    return this.ringBuffer.filter((entry) => {
      const ts = new Date(entry.timestamp).getTime();
      return !Number.isNaN(ts) && ts >= cutoff;
    });
  }

  getAllLogs(): LogEntry[] {
    return [...this.ringBuffer];
  }

  clearBuffer(): void {
    this.ringBuffer = [];
  }

  formatExport(envInfo: Record<string, unknown>, hours = 1): string {
    const logs = this.getRecentLogs(hours);
    const nowIso = new Date().toISOString();
    const divider = "=".repeat(80);
    const subDivider = "-".repeat(80);

    const lines: string[] = [
      divider,
      `LyraNest XiaoAI Bridge - 运行诊断日志导出 (最近 ${hours} 小时)`,
      `导出生成时间: ${nowIso}`,
      divider,
      "[系统诊断环境]",
    ];

    for (const [key, value] of Object.entries(envInfo)) {
      if (value === undefined || value === null) continue;
      const formattedValue = typeof value === "object" ? JSON.stringify(value) : String(value);
      lines.push(`- ${key}: ${formattedValue}`);
    }

    lines.push(subDivider);
    lines.push(`[日志事件明细] (共 ${logs.length} 条记录，按时间正序排列)`);
    lines.push(subDivider);

    if (logs.length === 0) {
      lines.push("（该时间窗口内暂无记录的日志事件）");
    } else {
      for (const entry of logs) {
        const { timestamp, level, component, message, ...rest } = entry;
        const levelTag = `[${level.toUpperCase()}]`.padEnd(7, " ");
        const compTag = `[${component}]`.padEnd(12, " ");
        let line = `${timestamp} ${levelTag} ${compTag} ${message}`;
        if (Object.keys(rest).length > 0) {
          try {
            line += ` | ${JSON.stringify(rest)}`;
          } catch {
            // ignore serialization error
          }
        }
        lines.push(line);
      }
    }

    lines.push(divider);
    lines.push("=== 日志导出结束 ===");
    return lines.join("\n") + "\n";
  }
}

export const logger = new Logger();
