import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeConfig, DeviceBindingConfig } from "./types.js";

const DEFAULT_CONFIG: BridgeConfig = {
  version: 1,
  enabled: false,
  lyranest_base_url: "",
  lyranest_username: "",
  speaker_base_url: "",
  poll_interval_sec: 2,
  selected_device_id: "",
  voice_commands: {
    next: ["下一首", "换一首", "切歌", "跳过"],
    previous: ["上一首", "前一首"],
    pause: ["暂停", "音乐暂停", "别放了", "先别放", "先停一下"],
    stop: ["停止", "关机", "退出播放", "别唱了", "停", "关掉", "不要放啦", "闭嘴"],
    play: ["播放歌曲", "播放", "放歌", "放一首", "来一首", "我想听"],
    audiobook: ["播放有声书", "继续播放有声书", "听小说", "听书", "我想听书", "继续听书", "有声书"],
    playlist: ["播放歌单", "放歌单", "听歌单", "歌单"],
    library: ["播放曲库", "放曲库", "听曲库", "曲库"],
    favorite: ["播放收藏", "播放我喜欢的歌", "播放我喜欢的音乐", "听收藏", "放收藏", "我喜欢的歌", "我喜欢的音乐"],
  },
  search_limit: 10,
  auto_continue_library: true,
  play_mode: "loop",
  playback_protocol: "auto",
  transcode: "auto",
};

let cachedConfig: BridgeConfig | null = null;
let configPath: string;

export function initConfig(path: string): void {
  configPath = path;
  cachedConfig = null;
}

export async function loadConfig(): Promise<BridgeConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    cachedConfig = validateConfig({ ...DEFAULT_CONFIG, ...parsed });
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  return cachedConfig!;
}

export async function saveConfig(update: Partial<BridgeConfig>): Promise<BridgeConfig> {
  const current = await loadConfig();
  const next = validateConfig({ ...current, ...update });
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(next, null, 2), "utf8");
  cachedConfig = next;
  return next;
}

export function validateConfig(config: BridgeConfig): BridgeConfig {
  if (config.version !== 1) throw new Error("unsupported config version");
  if (typeof config.enabled !== "boolean") config.enabled = false;
  for (const key of ["lyranest_base_url", "lyranest_username", "speaker_base_url", "selected_device_id"] as const) {
    if (typeof config[key] !== "string") config[key] = "";
  }
  const defaultCmds = DEFAULT_CONFIG.voice_commands;
  if (!config.voice_commands || typeof config.voice_commands !== "object") {
    config.voice_commands = { ...defaultCmds };
  } else {
    const cleaned: Record<string, string[]> = {};
    for (const action of ["next", "previous", "pause", "stop", "play", "audiobook", "playlist", "library", "favorite"] as const) {
      const list = config.voice_commands[action];
      if (Array.isArray(list)) {
        const unique = Array.from(new Set(
          list
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter((item) => item.length > 0)
        ));
        cleaned[action] = unique.length > 0 ? unique : [...(defaultCmds[action] || [])];
      } else if (defaultCmds[action]) {
        cleaned[action] = [...defaultCmds[action]];
      }
    }
    for (const [key, val] of Object.entries(config.voice_commands)) {
      if (!cleaned[key] && Array.isArray(val)) {
        cleaned[key] = val.map((x) => String(x).trim()).filter(Boolean);
      }
    }
    config.voice_commands = cleaned;
  }
  if (typeof config.auto_continue_library !== "boolean") {
    config.auto_continue_library = true;
  }
  if (!isHttpUrl(config.lyranest_base_url)) config.lyranest_base_url = "";
  if (!isHttpUrl(config.speaker_base_url)) config.speaker_base_url = "";
  const pollInterval = Number(config.poll_interval_sec);
  config.poll_interval_sec = Number.isFinite(pollInterval)
    ? Math.max(1, Math.min(60, Math.floor(pollInterval)))
    : 2;
  const searchLimit = Number(config.search_limit);
  config.search_limit = Number.isFinite(searchLimit)
    ? Math.max(1, Math.min(50, Math.floor(searchLimit)))
    : 10;
  if (
    config.play_mode !== "sequence" &&
    config.play_mode !== "loop" &&
    config.play_mode !== "shuffle" &&
    config.play_mode !== "single_loop"
  ) {
    config.play_mode = "loop";
  }
  if (
    config.playback_protocol !== "auto" &&
    config.playback_protocol !== "play_music" &&
    config.playback_protocol !== "play_url"
  ) {
    config.playback_protocol = "auto";
  }
  if (
    config.transcode !== "auto" &&
    config.transcode !== "mp3" &&
    config.transcode !== "never"
  ) {
    config.transcode = "auto";
  }
  if (!Array.isArray(config.enabled_device_ids)) {
    config.enabled_device_ids = config.selected_device_id ? [config.selected_device_id] : [];
  } else {
    config.enabled_device_ids = Array.from(new Set(
      config.enabled_device_ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ));
  }
  if (!config.device_bindings || typeof config.device_bindings !== "object") {
    config.device_bindings = {};
  } else {
    const cleanedBindings: Record<string, DeviceBindingConfig> = {};
    for (const [id, binding] of Object.entries(config.device_bindings)) {
      if (binding && typeof binding === "object" && typeof id === "string" && id.trim()) {
        cleanedBindings[id.trim()] = {
          device_id: id.trim(),
          enabled: typeof binding.enabled === "boolean" ? binding.enabled : true,
          lyranest_username: typeof binding.lyranest_username === "string" ? binding.lyranest_username.trim() : undefined,
          lyranest_password: typeof binding.lyranest_password === "string" ? binding.lyranest_password : undefined,
          playback_protocol:
            binding.playback_protocol === "play_music" || binding.playback_protocol === "play_url" || binding.playback_protocol === "auto"
              ? binding.playback_protocol
              : "auto",
          transcode:
            binding.transcode === "auto" || binding.transcode === "mp3" || binding.transcode === "never"
              ? binding.transcode
              : "auto",
        };
      }
    }
    config.device_bindings = cleanedBindings;
  }
  return config;
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
