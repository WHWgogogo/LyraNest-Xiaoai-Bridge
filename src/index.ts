import { initConfig, loadConfig } from "./config.js";
import { AccessControl } from "./access-control.js";
import { LyraNestClient } from "./lyranest/api-client.js";
import { ConversationPoller } from "./voice/conversation-poller.js";
import { MinaClient } from "./xiaomi/mina-client.js";
import { XiaomiLoginManager } from "./xiaomi/login-manager.js";
import { MiServiceAuthenticator } from "./xiaomi/miservice-client.js";
import { XiaomiSessionStore } from "./xiaomi/session-store.js";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDeploymentRuntime } from "./deployment.js";
import { Router } from "./routes/router.js";
import { accessBootstrap, changeAccessToken, setupAccessToken } from "./routes/access.js";
import { healthz } from "./routes/healthz.js";
import { lyraNestLogin } from "./routes/lyranest-login.js";
import { xiaomiLogout } from "./routes/xiaomi-logout.js";
import { restoreSelectedDevice, syncPoller } from "./runtime.js";
import { status } from "./routes/status.js";
import { devices } from "./routes/devices.js";
import { getConfig, updateConfig } from "./routes/config.js";
import { login } from "./routes/login.js";
import {
  xiaomiLoginPassword,
  xiaomiLoginQr,
  xiaomiLoginSms,
  xiaomiLoginStatus,
  xiaomiLoginVerification,
} from "./routes/xiaomi-login.js";
import { testPlay } from "./routes/test-play.js";
import { commands } from "./routes/commands.js";
import { playerPlay, playerQueue, playerControl, playerStatus, playerVolume } from "./routes/player.js";
import { exportLogs } from "./routes/logs.js";
import { logger } from "./logger.js";
import { LyraNestCredentialStore } from "./lyranest/session-store.js";
import { QueueManager } from "./playback/queue-manager.js";
import { SpatialCoordinator } from "./spatial/coordinator.js";
import {
  spatialGroupsList,
  spatialGroupSave,
  spatialGroupDelete,
  spatialTestTone,
} from "./routes/spatial.js";
import type { XiaomiTokens, XiaomiDevice } from "./types.js";

const VERSION = "1.1.6";

export interface BridgeState {
  version: string;
  startTime: number;
  accessControl: AccessControl;
  config: Awaited<ReturnType<typeof loadConfig>>;
  lyraNest: LyraNestClient;
  lyraNestStore: LyraNestCredentialStore;
  xiaomiLogin: XiaomiLoginManager;
  xiaomiTokens: XiaomiTokens | null;
  selectedDevice: XiaomiDevice | null;
  enabledDevices: XiaomiDevice[];
  allDevices: XiaomiDevice[];
  deviceQueues: Map<string, QueueManager>;
  lyraNestClients: Map<string, LyraNestClient>;
  poller: ConversationPoller;
  queueManager: QueueManager;
  spatialCoordinator?: SpatialCoordinator;
  lastError: string;
  lastVoiceInteractionAt?: number;
}

async function main(): Promise<void> {
  const dataDir = process.env.BRIDGE_DATA_DIR ?? "./data";
  initConfig(`${dataDir}/config.json`);
  const config = await loadConfig();
  const accessControl = await AccessControl.load(
    join(dataDir, "access-token.json"),
    process.env.BRIDGE_ACCESS_TOKEN ?? "",
  );

  const lyraNestStore = new LyraNestCredentialStore(dataDir);
  const savedCreds = await lyraNestStore.load().catch((err) => {
    logger.warn("auth", `读取 LyraNest 本地凭据失败: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });

  const lyraNest = new LyraNestClient(
    config.lyranest_base_url,
    savedCreds?.username || config.lyranest_username,
    savedCreds?.password || "",
    savedCreds?.session_token || null,
  );
  if (savedCreds?.username && savedCreds.username !== config.lyranest_username) {
    config.lyranest_username = savedCreds.username;
  }

  const poller = new ConversationPoller();
  const queueManager = new QueueManager();
  queueManager.setMode(config.play_mode || "loop");
  const deviceQueues = new Map<string, QueueManager>();
  const lyraNestClients = new Map<string, LyraNestClient>();
  const xiaomiLogin = new XiaomiLoginManager({
    authenticator: new MiServiceAuthenticator(),
    store: new XiaomiSessionStore(dataDir),
    probe: async (tokens) => {
      await new MinaClient(tokens).getDevices();
    },
  });

  const spatialCoordinator = new SpatialCoordinator(dataDir);

  const state: BridgeState = {
    version: VERSION,
    startTime: Date.now(),
    accessControl,
    config,
    lyraNest,
    lyraNestStore,
    xiaomiLogin,
    xiaomiTokens: null,
    selectedDevice: null,
    enabledDevices: [],
    allDevices: [],
    deviceQueues,
    lyraNestClients,
    poller,
    queueManager,
    spatialCoordinator,
    lastError: "",
  };

  xiaomiLogin.setHooks({
    onAuthenticated: async (tokens) => {
      state.xiaomiTokens = tokens;
      state.lastError = "";
      logger.info("auth", "小米账号已成功登录并恢复会话");
      await restoreSelectedDevice(state);
      syncPoller(state);
    },
    onReauthRequired: (message) => {
      logger.warn("auth", `小米会话已失效: ${message}`);
      state.xiaomiTokens = null;
      state.selectedDevice = null;
      state.enabledDevices = [];
      state.allDevices = [];
      state.poller.stop();
      state.lastError = message === "Xiaomi account was signed out" ? "" : message;
    },
  });
  await xiaomiLogin.restore();
  if (!state.xiaomiTokens) {
    syncPoller(state);
  }

  const deployment = resolveDeploymentRuntime();
  const router = new Router();
  router.setAccessTokenVerifier((candidate) => state.accessControl.isAuthorized(candidate));
  router.setGatewayPrefix(deployment.gatewayPrefix);
  router.getStatic("/", join(process.cwd(), "public", "index.html"), "text/html; charset=utf-8");
  router.getStatic("/ui/app.css", join(process.cwd(), "public", "app.css"), "text/css; charset=utf-8");
  router.getStatic("/ui/app.js", join(process.cwd(), "public", "app.js"), "text/javascript; charset=utf-8");
  router.getStatic("/ui/logo.png", join(process.cwd(), "public", "lyranest-xiaomi.png"), "image/png");
  router.get("/healthz", healthz(state));
  router.getPublic("/api/bootstrap", accessBootstrap(state));
  router.postPublic("/api/access-token/setup", setupAccessToken(state));
  router.post("/api/access-token/change", changeAccessToken(state));
  router.get("/api/status", status(state));
  router.get("/api/devices", devices(state));
  router.get("/api/config", getConfig(state));
  router.put("/api/config", updateConfig(state));
  router.post("/api/login", login(state));
  router.post("/api/xiaomi/login/password", xiaomiLoginPassword(state));
  router.post("/api/xiaomi/login/sms", xiaomiLoginSms(state));
  router.post("/api/xiaomi/login/qr", xiaomiLoginQr(state));
  router.post("/api/xiaomi/login/verification", xiaomiLoginVerification(state));
  router.get("/api/xiaomi/login/status", xiaomiLoginStatus(state));
  router.post("/api/test-play", testPlay(state));
  router.get("/api/commands", commands(state));
  router.post("/api/lyranest/login", lyraNestLogin(state));
  router.post("/api/xiaomi/logout", xiaomiLogout(state));
  router.post("/api/player/play", playerPlay(state));
  router.post("/api/player/queue", playerQueue(state));
  router.post("/api/player/control", playerControl(state));
  router.get("/api/player/status", playerStatus(state));
  router.get("/api/player/volume", playerVolume(state));
  router.post("/api/player/volume", playerVolume(state));
  router.get("/api/logs/export", exportLogs(state));
  router.get("/api/spatial/groups", spatialGroupsList(spatialCoordinator));
  router.post("/api/spatial/groups", spatialGroupSave(spatialCoordinator));
  router.post("/api/spatial/groups/delete", spatialGroupDelete(spatialCoordinator));
  router.delete("/api/spatial/groups", spatialGroupDelete(spatialCoordinator));
  router.post("/api/spatial/test-tone", spatialTestTone(state, spatialCoordinator));
  router.post("/api/spatial/tone", spatialTestTone(state, spatialCoordinator));

  const port = parseInt(process.env.BRIDGE_PORT ?? "8090", 10);
  router.listen(port, () => {
    logger.info("bridge", `xiaoai-bridge listening on port ${port}`, {
      version: VERSION,
      access_token_setup_required: accessControl.needsSetup(),
    });
  });

  const gatewaySocket = deployment.gatewaySocket;
  if (gatewaySocket) {
    await mkdir(dirname(gatewaySocket), { recursive: true });
    await rm(gatewaySocket, { force: true });
    router.listen(gatewaySocket, () => {
      logger.info("bridge", `xiaoai-bridge gateway socket listening at ${gatewaySocket}`);
    });
  }
}

main().catch((error) => {
  logger.error("bridge", `服务启动致命错误: ${error instanceof Error ? error.message : String(error)}`, {
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
  process.exit(1);
});
