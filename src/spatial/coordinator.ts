import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BridgeState } from "../index.js";
import type { LyraNestTrack, XiaomiDevice, XiaomiTokens } from "../types.js";
import { profileFor } from "../types.js";
import { logger } from "../logger.js";
import { MinaClient, deriveAudioId } from "../xiaomi/mina-client.js";
import { withXiaomiSession } from "../xiaomi/with-session.js";
import { buildStreamUrl } from "../lyranest/url-builder.js";
import { playbackClock } from "../playback/playback-clock.js";
import type { QueueManager } from "../playback/queue-manager.js";
import type { LyraNestClient } from "../lyranest/api-client.js";
import { resolvePlaybackProtocol, resolveTranscode } from "../runtime.js";
import {
  type SpatialGroup,
  type SpatialTopologyMode,
  type SpatialSlotRole,
  type SpatialSlotConfig,
  SPATIAL_ROLE_DEFINITIONS,
} from "./types.js";

const SPATIAL_DEVICE_PREFIX = "spatial:";

export class SpatialCoordinator {
  private dataFilePath: string;
  private groups: Map<string, SpatialGroup> = new Map();

  constructor(dataDir: string) {
    this.dataFilePath = join(dataDir, "spatial-groups.json");
    this.load();
  }

  private load(): void {
    if (!existsSync(this.dataFilePath)) return;
    try {
      const raw = readFileSync(this.dataFilePath, "utf8");
      const list = JSON.parse(raw) as SpatialGroup[];
      if (Array.isArray(list)) {
        this.groups.clear();
        for (const g of list) {
          if (g && typeof g.id === "string" && g.name) {
            this.groups.set(g.id, g);
          }
        }
      }
    } catch (err) {
      logger.warn("spatial", `加载空间音频配置失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private save(): void {
    try {
      const dir = join(this.dataFilePath, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const list = Array.from(this.groups.values());
      writeFileSync(this.dataFilePath, JSON.stringify(list, null, 2), "utf8");
    } catch (err) {
      logger.error("spatial", `保存空间音频配置失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getGroups(): SpatialGroup[] {
    return Array.from(this.groups.values());
  }

  getGroup(id: string): SpatialGroup | undefined {
    return this.groups.get(id);
  }

  isSpatialDeviceId(deviceId: string): boolean {
    return typeof deviceId === "string" && deviceId.startsWith(SPATIAL_DEVICE_PREFIX);
  }

  extractGroupId(deviceId: string): string {
    return deviceId.slice(SPATIAL_DEVICE_PREFIX.length);
  }

  toVirtualDevice(group: SpatialGroup): XiaomiDevice {
    const activeRoles = this.getActiveRolesForMode(group.mode, group);
    const slotCount = activeRoles.filter((r) => Boolean(group.slots[r]?.deviceId)).length;
    const modeLabel = group.mode === "stereo_2_0"
      ? "2.0 立体声"
      : group.mode === "front_center_3_1"
        ? "3.1 前排"
        : group.mode === "surround_5_1"
          ? "5.1 环绕"
          : "全屋背景音乐";
    const prefix = group.mode === "whole_house" ? "🏠 " : "";
    return {
      device_id: `${SPATIAL_DEVICE_PREFIX}${group.id}`,
      name: `${prefix}[${modeLabel}] ${group.name} (${slotCount}箱)`,
      hardware: group.mode === "whole_house" ? "SPATIAL_WHOLE_HOUSE" : "SPATIAL_GROUP",
    };
  }

  getActiveRolesForMode(mode: SpatialTopologyMode, group?: SpatialGroup | { slots?: Record<string, any> }): string[] {
    switch (mode) {
      case "stereo_2_0":
        return ["FL", "FR"];
      case "front_center_3_1":
        return ["FL", "FR", "FC"];
      case "surround_5_1":
        return ["FL", "FR", "FC", "SL", "SR"];
      case "whole_house": {
        if (group?.slots) {
          const keys = Object.keys(group.slots);
          if (keys.length > 0) return keys;
        }
        return ["ZONE_1", "ZONE_2", "ZONE_3", "ZONE_4", "ZONE_5", "ZONE_6", "ZONE_7", "ZONE_8"];
      }
      default:
        return ["FL", "FR"];
    }
  }

  saveGroup(payload: {
    id?: string;
    name: string;
    mode: SpatialTopologyMode;
    enabled?: boolean;
    slots: Partial<Record<string, SpatialSlotConfig>>;
    masterRole?: string;
  }): SpatialGroup {
    const now = Date.now();
    const id = payload.id || `sp_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const existing = this.groups.get(id);

    const activeRoles = this.getActiveRolesForMode(payload.mode, payload);
    const cleanedSlots: Partial<Record<string, SpatialSlotConfig>> = {};
    for (const role of activeRoles) {
      if (payload.slots[role]) {
        cleanedSlots[role] = {
          role,
          deviceId: payload.slots[role]!.deviceId || "",
          deviceName: payload.slots[role]!.deviceName || "",
          hardware: payload.slots[role]!.hardware || "",
          delayMs: Math.max(-150, Math.min(150, Number(payload.slots[role]!.delayMs) || 0)),
          volumeOffsetDb: Math.max(-6, Math.min(6, Number(payload.slots[role]!.volumeOffsetDb) || 0)),
          zoneName: payload.slots[role]!.zoneName ? String(payload.slots[role]!.zoneName).trim() : undefined,
        };
      }
    }

    const group: SpatialGroup = {
      id,
      name: payload.name.trim() || (payload.mode === "whole_house" ? `全屋背景音乐 ${id}` : `空间音频组 ${id}`),
      mode: payload.mode,
      enabled: payload.enabled !== false,
      slots: cleanedSlots,
      masterRole: payload.masterRole && activeRoles.includes(payload.masterRole) ? payload.masterRole : (activeRoles[0] || "FL"),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.groups.set(id, group);
    this.save();
    logger.info("spatial", `空间音频/全屋设备组已保存: "${group.name}" [模式: ${group.mode}]`, {
      group_id: group.id,
      slots_count: Object.keys(cleanedSlots).length,
    });
    return group;
  }

  deleteGroup(id: string): boolean {
    const existed = this.groups.delete(id);
    if (existed) {
      this.save();
      logger.info("spatial", `空间音频设备组已删除: ID ${id}`);
    }
    return existed;
  }

  async playTrack(
    state: BridgeState,
    group: SpatialGroup,
    track: LyraNestTrack,
    queueMgr?: QueueManager,
    client?: LyraNestClient,
  ): Promise<boolean> {
    const activeRoles = this.getActiveRolesForMode(group.mode, group);
    const targetSlots: Array<{ role: string; config: SpatialSlotConfig; device: XiaomiDevice }> = [];

    const allKnownDevices = [...(state.allDevices || []), ...(state.enabledDevices || [])];
    for (const role of activeRoles) {
      const slotConfig = group.slots[role];
      if (!slotConfig || !slotConfig.deviceId) continue;
      const dev = allKnownDevices.find((d) => d.device_id === slotConfig.deviceId);
      if (dev) {
        targetSlots.push({ role, config: slotConfig, device: dev });
      }
    }

    if (targetSlots.length === 0) {
      logger.warn("spatial", `空间音频/全屋组 "${group.name}" 未配置任何在线的音箱设备，无法播放`, { group_id: group.id });
      return false;
    }

    const lnClient = client || (state.selectedDevice ? state.lyraNestClients.get(state.selectedDevice.device_id) : undefined) || state.lyraNest;
    const mediaToken = await lnClient.getMediaToken();
    const baseStreamUrl = buildStreamUrl(state.config.speaker_base_url, track.id, mediaToken);

    const isWholeHouse = group.mode === "whole_house";
    logger.info("spatial", `正在向${isWholeHouse ? "全屋背景音乐组" : "空间音频组"} "${group.name}" 下发多音箱协同播放指令 (共 ${targetSlots.length} 台音箱)`, {
      group_id: group.id,
      track_id: track.id,
      track_title: track.title,
      roles: targetSlots.map((s) => `${s.role}:${s.device.name}`).join(", "),
    });

    // 并发下发各个声道的播放指令
    const playPromises = targetSlots.map(async ({ role, config: slotConfig, device }) => {
      const preferredProtocol = resolvePlaybackProtocol(state.config, device.hardware, device.device_id);
      const transcode = resolveTranscode(state.config, device.hardware, device.device_id);
      const slotBaseUrl = buildStreamUrl(state.config.speaker_base_url, track.id, mediaToken, transcode);

      // 附加声道参数与延时补偿参数 (供支持声道隔离的服务端使用)
      const channelParam = isWholeHouse ? "whole_house" : role;
      const streamUrl = `${slotBaseUrl}&channel=${channelParam}&delay_ms=${slotConfig.delayMs}`;

      return await withXiaomiSession(
        state,
        (tokens: XiaomiTokens) => new MinaClient(tokens).playByUrlWithFallback(
          device.device_id,
          streamUrl,
          preferredProtocol,
          track.id,
        ),
      );
    });

    const results = await Promise.allSettled(playPromises);
    const successCount = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;

    if (successCount > 0) {
      if (queueMgr) {
        queueMgr.setActive(true);
      }
      playbackClock.start(
        `${SPATIAL_DEVICE_PREFIX}${group.id}`,
        track.id,
        track.duration_ms || 0,
        track.title,
        track.id ? deriveAudioId(track.id) : undefined,
      );
      logger.info("spatial", `空间音频/全屋组已成功启动协同播放 (${successCount}/${targetSlots.length} 正常出声)`, {
        group_id: group.id,
        track_title: track.title,
        success_count: successCount,
      });
      return true;
    }

    logger.error("spatial", `空间音频/全屋组所有音箱均拒绝了播放指令: "${track.title}"`, { group_id: group.id });
    return false;
  }

  async controlGroup(
    state: BridgeState,
    groupId: string,
    operation: "play" | "pause" | "stop" | "next" | "prev",
  ): Promise<{ success: boolean; count: number }> {
    const group = this.groups.get(groupId);
    if (!group) return { success: false, count: 0 };

    const activeRoles = this.getActiveRolesForMode(group.mode, group);
    const physicalDeviceIds: string[] = [];
    for (const role of activeRoles) {
      const slot = group.slots[role];
      if (slot?.deviceId && !physicalDeviceIds.includes(slot.deviceId)) {
        physicalDeviceIds.push(slot.deviceId);
      }
    }

    if (physicalDeviceIds.length === 0) return { success: true, count: 0 };

    const promises = physicalDeviceIds.map(async (deviceId) => {
      try {
        return await withXiaomiSession(
          state,
          (tokens: XiaomiTokens) => new MinaClient(tokens).playOperation(deviceId, operation),
        );
      } catch {
        return false;
      }
    });

    const results = await Promise.allSettled(promises);
    const successCount = results.filter((r) => r.status === "fulfilled" && r.value).length;
    logger.info("spatial", `已向空间音频/全屋组 "${group.name}" 下发播控操作 "${operation}" (${successCount}/${physicalDeviceIds.length} 成功)`, {
      group_id: groupId,
      operation,
      success_count: successCount,
    });
    return { success: successCount > 0, count: successCount };
  }

  async setGroupVolume(
    state: BridgeState,
    groupId: string,
    volume: number,
  ): Promise<{ success: boolean; count: number }> {
    const group = this.groups.get(groupId);
    if (!group) return { success: false, count: 0 };

    const activeRoles = this.getActiveRolesForMode(group.mode, group);
    const physicalDeviceIds: string[] = [];
    for (const role of activeRoles) {
      const slot = group.slots[role];
      if (slot?.deviceId && !physicalDeviceIds.includes(slot.deviceId)) {
        physicalDeviceIds.push(slot.deviceId);
      }
    }

    if (physicalDeviceIds.length === 0) return { success: true, count: 0 };

    const promises = physicalDeviceIds.map(async (deviceId) => {
      try {
        return await withXiaomiSession(
          state,
          (tokens: XiaomiTokens) => new MinaClient(tokens).setVolume(deviceId, volume),
        );
      } catch {
        return false;
      }
    });

    const results = await Promise.allSettled(promises);
    const successCount = results.filter((r) => r.status === "fulfilled" && r.value).length;
    logger.info("spatial", `已向空间音频/全屋组 "${group.name}" 下发音量调节 "${volume}" (${successCount}/${physicalDeviceIds.length} 成功)`, {
      group_id: groupId,
      volume,
      success_count: successCount,
    });
    return { success: successCount > 0, count: successCount };
  }

  async playTestTone(
    state: BridgeState,
    groupId: string,
    targetRole?: string,
  ): Promise<{ success: boolean; message: string; details: Array<{ role: string; deviceName: string; ok: boolean }> }> {
    const group = this.groups.get(groupId);
    if (!group) return { success: false, message: `空间音频/全屋组不存在 (ID: ${groupId})`, details: [] };

    const activeRoles = this.getActiveRolesForMode(group.mode, group);
    const rolesToTest = targetRole ? [targetRole] : activeRoles;
    const details: Array<{ role: string; deviceName: string; ok: boolean }> = [];

    for (const role of rolesToTest) {
      const slot = group.slots[role];
      if (!slot || !slot.deviceId) continue;
      let toneText = "";
      if (group.mode === "whole_house") {
        const roomName = slot.zoneName || slot.deviceName || "当前房间";
        toneText = `${roomName} 全屋背景音乐就绪`;
      } else {
        const def = SPATIAL_ROLE_DEFINITIONS[role];
        toneText = `${def?.label || role} 测试音`;
      }

      try {
        const ok = await withXiaomiSession(
          state,
          (tokens: XiaomiTokens) => new MinaClient(tokens).textToSpeech(slot.deviceId, toneText),
        );
        details.push({ role, deviceName: slot.deviceName || slot.deviceId, ok });
      } catch (err) {
        details.push({ role, deviceName: slot.deviceName || slot.deviceId, ok: false });
      }
    }

    const okCount = details.filter((d) => d.ok).length;
    return {
      success: okCount > 0,
      message: `已向 ${okCount}/${details.length} 台音箱下发发声校准提示`,
      details,
    };
  }
}
