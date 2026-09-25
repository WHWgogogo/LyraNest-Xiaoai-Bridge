import type { XiaomiDevice } from "../types.js";
import type { MinaClient } from "./mina-client.js";

export interface DeviceListResult {
  devices: XiaomiDevice[];
  error?: string;
}

export async function fetchDevices(client: MinaClient): Promise<DeviceListResult> {
  try {
    const raw = await client.getDevices();
    return { devices: mapDevices(raw) };
  } catch (error) {
    return { devices: [], error: error instanceof Error ? error.message : "failed to fetch devices" };
  }
}

export function mapDevices(raw: Array<{ deviceID: string; name: string; hardware: string; miotDID: string }>): XiaomiDevice[] {
  return raw
    .filter((item) => item.deviceID && item.hardware)
    .map((item) => ({
      device_id: item.deviceID,
      name: item.name || "未知设备",
      hardware: item.hardware,
      miot_did: item.miotDID || undefined,
    }));
}

export function findDevice(devices: XiaomiDevice[], deviceId: string): XiaomiDevice | undefined {
  return devices.find((d) => d.device_id === deviceId);
}
