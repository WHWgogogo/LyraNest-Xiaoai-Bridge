export type SpatialTopologyMode = "stereo_2_0" | "front_center_3_1" | "surround_5_1" | "whole_house";

export type SpatialSlotRole =
  | "FL"
  | "FR"
  | "FC"
  | "SL"
  | "SR"
  | "ZONE_1"
  | "ZONE_2"
  | "ZONE_3"
  | "ZONE_4"
  | "ZONE_5"
  | "ZONE_6"
  | "ZONE_7"
  | "ZONE_8"
  | "ZONE_9"
  | "ZONE_10"
  | "ZONE_11"
  | "ZONE_12"
  | "ZONE_13"
  | "ZONE_14"
  | "ZONE_15"
  | "ZONE_16"
  | string;

export interface SpatialSlotRoleDefinition {
  role: string;
  label: string;
  channelName: string;
  description: string;
  requiredFor: SpatialTopologyMode[];
}

export const SPATIAL_ROLE_DEFINITIONS: Record<string, SpatialSlotRoleDefinition> = {
  FL: {
    role: "FL",
    label: "左前置 / 左声道",
    channelName: "Front Left",
    description: "负责主立体声左侧声场与前置乐器定位",
    requiredFor: ["stereo_2_0", "front_center_3_1", "surround_5_1"],
  },
  FR: {
    role: "FR",
    label: "右前置 / 右声道",
    channelName: "Front Right",
    description: "负责主立体声右侧声场与前置乐器定位",
    requiredFor: ["stereo_2_0", "front_center_3_1", "surround_5_1"],
  },
  FC: {
    role: "FC",
    label: "中置声道 (人声/对白)",
    channelName: "Front Center",
    description: "负责歌手主唱居中聚焦与电影人声对白",
    requiredFor: ["front_center_3_1", "surround_5_1"],
  },
  SL: {
    role: "SL",
    label: "左后环绕",
    channelName: "Surround Left",
    description: "负责左侧及左后方环境音效与包围感",
    requiredFor: ["surround_5_1"],
  },
  SR: {
    role: "SR",
    label: "右后环绕",
    channelName: "Surround Right",
    description: "负责右侧及右后方环境音效与包围感",
    requiredFor: ["surround_5_1"],
  },
  ZONE_1: {
    role: "ZONE_1",
    label: "房间 1",
    channelName: "Multi-Room Zone 1",
    description: "全屋背景音乐房间/分区 1",
    requiredFor: ["whole_house"],
  },
  ZONE_2: {
    role: "ZONE_2",
    label: "房间 2",
    channelName: "Multi-Room Zone 2",
    description: "全屋背景音乐房间/分区 2",
    requiredFor: ["whole_house"],
  },
  ZONE_3: {
    role: "ZONE_3",
    label: "房间 3",
    channelName: "Multi-Room Zone 3",
    description: "全屋背景音乐房间/分区 3",
    requiredFor: ["whole_house"],
  },
  ZONE_4: {
    role: "ZONE_4",
    label: "房间 4",
    channelName: "Multi-Room Zone 4",
    description: "全屋背景音乐房间/分区 4",
    requiredFor: ["whole_house"],
  },
  ZONE_5: {
    role: "ZONE_5",
    label: "房间 5",
    channelName: "Multi-Room Zone 5",
    description: "全屋背景音乐房间/分区 5",
    requiredFor: ["whole_house"],
  },
  ZONE_6: {
    role: "ZONE_6",
    label: "房间 6",
    channelName: "Multi-Room Zone 6",
    description: "全屋背景音乐房间/分区 6",
    requiredFor: ["whole_house"],
  },
  ZONE_7: {
    role: "ZONE_7",
    label: "房间 7",
    channelName: "Multi-Room Zone 7",
    description: "全屋背景音乐房间/分区 7",
    requiredFor: ["whole_house"],
  },
  ZONE_8: {
    role: "ZONE_8",
    label: "房间 8",
    channelName: "Multi-Room Zone 8",
    description: "全屋背景音乐房间/分区 8",
    requiredFor: ["whole_house"],
  },
};

export interface SpatialSlotConfig {
  role: string;
  deviceId: string;
  deviceName: string;
  hardware?: string;
  delayMs: number; // -150 to +150
  volumeOffsetDb?: number; // -6 to +6
  zoneName?: string; // 房间/分区名称，如“客厅”、“主卧”、“书房”
}

export interface SpatialGroup {
  id: string;
  name: string;
  mode: SpatialTopologyMode;
  enabled: boolean;
  slots: Partial<Record<string, SpatialSlotConfig>>;
  masterRole: string;
  createdAt: number;
  updatedAt: number;
}

