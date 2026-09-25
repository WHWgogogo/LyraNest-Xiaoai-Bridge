import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteHandler } from "./router.js";
import { sendJson, readJsonBody } from "./router.js";
import type { BridgeState } from "../index.js";
import type { SpatialCoordinator } from "../spatial/coordinator.js";
import { SPATIAL_ROLE_DEFINITIONS, type SpatialTopologyMode, type SpatialSlotRole } from "../spatial/types.js";

export function spatialGroupsList(coordinator: SpatialCoordinator): RouteHandler {
  return (_req: IncomingMessage, res: ServerResponse) => {
    const groups = coordinator.getGroups();
    sendJson(res, 200, {
      groups,
      role_definitions: SPATIAL_ROLE_DEFINITIONS,
      modes: [
        { id: "whole_house", label: "全屋背景音乐 (多房间漫游)", roles: [], minSpeakers: 2, maxSpeakers: 16 },
        { id: "stereo_2_0", label: "2.0 立体声对", roles: ["FL", "FR"], minSpeakers: 2 },
        { id: "front_center_3_1", label: "3.1 前排影院 (含中置人声)", roles: ["FL", "FR", "FC"], minSpeakers: 3 },
        { id: "surround_5_1", label: "5.1 环绕声系统", roles: ["FL", "FR", "FC", "SL", "SR"], minSpeakers: 5 },
      ],
    });
  };
}

export function spatialGroupSave(coordinator: SpatialCoordinator): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readJsonBody<{
      id?: string;
      name?: string;
      mode?: SpatialTopologyMode;
      enabled?: boolean;
      slots?: Record<string, any>;
      masterRole?: string;
    }>(req);

    if (!body || !body.name || typeof body.name !== "string" || !body.name.trim()) {
      sendJson(res, 400, { error: "组名称不能为空" });
      return;
    }

    if (!body.mode || !["stereo_2_0", "front_center_3_1", "surround_5_1", "whole_house"].includes(body.mode)) {
      sendJson(res, 400, { error: "无效的空间音频模式" });
      return;
    }

    const saved = coordinator.saveGroup({
      id: body.id,
      name: body.name.trim(),
      mode: body.mode,
      enabled: body.enabled !== false,
      slots: body.slots || {},
      masterRole: body.masterRole,
    });

    sendJson(res, 200, { group: saved });
  };
}

export function spatialGroupDelete(coordinator: SpatialCoordinator): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse) => {
    let id = "";
    if (req.method === "POST") {
      try {
        const body = await readJsonBody<{ id?: string }>(req);
        if (body?.id) id = body.id;
      } catch {
        // ignore
      }
    }
    if (!id && req.url) {
      try {
        const url = new URL(req.url, "http://localhost");
        const queryId = url.searchParams.get("id");
        if (queryId) id = queryId;
        else {
          const match = url.pathname.match(/\/api\/spatial\/groups\/([^\/?#]+)/);
          if (match) id = match[1];
        }
      } catch {
        // ignore
      }
    }

    if (!id) {
      sendJson(res, 400, { error: "缺少组 ID" });
      return;
    }

    const ok = coordinator.deleteGroup(id);
    if (!ok) {
      sendJson(res, 404, { error: "指定的空间音频组不存在" });
      return;
    }

    sendJson(res, 200, { success: true, deleted_id: id });
  };
}

export function spatialTestTone(state: BridgeState, coordinator: SpatialCoordinator): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readJsonBody<{
      groupId?: string;
      role?: SpatialSlotRole;
    }>(req);

    if (!body || !body.groupId) {
      sendJson(res, 400, { error: "缺少 groupId 参数" });
      return;
    }

    const result = await coordinator.playTestTone(state, body.groupId, body.role);
    sendJson(res, 200, result);
  };
}
