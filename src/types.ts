export interface DeviceBindingConfig {
  device_id: string;
  enabled?: boolean;
  lyranest_username?: string;
  lyranest_password?: string;
  playback_protocol?: "auto" | "play_music" | "play_url";
  transcode?: "auto" | "mp3" | "never";
}

export interface BridgeConfig {
  version: number;
  enabled: boolean;
  lyranest_base_url: string;
  lyranest_username: string;
  speaker_base_url: string;
  poll_interval_sec: number;
  selected_device_id: string;
  enabled_device_ids?: string[];
  device_bindings?: Record<string, DeviceBindingConfig>;
  voice_commands: Record<string, string[]>;
  search_limit: number;
  auto_continue_library?: boolean;
  play_mode?: "sequence" | "loop" | "shuffle" | "single_loop";
  playback_protocol?: "auto" | "play_music" | "play_url";
  transcode?: "auto" | "mp3" | "never";
}

export interface XiaomiDevice {
  device_id: string;
  name: string;
  hardware: string;
  miot_did?: string;
}

export interface XiaomiTokens {
  user_id: string;
  device_id: string;
  pass_token: string;
  service_token: string;
  c_user_id?: string;
  ssecurity?: string;
  expires_at?: number;
}

export type XiaomiLoginState =
  | "idle"
  | "pending"
  | "verification_required"
  | "authenticated"
  | "failed"
  | "reauth_required";

export interface XiaomiLoginStatus {
  state: XiaomiLoginState;
  message?: string;
  verification_method?: "sms" | "email";
}

export interface DevicePlayStatus {
  status: number;
  volume: number;
  position: number;
  duration: number;
  audioId?: string;
  songTitle?: string;
  unreliable?: boolean;
}

export interface LyraNestTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration_ms?: number;
}

export interface LyraNestPlaylist {
  id: string;
  name: string;
  track_ids?: string[];
}

export interface LyraNestCollections {
  revision?: number;
  favorite_track_ids: string[];
  playlists: LyraNestPlaylist[];
}

export interface LyraNestLibrary {
  id: string;
  name: string;
  kind: "music" | "audiobook" | string;
}

export interface LyraNestBook {
  id: string;
  title: string;
  author?: string;
  narrator?: string;
  description?: string;
  chapter_count: number;
}

export interface LyraNestBookChapter {
  book_id: string;
  track_id: string;
  chapter_index: number;
  chapter_title: string;
  track?: {
    id: string;
    title: string;
    duration?: number;
  };
}

export interface LyraNestBookProgress {
  book_id: string;
  current_track_id: string;
  position_ms: number;
}

export interface CommandResult {
  timestamp: number;
  query: string;
  action: string;
  track_title?: string;
  success: boolean;
  error?: string;
  device_id?: string;
  device_name?: string;
}

export interface DeviceProfile {
  playbackProtocol?: "auto" | "play_music" | "play_url";
  playByMusicUrl?: boolean;
  transcode?: "auto" | "mp3" | "never";
  ttsCommand?: string;
}

// 经过社区与实机严谨验证：
// 1. 触屏版机型与部分带沙箱机型内置了小微沙箱组件，必须走 player_play_music；
// 2. 非触屏标准音箱（如 L05C、L05B、L06、L06A、L09A、Xiaomi Sound 系列等），必须走 player_play_url (type: 1 媒体音乐通道)；
//    若纯音频音箱误走 play_music，音箱会将指令交由腾讯小微官方曲库处理，导致播放官方在线歌曲而非本地歌曲。
// 3. 部分硬件受限芯片机型（全志 R328 等，如 L05C、L05B）硬件不支持原生 FLAC 解码，必须转码为 MP3 串流。
export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  // 触屏版 / 智能家庭屏机型
  LX04: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X08: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X08A: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X10: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X10A: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X08C: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X08E: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X8F: { playByMusicUrl: true, playbackProtocol: "play_music" },
  X4B: { playByMusicUrl: true, playbackProtocol: "play_music" },
  OH2: { playByMusicUrl: true, playbackProtocol: "play_music", ttsCommand: "5-3" },
  OH2P: { playByMusicUrl: true, playbackProtocol: "play_music", ttsCommand: "7-3" },
  X6A: { playByMusicUrl: true, playbackProtocol: "play_music", ttsCommand: "7-3" },

  // 万能遥控版（特定固件接口限制）
  LX05: { playByMusicUrl: true, playbackProtocol: "play_music" },

  // 标准纯音频机型（非触屏音箱）：走 player_play_url 媒体通道
  // 其中 L05C / L05B / L07A / LX01 等不支持 FLAC 解码，默认启用 mp3 转码
  L05B: { playByMusicUrl: false, playbackProtocol: "play_url", transcode: "mp3" },
  L05C: { playByMusicUrl: false, playbackProtocol: "play_url", transcode: "mp3" },
  L06: { playByMusicUrl: false, playbackProtocol: "play_url" },
  L06A: { playByMusicUrl: false, playbackProtocol: "play_url" },
  L07A: { playByMusicUrl: false, playbackProtocol: "play_url", transcode: "mp3" },
  L09A: { playByMusicUrl: false, playbackProtocol: "play_url" },
  L15A: { playByMusicUrl: false, playbackProtocol: "play_url" },
  L16A: { playByMusicUrl: false, playbackProtocol: "play_url" },
  L17A: { playByMusicUrl: false, playbackProtocol: "play_url" },
  L17M: { playByMusicUrl: false, playbackProtocol: "play_url" },
  LX01: { playByMusicUrl: false, playbackProtocol: "play_url", transcode: "mp3" },
  LX06: { playByMusicUrl: false, playbackProtocol: "play_url" },
};

export function profileFor(hardware?: string): DeviceProfile {
  if (!hardware) {
    return { playbackProtocol: "play_url", playByMusicUrl: false };
  }
  const match = DEVICE_PROFILES[hardware];
  if (match) return match;

  // 默认使用更安全通用的 play_url (媒体音频通道)，避免非触屏未知机型报“播放失败请检查网络”
  return {
    playbackProtocol: "play_url",
    playByMusicUrl: false,
  };
}
