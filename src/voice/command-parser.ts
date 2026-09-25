import type { BridgeConfig } from "../types.js";

export interface ParsedCommand {
  action:
    | "next"
    | "previous"
    | "pause"
    | "resume"
    | "stop"
    | "play"
    | "audiobook"
    | "playlist"
    | "favorite"
    | "library"
    | "artist"
    | "system"
    | "ignore"
    | "unknown"
    | "play_mode";
  keyword?: string;
  artist?: string;
  title?: string;
  chapterIndex?: number;
  playMode?: "sequence" | "loop" | "shuffle" | "single_loop";
  targetScope?: "whole_house" | "single";
}

export function parseChineseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  }
  const digits: Record<string, number> = {
    "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
  };
  if (trimmed === "十") return 10;
  let total = 0;
  let current = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (digits[char] !== undefined) {
      current = digits[char];
    } else if (char === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else if (char === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else {
      return null;
    }
  }
  total += current;
  return total > 0 ? total : null;
}

export function extractChapterAndTitle(raw: string): { title: string; chapterIndex?: number } {
  let title = raw.trim();
  const match = title.match(/(?:第)?(\d+|[零一二两三四五六七八九十百]+)[集章节回]$/);
  if (match) {
    const num = parseChineseNumber(match[1]);
    if (num !== null) {
      const cleanTitle = title.slice(0, match.index).trim();
      if (cleanTitle) {
        return { title: cleanTitle, chapterIndex: num };
      }
    }
  }
  return { title };
}

export const DEFAULT_COMMANDS: Record<string, string[]> = {
  next: ["下一首", "换一首", "切歌", "跳过", "下一曲", "换首歌", "切到下一首"],
  previous: ["上一首", "前一首", "上一曲", "倒回去"],
  pause: ["暂停", "暂停播放", "音乐暂停", "别放了", "先别放", "先停一下"],
  resume: ["继续播放", "恢复播放", "继续放", "接着放", "继续听", "接着播", "接着听", "播放继续", "恢复声音"],
  stop: ["停止", "停止播放", "停", "关掉", "关机", "退出播放", "别唱了", "别放了", "不要放啦", "闭嘴"],
  favorite: ["播放收藏", "播放我喜欢的歌", "播放我喜欢的音乐", "听收藏", "放收藏", "我喜欢的歌", "我喜欢的音乐"],
  playlist: ["播放歌单", "放歌单", "听歌单", "歌单", "播放列表", "放列表"],
  library: ["播放曲库", "放曲库", "听曲库", "曲库", "播放媒体库", "放媒体库", "媒体库"],
  shuffle: [
    "随机播放", "乱序播放", "随便播放", "随便放点音乐", "随便放首歌", "随便放歌",
    "随便放点歌", "随便听听", "随机听歌", "随便来点歌", "随便来首歌", "随机来点音乐",
    "播放本地歌曲", "播放本地音乐", "本地歌曲", "本地音乐", "播放我的音乐",
  ],
  loop: [
    "循环播放", "连续播放", "列表循环", "全部循环", "循环队列", "循环模式", "连续模式", "列表循环播放",
  ],
  single_loop: [
    "单曲循环", "单曲循环播放", "重复播放这首", "单曲循环模式", "单曲循环听",
  ],
  sequence: [
    "顺序播放", "顺序队列", "列表播放", "按顺序播放", "顺序模式",
  ],
  audiobook: [
    "继续播放有声书", "接着播放有声书", "播放有声书",
    "继续听有声书", "接着听有声书", "听有声书",
    "继续播放小说", "接着播放小说", "播放小说",
    "继续听小说", "接着听小说", "听小说",
    "我想听有声书", "我想听小说", "我想听书",
    "继续听书", "接着听书", "听书",
    "有声书",
  ],
  play: ["播放歌曲", "播放", "放歌", "放一首", "来一首", "我想听"],
};

export function cleanPunctuation(text: string): string {
  return text
    .trim()
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "")
    .trim();
}

function matchesControlKeyword(text: string, kw: string): boolean {
  if (!kw) return false;
  if (text === kw) return true;
  if (text.startsWith(kw + " ") || text.endsWith(" " + kw)) return true;
  // Natural Chinese prefixes/suffixes
  const cleanWithoutPrefix = text.replace(/^(帮我|请|麻烦|给我|来个|来一次|播放|继续)/, "");
  const cleanWithoutSuffix = cleanWithoutPrefix.replace(/(吧|啊|呀|呢|一下|歌曲|音乐|模式|队列)$/, "");
  if (cleanWithoutSuffix === kw || cleanWithoutPrefix === kw) return true;
  return false;
}

export function cleanKeyword(raw: string): string {
  let kw = cleanPunctuation(raw);
  // Strip surrounding quotes and brackets: 《》, “”, '', 【】, [], (), etc.
  kw = kw.replace(/^([:：\-\s]|《|“|”|"|'|【|\[|\()+/, "");
  kw = kw.replace(/([:：\-\s]|》|“|”|"|'|】|\]|\))+$/, "");
  // Strip leading action words if any leaked through suffix slicing
  kw = kw.replace(/^(?:帮我|请|麻烦|我想|给我)?(?:播放|放|听|来)?(?:一下)?(?:我的|我创建的|自定义)?/, "");
  // Strip trailing helper words: 的歌, 里的歌, 的歌曲, 里的歌曲, 的
  kw = kw.replace(/(?:里的歌曲|的歌曲|里的歌|的歌|歌曲|音乐|的)$/, "");
  return cleanPunctuation(kw);
}

function extractStructuredPattern(
  trimmed: string,
  prefixes: string[],
  nouns: string[],
): string | null {
  const nounPattern = nouns.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const prefixRegex = new RegExp(
    `^(?:帮我|请|麻烦|我想|给我)?(?:播放|放|听|来)?(?:一下)?(?:我的|我创建的|自定义)?(?:${nounPattern})(?:[:：\\s]+(.*)|(.*))?$`,
  );
  const pMatch = trimmed.match(prefixRegex);
  if (pMatch) {
    return cleanKeyword(pMatch[1] || pMatch[2] || "");
  }

  const suffixRegex = new RegExp(
    `^(?:帮我|请|麻烦|我想|给我)?(?:播放|放|听|来)?(?:一下)?(.+?)(?:的)?(?:${nounPattern})$`,
  );
  const sMatch = trimmed.match(suffixRegex);
  if (sMatch) {
    return cleanKeyword(sMatch[1] || "");
  }

  const sorted = [...prefixes].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    if (!p) continue;
    if (trimmed.startsWith(p + " ") || (trimmed.startsWith(p) && trimmed !== p)) {
      return cleanKeyword(trimmed.slice(p.length));
    }
    if (trimmed.endsWith(" " + p) || (trimmed.endsWith(p) && trimmed !== p)) {
      return cleanKeyword(trimmed.slice(0, -p.length));
    }
  }

  return null;
}

const SYSTEM_VOLUME_PATTERNS = [
  /^(?:把)?(?:音量|声音)(?:调[大宽高]|增大|加大|增加|调[小低]|减小|降低|调到|设置为?|\d+|[一二两三四五六七八九十百]+)/,
  /^(?:调[大宽高]|增大|加大|增加)?音量(?:调?[大宽高]|加|\+|\d+)?$/,
  /^(?:调[小低]|减小|降低)?音量(?:调?[小低]|减|\-|\d+)?$/,
  /^(?:把)?(?:声音|音量)?(?:[太最很更]|再)?(?:大|小|高|低)(?:一点|一些|点|些)?$/,
  /^(?:大点声|小点声|大声点|小声点)$/,
  /^(?:静音|恢复音量|解除静音)$/,
];

const SMART_HOME_PATTERNS = [
  /^(?:打开|关闭|关掉|调高|调低|开启|关上|合上|拉开|升起|下降|提升)(?!.*(?:音乐|歌曲|曲库|歌单|有声书|小说|音箱)).*$/,
  /^(?:空调|电视|窗帘|台灯|晾衣架|吊灯|射灯|筒灯|插座|开关|热水器|扫地机|新风|净化器).*$/,
];

const IGNORE_PATTERNS = [
  // Weather & environmental info
  /.*(?:天气|气温|温度|下雨|刮风|空气质量|pm2\.?5|晴天吗|冷不冷|热不热).*/i,
  // Time & Date & Alarms
  /.*(?:几点|时间|日期|几号|星期几|周几|闹钟|倒计时|提醒我|计时器).*/,
  // Chit-chat & Assistant interactions & Exit
  /^(?:退出|退下|再见|拜拜|没事了|没事|取消|返回|不用了|闭嘴|安静|别说了|停一下)$/,
  /.*(?:你是谁|你能做|你叫什么|做个自我介绍|讲个笑话|讲笑话|猜谜语|背首诗|背诗).*/,
  /.*(?:翻译|计算|算一下|加减乘除|等于几|怎么走|导航|路况).*/,
  // Smart Home & IoT commands (enhanced)
  /^(?:打开|关闭|关掉|关上|合上|拉开|升起|下降|提升|开启|调高|调低|把|将).*(?:空调|电视|窗帘|台灯|灯|射灯|筒灯|吊灯|插座|开关|热水器|扫地机|扫地机器人|新风|净化器|门锁|风扇|加湿器|除湿机).*$/,
  /.*(?:空调|电视|窗帘|台灯|插座|开关|热水器|扫地机|新风|净化器|风扇|加湿器).*(?:开|关|度|档|模式|调|风速|定时).*/,
];

function buildPlayCommand(rawTarget: string): ParsedCommand {
  const target = cleanPunctuation(rawTarget);
  if (!target) return { action: "play", keyword: "" };

  // Check for "{artist} 的 {title}" qualifier (e.g. "周杰伦的晴天", "张学友的吻别", "王菲的如愿", "周蕙的风铃")
  // or "{artist} {title}" with whitespace
  const qualifierMatch = target.match(/^(.+?)(?:的|\s+)(.+)$/);
  if (qualifierMatch && qualifierMatch[1] && qualifierMatch[2]) {
    const a = cleanKeyword(qualifierMatch[1]);
    const t = cleanKeyword(qualifierMatch[2]);
    if (a && t) {
      return { action: "play", keyword: target, artist: a, title: t };
    }
  }
  return { action: "play", keyword: target, title: target };
}

function withScope(cmd: ParsedCommand, isWholeHouse: boolean): ParsedCommand {
  if (isWholeHouse) {
    cmd.targetScope = "whole_house";
  }
  return cmd;
}

export function parseCommand(query: string, config: BridgeConfig): ParsedCommand {
  const trimmed = cleanPunctuation(query);
  if (!trimmed) return { action: "play", keyword: "" };

  // Detect whole-house scope
  let isWholeHouse = false;
  let targetQuery = trimmed;
  const wholeHousePrefixMatch = targetQuery.match(/^(?:全屋|整个屋子|所有房间|全屋音箱|全屋音乐|全屋背景音乐)\s*/);
  if (wholeHousePrefixMatch) {
    isWholeHouse = true;
    targetQuery = targetQuery.slice(wholeHousePrefixMatch[0].length).trim();
  } else if (/^(?:播放全屋背景音乐|开启全屋背景音乐|打开全屋背景音乐|放全屋背景音乐)$/.test(targetQuery)) {
    return { action: "play", targetScope: "whole_house", keyword: "" };
  }

  if (isWholeHouse && (!targetQuery || /^(?:背景音乐|音乐|歌|放歌|放音乐|随便放|随便播)$/.test(targetQuery))) {
    return { action: "play", targetScope: "whole_house", keyword: "" };
  }

  const queryToParse = targetQuery || trimmed;

  // Exact whole-library or generic shuffle play requests without track keywords
  if (/^(?:播放|听|放)?(?:全部歌曲|所有歌曲|全部音乐|所有音乐)$/.test(queryToParse)) {
    return withScope({ action: "library", keyword: "" }, isWholeHouse);
  }
  if (/^(?:播放歌曲|播放音乐|放歌|放音乐|听歌|听音乐)$/.test(queryToParse)) {
    return withScope({ action: "play_mode", playMode: "shuffle" }, isWholeHouse);
  }

  const commands = config.voice_commands || {};

  // 1. Check control commands (next, previous, pause, resume, stop) first so that "关掉", "停" etc. are honored
  for (const action of ["next", "previous", "pause", "resume", "stop"] as const) {
    const userList = Array.isArray(commands[action]) ? commands[action] : [];
    const list = Array.from(new Set([...userList, ...(DEFAULT_COMMANDS[action] || [])]));
    for (const kw of list) {
      if (!kw) continue;
      if (matchesControlKeyword(queryToParse, kw)) {
        return withScope({ action }, isWholeHouse);
      }
    }
  }

  // 2. Ignore system/volume/smart home commands to prevent accidental music searching and interrupted playback
  if (
    SYSTEM_VOLUME_PATTERNS.some((pattern) => pattern.test(queryToParse)) ||
    SMART_HOME_PATTERNS.some((pattern) => pattern.test(queryToParse))
  ) {
    return { action: "system" };
  }

  // 3. Ignore non-music voice interactions (chit-chat, weather, exit) to prevent false song searches
  if (IGNORE_PATTERNS.some((pattern) => pattern.test(queryToParse))) {
    return { action: "ignore" };
  }

  // 1.5 Check play mode commands (shuffle, loop, single_loop, sequence)
  const modeActions = [
    ["shuffle", "shuffle"],
    ["loop", "loop"],
    ["single_loop", "single_loop"],
    ["sequence", "sequence"],
  ] as const;
  for (const [actionName, targetMode] of modeActions) {
    const userList = Array.isArray(commands[actionName]) ? commands[actionName] : [];
    const list = Array.from(new Set([...userList, ...(DEFAULT_COMMANDS[actionName] || [])]));
    for (const kw of list) {
      if (!kw) continue;
      if (matchesControlKeyword(queryToParse, kw)) {
        return withScope({ action: "play_mode", playMode: targetMode }, isWholeHouse);
      }
    }
  }

  // 2. Check favorite patterns: "播放收藏", "我喜欢的歌", etc.
  const userFavorite = Array.isArray(commands.favorite) ? commands.favorite : [];
  const favoriteList = Array.from(new Set([...userFavorite, ...(DEFAULT_COMMANDS.favorite || [])]));
  for (const kw of favoriteList) {
    if (!kw) continue;
    if (matchesControlKeyword(queryToParse, kw)) {
      return withScope({ action: "favorite" }, isWholeHouse);
    }
  }

  // 3. Check playlist patterns: "播放歌单 <name>", "听歌单 <name>", "<name> 歌单", "播放列表 <name>"
  const userPlaylist = Array.isArray(commands.playlist) ? commands.playlist : [];
  const playlistList = Array.from(new Set([...userPlaylist, ...(DEFAULT_COMMANDS.playlist || [])]));
  const playlistKeyword = extractStructuredPattern(queryToParse, playlistList, ["歌单", "播放列表"]);
  if (playlistKeyword !== null) {
    return withScope({ action: "playlist", keyword: playlistKeyword }, isWholeHouse);
  }

  // 4. Check library patterns: "播放曲库 <name>", "放曲库 <name>", "<name> 曲库", "播放媒体库 <name>"
  const userLibrary = Array.isArray(commands.library) ? commands.library : [];
  const libraryList = Array.from(new Set([...userLibrary, ...(DEFAULT_COMMANDS.library || [])]));
  const libraryKeyword = extractStructuredPattern(queryToParse, libraryList, ["曲库", "媒体库"]);
  if (libraryKeyword !== null) {
    return withScope({ action: "library", keyword: libraryKeyword }, isWholeHouse);
  }

  // 5. Check for Audiobook patterns: custom prefixes first, sorted by length descending
  const userAudiobook = Array.isArray(commands.audiobook) ? commands.audiobook : [];
  const audiobookList = Array.from(new Set([...userAudiobook, ...(DEFAULT_COMMANDS.audiobook || [])]));
  const sortedAudiobook = [...audiobookList].sort((a, b) => b.length - a.length);

  for (const prefix of sortedAudiobook) {
    if (!prefix) continue;
    if (queryToParse.startsWith(prefix + " ") || (queryToParse.startsWith(prefix) && queryToParse !== prefix)) {
      const content = queryToParse.slice(prefix.length).trim();
      if (content) {
        const { title, chapterIndex } = extractChapterAndTitle(content);
        const cmd: ParsedCommand = { action: "audiobook", keyword: title };
        if (chapterIndex !== undefined) cmd.chapterIndex = chapterIndex;
        return withScope(cmd, isWholeHouse);
      }
    }
  }

  // 6. Check for Artist patterns: "播放王菲的歌", "听周杰伦的歌曲", "播放五月天所有的歌"
  const artistMatch = queryToParse.match(
    /^(?:帮我|请|麻烦|我想|给我)?(?:播放|放|听|来一首|来个|来点)?(?:一下)?(.+?)(?:的所有歌|的全部歌|所有歌|全部歌|的歌曲|的歌|歌曲|歌)$/,
  );
  if (artistMatch && artistMatch[1]) {
    let rawArtist = artistMatch[1];
    rawArtist = rawArtist.replace(/(?:的所有|的全部|所有|全部)$/, "");
    const cleanArtist = cleanKeyword(rawArtist);
    if (cleanArtist && !/^(?:我喜欢|收藏|列表|歌单|曲库)$/.test(cleanArtist)) {
      return withScope({ action: "artist", keyword: cleanArtist, artist: cleanArtist }, isWholeHouse);
    }
  }

  // 7. Check for "播放 <song>" or "<song> 播放" patterns: custom prefixes first, sorted by length descending
  const userPlay = Array.isArray(commands.play) ? commands.play : [];
  const playList = Array.from(new Set([...userPlay, ...(DEFAULT_COMMANDS.play || [])]));
  const sortedPlay = [...playList].sort((a, b) => b.length - a.length);

  for (const prefix of sortedPlay) {
    if (!prefix) continue;
    if (queryToParse.startsWith(prefix + " ") || (queryToParse.startsWith(prefix) && queryToParse !== prefix)) {
      const song = queryToParse.slice(prefix.length).trim();
      if (song) {
        return withScope(buildPlayCommand(song), isWholeHouse);
      }
    }
    if (queryToParse.endsWith(" " + prefix)) {
      const song = queryToParse.slice(0, -prefix.length - 1).trim();
      if (song) {
        return withScope(buildPlayCommand(song), isWholeHouse);
      }
    }
  }

  // Fallback: treat queryToParse as search keyword.
  return withScope(buildPlayCommand(queryToParse), isWholeHouse);
}
