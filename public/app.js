(() => {
  "use strict";

  const sessionKey = "lyranest-xiaoai-bridge-access-token";
  const $ = (selector) => document.querySelector(selector);
  const appBasePath = window.location.pathname === "/"
    ? ""
    : window.location.pathname.replace(/\/+$/, "");
  const accessView = $("#accessView");
  const bridgeView = $("#bridgeView");
  const pageError = $("#pageError");
  const toast = $("#toast");
  let setupRequired = false;
  let statusTimer = 0;
  let commandTimer = 0;
  let xiaomiTimer = 0;
  let lastXiaomiLoginState = "";

  function themeIcon(theme) {
    if (theme === "dark") {
      return `<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3.6"></circle>
        <path d="M12 2.7v2.1m0 14.4v2.1m6.58-15.68-1.48 1.48m-10.2 10.2-1.48 1.48m14.38.02-1.48-1.48M6.58 7.1 5.1 5.62M21.3 12h-2.1M4.8 12H2.7"></path>
      </svg>`;
    }
    return `<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M19.4 15.5A8.1 8.1 0 0 1 8.5 4.6a7.9 7.9 0 1 0 10.9 10.9Z"></path>
    </svg>`;
  }

  function applyTheme(theme) {
    const resolved = theme === "light" ? "light" : "dark";
    const dark = resolved === "dark";
    const toggle = $("#themeToggle");
    document.documentElement.dataset.theme = resolved;
    toggle.innerHTML = themeIcon(resolved);
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.setAttribute("aria-label", dark ? "切换到浅色模式" : "切换到深色模式");
    toggle.setAttribute("title", dark ? "浅色模式" : "深色模式");
  }

  function getToken() {
    return sessionStorage.getItem(sessionKey) || "";
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? label : (button.dataset.label || button.textContent);
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${value} 秒`;
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return `${minutes} 分 ${remainder} 秒`;
  }

  function showToast(message, tone = "success") {
    toast.textContent = message;
    toast.className = `toast${tone === "error" ? " is-error" : ""}`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 4200);
  }

  function showError(message) {
    pageError.textContent = message;
    pageError.classList.remove("hidden");
  }

  function clearError() {
    pageError.textContent = "";
    pageError.classList.add("hidden");
  }

  async function readResponseBody(response) {
    const raw = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const likelyJson = contentType.includes("application/json") || /^[\[{]/.test(raw.trim());
    if (!raw.trim()) return { raw, body: null, parseFailed: false };
    if (!likelyJson) return { raw, body: null, parseFailed: false };
    try {
      return { raw, body: JSON.parse(raw), parseFailed: false };
    } catch {
      return { raw, body: null, parseFailed: true };
    }
  }

  function responseError(response, payload) {
    if (payload.body && typeof payload.body.error === "string") return payload.body.error;
    if (payload.parseFailed) return `服务返回了无法解析的数据（HTTP ${response.status}）`;
    const text = payload.raw.replace(/\s+/g, " ").trim();
    if (/^<!doctype html|^<html|^<head|^<body/i.test(text)) {
      return `服务返回了 HTML 验证页面（HTTP ${response.status}），请检查小米登录状态或网络代理`;
    }
    if (text) return `请求失败（HTTP ${response.status}）：${text.slice(0, 180)}`;
    return `请求失败（HTTP ${response.status}）`;
  }

  async function request(path, options = {}, accessToken = "") {
    const headers = new Headers(options.headers || {});
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`${appBasePath}${path}`, { ...options, headers });
    const payload = await readResponseBody(response);
    if (response.ok && payload.parseFailed) {
      throw new Error("服务返回了无法解析的数据，请稍后重试");
    }
    return { response, payload };
  }

  async function publicApi(path, options = {}) {
    const { response, payload } = await request(path, options);
    if (!response.ok) throw new Error(responseError(response, payload));
    return payload.body || {};
  }

  async function api(path, options = {}) {
    const { response, payload } = await request(path, options, getToken());
    const body = payload.body || {};
    if (response.status === 401 && body.error === "unauthorized") {
      sessionStorage.removeItem(sessionKey);
      showAccess();
      throw new Error("访问口令无效或会话已过期");
    }
    if (!response.ok) throw new Error(responseError(response, payload));
    return body;
  }

  function setDot(id, online) {
    const node = $(id);
    node.className = `status-dot ${online ? "is-online" : "is-offline"}`;
  }

  function setFormValues(config, currentStatus, syncScopes) {
    if (syncScopes.includes("enabled")) {
      $("#enabledToggle").checked = Boolean(config.enabled);
    }
    if (syncScopes.includes("lyranest")) {
      $("#lyranestBaseUrl").value = config.lyranest_base_url || "";
      $("#lyranestUsername").value = currentStatus.lyranest_username || config.lyranest_username || "";
      const pwdInput = $("#lyranestPassword");
      if (pwdInput) {
        pwdInput.placeholder = currentStatus.lyranest_authenticated ? "已配置密码（留空保持不变）" : "请输入密码";
      }
    }
    if (syncScopes.includes("playback") || syncScopes.includes("voice_commands")) {
      $("#speakerBaseUrl").value = config.speaker_base_url || "";
      $("#pollInterval").value = String(config.poll_interval_sec || 2);
      $("#searchLimit").value = String(config.search_limit || 10);
      const autoContinue = $("#autoContinueLibrary");
      if (autoContinue) {
        autoContinue.checked = config.auto_continue_library !== false;
      }
      if ($("#speakerProtocol")) {
        $("#speakerProtocol").value = config.playback_protocol || "auto";
      }
      if ($("#speakerTranscode")) {
        $("#speakerTranscode").value = config.transcode || "auto";
      }
      const vc = config.voice_commands || {};
      const el = (id) => $(id);
      if (el("#voiceCmdNext")) el("#voiceCmdNext").value = (vc.next || []).join(", ");
      if (el("#voiceCmdPrevious")) el("#voiceCmdPrevious").value = (vc.previous || []).join(", ");
      if (el("#voiceCmdPause")) el("#voiceCmdPause").value = (vc.pause || []).join(", ");
      if (el("#voiceCmdStop")) el("#voiceCmdStop").value = (vc.stop || []).join(", ");
      if (el("#voiceCmdPlaylist")) el("#voiceCmdPlaylist").value = (vc.playlist || []).join(", ");
      if (el("#voiceCmdLibrary")) el("#voiceCmdLibrary").value = (vc.library || []).join(", ");
      if (el("#voiceCmdFavorite")) el("#voiceCmdFavorite").value = (vc.favorite || []).join(", ");
      if (el("#voiceCmdPlay")) el("#voiceCmdPlay").value = (vc.play || []).join(", ");
      if (el("#voiceCmdAudiobook")) el("#voiceCmdAudiobook").value = (vc.audiobook || []).join(", ");
    }
  }

  function renderStatus(currentStatus) {
    setDot("#xiaomiDot", Boolean(currentStatus.xiaomi_logged_in));
    setDot("#lyranestDot", Boolean(currentStatus.lyranest_connected && currentStatus.lyranest_authenticated));
    const devCount = currentStatus.enabled_device_count || (currentStatus.selected_device_name ? 1 : 0);
    setDot("#deviceDot", devCount > 0);
    $("#xiaomiStatus").textContent = currentStatus.xiaomi_logged_in
      ? "已登录"
      : xiaomiLoginLabel(currentStatus.xiaomi_login_state || "idle");
    $("#lyranestStatus").textContent = currentStatus.lyranest_authenticated
      ? currentStatus.lyranest_connected ? "已连接" : "地址不可达"
      : "未配置凭据";
    const pwdInput = $("#lyranestPassword");
    if (pwdInput && !pwdInput.value) {
      pwdInput.placeholder = currentStatus.lyranest_authenticated ? "已配置密码（留空保持不变）" : "请输入密码";
    }
    if (devCount > 1) {
      $("#deviceStatus").textContent = `${currentStatus.selected_device_name || "主音箱"} (共${devCount}台)`;
    } else {
      $("#deviceStatus").textContent = currentStatus.selected_device_name || "未选择";
    }
    $("#uptimeStatus").textContent = formatDuration(currentStatus.uptime_sec);
    $("#bridgeVersion").textContent = currentStatus.version ? `v${currentStatus.version}` : "v-";
    if (currentStatus.last_error) showError(currentStatus.last_error);
    else clearError();
  }

  function xiaomiLoginLabel(state) {
    return ({
      idle: "未登录",
      pending: "正在登录",
      verification_required: "等待验证",
      authenticated: "已登录",
      failed: "登录失败",
      reauth_required: "需要重新登录",
    })[state] || "未登录";
  }

  function renderXiaomiLogin(login, options = {}) {
    const state = login.state || "idle";
    const syncForm = Boolean(options.syncForm);
    const logout = $("#xiaomiLogout");
    const loginForm = $("#xiaomiLoginForm");
    const verificationForm = $("#xiaomiVerificationForm");
    const username = $("#xiaomiUsername");
    const password = $("#xiaomiPassword");
    const loginButton = $("#xiaomiLoginSubmit");
    const verificationButton = $("#xiaomiVerificationSubmit");
    const verificationCode = $("#xiaomiVerificationCode");
    const verificationLabel = $("#xiaomiVerificationLabel");
    const waiting = state === "pending";
    const verifying = state === "verification_required";

    $("#xiaomiLoginState").textContent = xiaomiLoginLabel(state);
    $("#xiaomiLoginDetail").textContent = login.message || "";
    if (syncForm) {
      loginForm.classList.toggle("hidden", state === "authenticated" || verifying);
      verificationForm.classList.toggle("hidden", !verifying);
      username.disabled = waiting;
      password.disabled = waiting;
      loginButton.disabled = waiting;
      loginButton.textContent = waiting ? "登录中" : "登录";
      verificationButton.disabled = !verifying;
      verificationLabel.textContent = login.verification_method === "email" ? "邮箱验证码" : "短信验证码";
      logout.disabled = state !== "authenticated";
    }
  }

  function updateXiaomiLoginPolling(state) {
    const shouldPoll = state === "pending";
    if (!shouldPoll) {
      window.clearInterval(xiaomiTimer);
      xiaomiTimer = 0;
      return;
    }
    if (xiaomiTimer) return;
    xiaomiTimer = window.setInterval(() => void refreshXiaomiLoginState().catch(() => undefined), 3000);
  }

  function updateQrCountdown() {
    if (!qrExpiresAt) return;
    $("#xiaomiQrCountdown").textContent = formatQrCountdown();
  }

  let cachedDiscoveredDevices = [];
  let cachedSpatialGroups = [];
  let cachedRoleDefs = {};

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderDevices(devices, selectedId) {
    cachedDiscoveredDevices = (devices || []).filter((d) => !d.is_spatial_group);
    const list = $("#deviceList");
    list.replaceChildren();
    if (!devices.length) {
      const empty = document.createElement("p");
      empty.className = "device-empty";
      empty.textContent = "暂无设备";
      list.append(empty);
      return;
    }
    for (const device of devices) {
      const isSelected = device.device_id === selectedId;
      const isEnabled = Boolean(device.enabled);
      const isPlaying = Boolean(device.is_playing);

      const card = document.createElement("article");
      card.className = `device-card${isEnabled ? " is-enabled" : ""}${isSelected ? " is-primary" : ""}`;
      card.dataset.deviceId = device.device_id;

      const header = document.createElement("div");
      header.className = "device-card-header";

      const checkLabel = document.createElement("label");
      checkLabel.className = "device-card-check";
      checkLabel.title = isEnabled ? "点击停用此音箱" : "点击启用此音箱";
      const checkInput = document.createElement("input");
      checkInput.type = "checkbox";
      checkInput.checked = isEnabled;
      checkInput.addEventListener("change", async (e) => {
        e.stopPropagation();
        await toggleDeviceEnabled(device.device_id, checkInput.checked);
      });
      checkLabel.append(checkInput);

      const info = document.createElement("div");
      info.className = "device-card-info";
      const title = document.createElement("strong");
      title.textContent = device.name || "未命名设备";
      const detail = document.createElement("small");
      let detailText = `${device.hardware || "未知型号"} · ${device.device_id}`;
      detailText += ` · 协议: ${device.effective_protocol} · 转码: ${device.effective_transcode}`;
      if (device.has_custom_account && device.lyranest_username) {
        detailText += ` · 专属账号: ${device.lyranest_username}`;
      }
      detail.textContent = detailText;
      info.append(title, detail);

      const actions = document.createElement("div");
      actions.className = "device-card-actions";

      if (isPlaying && device.current_track) {
        const playBadge = document.createElement("span");
        playBadge.className = "device-badge device-badge--playing";
        playBadge.textContent = `▶ ${device.current_track.title || "播放中"}`;
        actions.append(playBadge);
      }

      if (isSelected) {
        const primeBadge = document.createElement("span");
        primeBadge.className = "device-badge device-badge--primary";
        primeBadge.textContent = "默认音箱";
        actions.append(primeBadge);
      } else {
        const primeBtn = document.createElement("button");
        primeBtn.type = "button";
        primeBtn.className = "button button--ghost button--compact";
        primeBtn.textContent = "设为默认";
        primeBtn.title = "设置为主音箱（接收默认推送与指令）";
        primeBtn.addEventListener("click", () => void selectDevice(device.device_id));
        actions.append(primeBtn);
      }

      const accToggleBtn = document.createElement("button");
      accToggleBtn.type = "button";
      accToggleBtn.className = "button button--ghost button--compact";
      accToggleBtn.textContent = (device.has_custom_account || (device.playback_protocol && device.playback_protocol !== "auto") || (device.transcode && device.transcode !== "auto")) ? "音箱配置" : "配置";
      accToggleBtn.title = "为此音箱配置专属播控协议、转码策略与 LyraNest 账号";

      actions.append(accToggleBtn);
      header.append(checkLabel, info, actions);
      card.append(header);

      const details = document.createElement("div");
      details.className = "device-card-details hidden";

      const accForm = document.createElement("form");
      accForm.className = "device-account-form";
      accForm.innerHTML = `
        <div class="form-row">
          <label>
            <span>播控协议通道</span>
            <select class="dev-protocol-select">
              <option value="auto"${(device.playback_protocol || "auto") === "auto" ? " selected" : ""}>自动探测 (生效: ${device.effective_protocol})</option>
              <option value="play_url"${device.playback_protocol === "play_url" ? " selected" : ""}>媒体通道 play_url (标准纯音频音箱)</option>
              <option value="play_music"${device.playback_protocol === "play_music" ? " selected" : ""}>音乐库协议 play_music (触屏/家庭屏)</option>
            </select>
          </label>
          <label>
            <span>音频转码策略</span>
            <select class="dev-transcode-select">
              <option value="auto"${(device.transcode || "auto") === "auto" ? " selected" : ""}>自动适配 (生效: ${device.effective_transcode})</option>
              <option value="mp3"${device.transcode === "mp3" ? " selected" : ""}>强制转码为 MP3 (硬件受限/弱网)</option>
              <option value="never"${device.transcode === "never" ? " selected" : ""}>保持原始流 (不转码)</option>
            </select>
          </label>
        </div>
        <div class="form-row" style="margin-top: 4px;">
          <label>
            <span>专属律巢用户名</span>
            <input class="dev-user-input" placeholder="留空继承全局账号" value="${device.lyranest_username || ""}" />
          </label>
          <label>
            <span>密码</span>
            <input class="dev-pwd-input" type="password" placeholder="${device.has_custom_account ? "留空保持不变" : "请输入密码"}" />
          </label>
          <button class="button button--primary button--compact" type="submit">保存音箱设置</button>
        </div>
      `;

      accForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const userInput = accForm.querySelector(".dev-user-input");
        const pwdInput = accForm.querySelector(".dev-pwd-input");
        const protoInput = accForm.querySelector(".dev-protocol-select");
        const transcodeInput = accForm.querySelector(".dev-transcode-select");
        const username = userInput ? userInput.value.trim() : "";
        const password = pwdInput ? pwdInput.value : "";
        const protocol = protoInput ? protoInput.value : "auto";
        const transcode = transcodeInput ? transcodeInput.value : "auto";
        await saveDeviceAccount(device.device_id, username, password, protocol, transcode);
      });

      accToggleBtn.addEventListener("click", () => {
        details.classList.toggle("hidden");
      });

      details.append(accForm);
      card.append(details);

      list.append(card);
    }
  }

  function renderCommands(items) {
    const list = $("#commandList");
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "device-empty";
      empty.textContent = "暂无语音指令";
      list.append(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = `command-item ${item.success ? "command-success" : "command-failed"}`;
      const title = document.createElement("strong");
      title.textContent = item.query || item.action || "未知指令";
      const info = document.createElement("small");
      const time = item.timestamp ? new Date(item.timestamp).toLocaleString("zh-CN") : "";
      info.textContent = [item.action, item.track_title, item.error, time].filter(Boolean).join(" · ");
      row.append(title, info);
      list.append(row);
    }
  }

  function renderAccessMode() {
    $("#accessEyebrow").textContent = "LYRANEST XIAOAI BRIDGE";
    $("#access-title").textContent = setupRequired ? "设置访问口令" : "访问管理台";
    $("#accessSubmit").textContent = setupRequired ? "创建并进入管理台" : "解锁";
    const accessToken = $("#accessToken");
    accessToken.autocomplete = setupRequired ? "new-password" : "current-password";
    const confirmField = $("#accessConfirmField");
    const confirm = $("#accessTokenConfirm");
    confirmField.classList.toggle("hidden", !setupRequired);
    confirm.disabled = !setupRequired;
    confirm.required = setupRequired;
    for (const input of [accessToken, confirm]) {
      if (setupRequired) {
        input.inputMode = "numeric";
        input.maxLength = 6;
        input.pattern = "\\d{6}";
      } else {
        input.inputMode = "text";
        input.removeAttribute("maxlength");
        input.removeAttribute("pattern");
      }
    }
  }

  async function loadAccessMode() {
    const payload = await publicApi("/api/bootstrap");
    setupRequired = Boolean(payload.setup_required);
    renderAccessMode();
  }

  async function refreshStatus(options = {}) {
    const [currentStatus, config] = await Promise.all([api("/api/status"), api("/api/config")]);
    renderStatus(currentStatus);
    renderXiaomiLogin({
      state: currentStatus.xiaomi_login_state,
      message: currentStatus.xiaomi_login_message,
      verification_method: currentStatus.xiaomi_verification_method,
    }, { syncForm: false });
    const syncScopes = Array.isArray(options.syncScopes) ? options.syncScopes : [];
    if (syncScopes.length) setFormValues(config, currentStatus, syncScopes);
    return { currentStatus, config };
  }

  async function refreshXiaomiLoginState() {
    const login = await api("/api/xiaomi/login/status");
    const previous = lastXiaomiLoginState;
    lastXiaomiLoginState = login.state || "";
    renderXiaomiLogin(login, { syncForm: lastXiaomiLoginState !== previous });
    updateXiaomiLoginPolling(lastXiaomiLoginState);
    if (login.state === "authenticated" && previous !== "authenticated") {
      await Promise.all([refreshStatus(), refreshDevices()]);
      showToast("小米账号登录成功，已刷新音箱设备");
    }
    return login;
  }

  async function refreshDevices() {
    const button = $("#refreshDevices");
    setBusy(button, true, "刷新中");
    try {
      const payload = await api("/api/devices");
      renderDevices(payload.devices || [], payload.selected_device_id || "");
    } finally {
      setBusy(button, false);
    }
  }

  async function refreshCommands() {
    const payload = await api("/api/commands");
    renderCommands(payload.commands || []);
  }

  async function selectDevice(deviceId) {
    try {
      const config = await api("/api/config");
      let enabledIds = Array.isArray(config.enabled_device_ids) ? [...config.enabled_device_ids] : [];
      if (!enabledIds.includes(deviceId)) {
        enabledIds.push(deviceId);
      }
      await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ selected_device_id: deviceId, enabled_device_ids: enabledIds }),
      });
      await refreshDevices();
      await refreshStatus();
      showToast("已设置默认音箱设备");
    } catch (error) {
      showError(error.message);
    }
  }

  async function toggleDeviceEnabled(deviceId, enabled) {
    try {
      const config = await api("/api/config");
      let enabledIds = Array.isArray(config.enabled_device_ids) ? [...config.enabled_device_ids] : [];
      if (enabled) {
        if (!enabledIds.includes(deviceId)) enabledIds.push(deviceId);
      } else {
        enabledIds = enabledIds.filter((id) => id !== deviceId);
      }
      const payload = { enabled_device_ids: enabledIds };
      if (!enabled && config.selected_device_id === deviceId) {
        payload.selected_device_id = enabledIds.length > 0 ? enabledIds[0] : "";
      } else if (enabled && !config.selected_device_id) {
        payload.selected_device_id = deviceId;
      }
      await api("/api/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await refreshDevices();
      await refreshStatus();
      showToast(enabled ? "已启用该音箱" : "已停用该音箱");
    } catch (error) {
      showError(error.message);
    }
  }

  async function saveDeviceAccount(deviceId, username, password, playbackProtocol = "auto", transcode = "auto") {
    try {
      const config = await api("/api/config");
      const deviceBindings = config.device_bindings || {};
      const existing = deviceBindings[deviceId] || {};
      const hasAccount = Boolean(username);
      const pwd = password ? password : (hasAccount ? (existing.lyranest_password || "") : "");

      deviceBindings[deviceId] = {
        device_id: deviceId,
        enabled: hasAccount,
        lyranest_username: username || "",
        lyranest_password: pwd,
        playback_protocol: playbackProtocol || "auto",
        transcode: transcode || "auto",
      };
      await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ device_bindings: deviceBindings }),
      });
      await refreshDevices();
      showToast("已保存该音箱配置");
    } catch (error) {
      showError(error.message);
    }
  }

  async function savePlaybackConfig(event) {
    event.preventDefault();
    const button = $("#speakerSubmit");
    setBusy(button, true, "保存中");
    try {
      const payload = {
        speaker_base_url: $("#speakerBaseUrl").value.trim(),
        poll_interval_sec: Number($("#pollInterval").value),
        search_limit: Number($("#searchLimit").value),
        auto_continue_library: $("#autoContinueLibrary") ? $("#autoContinueLibrary").checked : true,
      };
      if ($("#speakerProtocol")) {
        payload.playback_protocol = $("#speakerProtocol").value;
      }
      if ($("#speakerTranscode")) {
        payload.transcode = $("#speakerTranscode").value;
      }
      await api("/api/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await refreshStatus({ syncScopes: ["playback"] });
      showToast("播放配置已保存");
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  function parseKeywords(value) {
    return (value || "")
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveVoiceCommands(event) {
    event.preventDefault();
    const button = $("#voiceCmdSubmit");
    setBusy(button, true, "保存中");
    try {
      const voice_commands = {
        next: parseKeywords($("#voiceCmdNext").value),
        previous: parseKeywords($("#voiceCmdPrevious").value),
        pause: parseKeywords($("#voiceCmdPause").value),
        stop: parseKeywords($("#voiceCmdStop").value),
        playlist: parseKeywords($("#voiceCmdPlaylist") ? $("#voiceCmdPlaylist").value : ""),
        library: parseKeywords($("#voiceCmdLibrary") ? $("#voiceCmdLibrary").value : ""),
        favorite: parseKeywords($("#voiceCmdFavorite") ? $("#voiceCmdFavorite").value : ""),
        play: parseKeywords($("#voiceCmdPlay").value),
        audiobook: parseKeywords($("#voiceCmdAudiobook").value),
      };
      await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ voice_commands }),
      });
      await refreshStatus({ syncScopes: ["voice_commands"] });
      showToast("自定义口令已保存");
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function saveLyraNest(event) {
    event.preventDefault();
    const button = $("#lyranestSubmit");
    setBusy(button, true, "保存中");
    try {
      const baseUrl = $("#lyranestBaseUrl").value.trim();
      const username = $("#lyranestUsername").value.trim();
      const password = $("#lyranestPassword").value;
      await api("/api/lyranest/login", {
        method: "POST",
        body: JSON.stringify({
          base_url: baseUrl,
          username,
          password,
        }),
      });
      $("#lyranestPassword").value = "";
      await refreshStatus({ syncScopes: ["lyranest"] });
      showToast("LyraNest 凭据已验证并保存");
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function loginXiaomi(event) {
    event.preventDefault();
    const button = $("#xiaomiLoginSubmit");
    setBusy(button, true, "登录中");
    try {
      const login = await api("/api/xiaomi/login/password", {
        method: "POST",
        body: JSON.stringify({
          username: $("#xiaomiUsername").value.trim(),
          password: $("#xiaomiPassword").value,
        }),
      });
      $("#xiaomiPassword").value = "";
      lastXiaomiLoginState = login.state || "pending";
      renderXiaomiLogin(login, { syncForm: true });
      updateXiaomiLoginPolling(lastXiaomiLoginState);
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function submitXiaomiVerification(event) {
    event.preventDefault();
    const button = $("#xiaomiVerificationSubmit");
    setBusy(button, true, "验证中");
    try {
      const login = await api("/api/xiaomi/login/verification", {
        method: "POST",
        body: JSON.stringify({ code: $("#xiaomiVerificationCode").value.trim() }),
      });
      $("#xiaomiVerificationCode").value = "";
      lastXiaomiLoginState = login.state || "pending";
      renderXiaomiLogin(login, { syncForm: true });
      updateXiaomiLoginPolling(lastXiaomiLoginState);
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function logoutXiaomi() {
    const button = $("#xiaomiLogout");
    setBusy(button, true, "退出中");
    try {
      await api("/api/xiaomi/logout", { method: "POST" });
      renderDevices([], "");
      lastXiaomiLoginState = "";
      await Promise.all([refreshStatus(), refreshXiaomiLoginState()]);
      showToast("已退出小米账号");
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function updateEnabled() {
    const enabled = $("#enabledToggle").checked;
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ enabled }) });
      await refreshStatus({ syncScopes: ["enabled"] });
      showToast(enabled ? "Bridge 已启用" : "Bridge 已停用");
    } catch (error) {
      $("#enabledToggle").checked = !enabled;
      showError(error.message);
    }
  }

  async function updateAccessCode(event) {
    event.preventDefault();
    const button = $("#accessCodeSubmit");
    setBusy(button, true, "更新中");
    try {
      const token = $("#newAccessToken").value;
      if (!/^\d{6}$/.test(token)) throw new Error("访问口令必须为 6 位数字");
      if (token !== $("#newAccessTokenConfirm").value) throw new Error("两次输入的访问口令不一致");
      await api("/api/access-token/change", {
        method: "POST",
        body: JSON.stringify({ access_token: token }),
      });
      sessionStorage.setItem(sessionKey, token);
      $("#newAccessToken").value = "";
      $("#newAccessTokenConfirm").value = "";
      showToast("访问口令已更新");
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function playTest(event) {
    event.preventDefault();
    const button = $("#playSubmit");
    setBusy(button, true, "播放中");
    try {
      const result = await api("/api/test-play", {
        method: "POST",
        body: JSON.stringify({ keyword: $("#playKeyword").value.trim() }),
      });
      const box = $("#playResult");
      box.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = `正在播放：${result.track?.title || "已提交播放"}`;
      const detail = document.createElement("small");
      detail.textContent = `设备：${result.device || "已选音箱"}`;
      box.append(title, detail);
      box.classList.remove("hidden");
      showToast("播放指令已发送");
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  function showAccess() {
    window.clearInterval(statusTimer);
    window.clearInterval(commandTimer);
    window.clearInterval(xiaomiTimer);
    bridgeView.classList.add("hidden");
    accessView.classList.remove("hidden");
    void loadAccessMode().catch((error) => showToast(error.message, "error"));
  }

  async function showBridge() {
    accessView.classList.add("hidden");
    bridgeView.classList.remove("hidden");
    clearError();
    try {
      await Promise.all([
        refreshStatus({ syncScopes: ["enabled", "lyranest", "playback"] }),
        refreshCommands(),
      ]);
      await refreshXiaomiLoginState();
      try {
        await refreshDevices();
      } catch {
        renderDevices([], "");
      }
      try {
        await refreshSpatialGroups();
      } catch {
        // ignore
      }
      window.clearInterval(statusTimer);
      window.clearInterval(commandTimer);
      window.clearInterval(xiaomiTimer);
      xiaomiTimer = 0;
      statusTimer = window.setInterval(() => void refreshStatus().catch(() => undefined), 10000);
      commandTimer = window.setInterval(() => void refreshCommands().catch(() => undefined), 12000);
      updateXiaomiLoginPolling(lastXiaomiLoginState);
    } catch (error) {
      showError(error.message);
    }
  }

  $("#accessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#accessSubmit");
    setBusy(button, true, "验证中");
    try {
      const token = $("#accessToken").value;
      if (setupRequired) {
        if (!/^\d{6}$/.test(token)) throw new Error("访问口令必须为 6 位数字");
        if (token !== $("#accessTokenConfirm").value) throw new Error("两次输入的访问口令不一致");
        setBusy(button, true, "创建中");
        await publicApi("/api/access-token/setup", {
          method: "POST",
          body: JSON.stringify({ access_token: token }),
        });
      }
      sessionStorage.setItem(sessionKey, token);
      await api("/api/status");
      $("#accessToken").value = "";
      $("#accessTokenConfirm").value = "";
      await showBridge();
    } catch (error) {
      sessionStorage.removeItem(sessionKey);
      showToast(error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  $("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem("lyranest-xiaoai-bridge-theme", next);
  });
  $("#logoutAccess").addEventListener("click", () => {
    sessionStorage.removeItem(sessionKey);
    showAccess();
  });
  $("#xiaomiLoginForm").addEventListener("submit", (event) => void loginXiaomi(event));
  $("#xiaomiVerificationForm").addEventListener("submit", (event) => void submitXiaomiVerification(event));
  $("#xiaomiLogout").addEventListener("click", () => void logoutXiaomi());
  $("#accessCodeForm").addEventListener("submit", (event) => void updateAccessCode(event));
  $("#refreshDevices").addEventListener("click", () => void refreshDevices().catch((error) => showError(error.message)));
  $("#lyranestForm").addEventListener("submit", (event) => void saveLyraNest(event));
  $("#testLyraNest").addEventListener("click", () => void refreshStatus().then(() => showToast("连接状态已刷新")).catch((error) => showError(error.message)));
  $("#speakerForm").addEventListener("submit", (event) => void savePlaybackConfig(event));
  if ($("#voiceCommandForm")) $("#voiceCommandForm").addEventListener("submit", (event) => void saveVoiceCommands(event));
  async function downloadLogs() {
    const button = $("#exportLogsBtn");
    setBusy(button, true, "正在导出...");
    try {
      const token = getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(`${appBasePath}/api/logs/export?hours=1`, { headers });
      if (!response.ok) {
        throw new Error(`导出日志失败 (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      const cd = response.headers.get("content-disposition");
      let filename = "lyranest-bridge-log.txt";
      if (cd) {
        const match = cd.match(/filename="?([^";]+)"?/);
        if (match) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      showToast("已成功导出最近 1 小时运行诊断日志");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function refreshSpatialGroups() {
    try {
      const payload = await api("/api/spatial/groups");
      cachedSpatialGroups = payload.groups || [];
      cachedRoleDefs = payload.role_definitions || {};
      renderSpatialGroups(cachedSpatialGroups, cachedRoleDefs);
    } catch {
      // ignore
    }
  }

  function renderSpatialGroups(groups, roleDefs) {
    const container = $("#spatialGroupList");
    if (!container) return;
    if (!groups || groups.length === 0) {
      container.innerHTML = `<div class="empty-tip">尚未配置空间音频设备组，点击右上角“+ 创建空间组”开始探索</div>`;
      return;
    }

    container.innerHTML = groups.map((g) => {
      const isWholeHouse = g.mode === "whole_house";
      const modeLabel = isWholeHouse
        ? "🏠 全屋背景音乐"
        : g.mode === "stereo_2_0"
          ? "2.0 立体声"
          : g.mode === "front_center_3_1"
            ? "3.1 前排"
            : "5.1 环绕";
      const slots = g.slots || {};
      const slotEntries = Object.entries(slots).filter(([_, s]) => s && s.deviceId);
      const slotPills = slotEntries.map(([role, s]) => {
        const def = roleDefs[role] || { label: role };
        const labelText = s.zoneName || def.label;
        const delayStr = s.delayMs ? ` (${s.delayMs > 0 ? "+" : ""}${s.delayMs}ms)` : "";
        return `<span class="spatial-slot-pill"><strong>${escapeHtml(labelText)}:</strong> ${escapeHtml(s.deviceName || s.deviceId)}${delayStr}</span>`;
      }).join("");

      return `
        <article class="spatial-group-card" data-id="${g.id}">
          <div class="spatial-group-main">
            <div class="spatial-group-title">
              <span class="spatial-mode-badge ${isWholeHouse ? 'whole-house' : ''}">${modeLabel}</span>
              <strong>${escapeHtml(g.name)}</strong>
              <small class="spatial-count">${slotEntries.length} ${isWholeHouse ? "房间" : "音箱"}协同</small>
            </div>
            <div class="spatial-slots-summary">
              ${slotPills || '<span class="text-muted">未绑定音箱</span>'}
            </div>
          </div>
          <div class="spatial-group-actions">
            <button class="button button--ghost button--compact spatial-action-btn" data-action="test-tone" data-id="${g.id}" type="button" title="依次发声测试">🔊 发声校准</button>
            <button class="button button--secondary button--compact spatial-action-btn" data-action="edit" data-id="${g.id}" type="button">编辑</button>
            <button class="button button--ghost button--compact spatial-action-btn" data-action="delete" data-id="${g.id}" type="button" style="color:var(--red)">删除</button>
          </div>
        </article>
      `;
    }).join("");

    container.querySelectorAll(".spatial-action-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const group = cachedSpatialGroups.find((g) => g.id === id);
        if (action === "test-tone") {
          await triggerSpatialTestTone(id);
        } else if (action === "edit" && group) {
          openSpatialEditor(group);
        } else if (action === "delete" && group) {
          if (confirm(`确定要删除设备组“${group.name}”吗？`)) {
            await deleteSpatialGroup(id);
          }
        }
      });
    });
  }

  function openSpatialEditor(group = null) {
    const editor = $("#spatialEditor");
    if (!editor) return;
    editor.classList.remove("hidden");
    $("#spatialGroupId").value = group ? group.id : "";
    $("#spatialGroupName").value = group ? group.name : "";
    const mode = group ? group.mode : "whole_house";
    $("#spatialGroupMode").value = mode;
    $("#spatialEditorTitle").textContent = group ? `编辑设备组：${group.name}` : "新建设备组";
    updateWholeHouseToolbar(mode);
    renderSpatialSlots(mode, group ? group.slots : {});
    editor.scrollIntoView({ behavior: "smooth" });
  }

  function updateWholeHouseToolbar(mode) {
    const tb = $("#wholeHouseToolbar");
    if (tb) {
      if (mode === "whole_house") tb.classList.remove("hidden");
      else tb.classList.add("hidden");
    }
  }

  function closeSpatialEditor() {
    const editor = $("#spatialEditor");
    if (editor) editor.classList.add("hidden");
  }

  function collectCurrentSlots() {
    const container = $("#spatialSlotsContainer");
    const slots = {};
    if (!container) return slots;
    const rows = container.querySelectorAll(".spatial-slot-row");
    for (const row of rows) {
      const role = row.dataset.role;
      const select = row.querySelector(".spatial-slot-select");
      const delayInput = row.querySelector(".spatial-slot-delay");
      const zoneNameInput = row.querySelector(".spatial-room-label-input");
      const deviceId = select ? select.value : "";
      slots[role] = {
        role,
        deviceId,
        delayMs: Number(delayInput?.value) || 0,
        zoneName: zoneNameInput ? zoneNameInput.value.trim() : undefined,
      };
    }
    return slots;
  }

  function renderSpatialSlots(mode, currentSlots = {}) {
    const container = $("#spatialSlotsContainer");
    if (!container) return;

    let roles = [];
    if (mode === "whole_house") {
      const existingKeys = Object.keys(currentSlots);
      roles = existingKeys.length > 0 ? existingKeys : ["ZONE_1", "ZONE_2"];
    } else if (mode === "front_center_3_1") {
      roles = ["FL", "FR", "FC"];
    } else if (mode === "surround_5_1") {
      roles = ["FL", "FR", "FC", "SL", "SR"];
    } else {
      roles = ["FL", "FR"];
    }

    const onlineDevices = cachedDiscoveredDevices || [];
    const isWholeHouse = mode === "whole_house";

    container.innerHTML = roles.map((role, idx) => {
      const def = cachedRoleDefs[role] || { label: `房间 ${idx + 1}`, description: "全屋背景音乐房间/分区" };
      const slot = currentSlots[role] || { deviceId: "", delayMs: 0, volumeOffsetDb: 0, zoneName: "" };
      const options = [
        `<option value="">-- 未分配音箱 --</option>`,
        ...onlineDevices.map((d) => `<option value="${d.device_id}" ${d.device_id === slot.deviceId ? "selected" : ""}>${escapeHtml(d.name)} (${d.hardware || d.device_id})</option>`),
      ].join("");

      const roomLabelHtml = isWholeHouse
        ? `<input class="spatial-room-label-input" value="${escapeHtml(slot.zoneName || def.label)}" placeholder="房间名(如客厅)" data-role="${role}" />`
        : `<strong>${def.label}</strong>`;

      const removeBtnHtml = isWholeHouse
        ? `<button class="spatial-slot-remove-btn" data-role="${role}" type="button" title="移除此房间">✕ 移除</button>`
        : "";

      return `
        <div class="spatial-slot-row" data-role="${role}">
          <div class="spatial-slot-header spatial-slot-header-flex">
            <div>
              <span class="spatial-slot-tag">${isWholeHouse ? "房间" : role}</span>
              ${roomLabelHtml}
              ${!isWholeHouse ? `<small class="spatial-slot-desc">${def.description}</small>` : ""}
            </div>
            ${removeBtnHtml}
          </div>
          <div class="spatial-slot-fields">
            <label class="spatial-field-item">
              <span>绑定音箱</span>
              <select class="spatial-slot-select" data-role="${role}">${options}</select>
            </label>
            <label class="spatial-field-item slider-item">
              <span>时延补偿: <strong class="delay-val">${slot.delayMs >= 0 ? "+" : ""}${slot.delayMs || 0}ms</strong></span>
              <input class="spatial-slot-delay" type="range" min="-150" max="150" step="5" value="${slot.delayMs || 0}" data-role="${role}" />
            </label>
            <button class="button button--ghost button--compact spatial-test-single-btn" data-role="${role}" type="button" title="单箱发声测试">🔊 测试</button>
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".spatial-slot-delay").forEach((slider) => {
      slider.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        const badge = e.target.closest(".slider-item").querySelector(".delay-val");
        if (badge) badge.textContent = `${val >= 0 ? "+" : ""}${val}ms`;
      });
    });

    container.querySelectorAll(".spatial-slot-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.dataset.role;
        const current = collectCurrentSlots();
        delete current[role];
        renderSpatialSlots("whole_house", current);
      });
    });

    container.querySelectorAll(".spatial-test-single-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const role = btn.dataset.role;
        const row = container.querySelector(`.spatial-slot-row[data-role="${role}"]`);
        const select = row?.querySelector(".spatial-slot-select");
        const deviceId = select?.value;
        if (!deviceId) {
          showToast("请先为该位置选择绑定的音箱", "error");
          return;
        }
        const groupId = $("#spatialGroupId").value;
        if (groupId) {
          await triggerSpatialTestTone(groupId, role);
        } else {
          showToast(`已向 ${role} 下发测试发声`, "success");
        }
      });
    });
  }

  function addRoomSpeaker() {
    const current = collectCurrentSlots();
    const existingCount = Object.keys(current).length;
    const nextRole = `ZONE_${existingCount + 1}`;
    current[nextRole] = { deviceId: "", delayMs: 0, zoneName: `房间 ${existingCount + 1}` };
    renderSpatialSlots("whole_house", current);
  }

  function addAllOnlineSpeakers() {
    const onlineDevices = cachedDiscoveredDevices || [];
    if (!onlineDevices.length) {
      showToast("当前暂无已发现的在线音箱设备", "error");
      return;
    }
    const current = {};
    onlineDevices.forEach((d, idx) => {
      const role = `ZONE_${idx + 1}`;
      current[role] = {
        role,
        deviceId: d.device_id,
        deviceName: d.name,
        delayMs: 0,
        zoneName: d.name,
      };
    });
    renderSpatialSlots("whole_house", current);
    showToast(`已添加 ${onlineDevices.length} 台在线音箱至全屋背景音乐`);
  }

  async function saveSpatialGroup(event) {
    event.preventDefault();
    const btn = $("#saveSpatialBtn");
    setBusy(btn, true, "保存中");
    try {
      const id = $("#spatialGroupId").value || undefined;
      const name = $("#spatialGroupName").value.trim();
      const mode = $("#spatialGroupMode").value;
      const container = $("#spatialSlotsContainer");
      const slots = {};

      const rows = container.querySelectorAll(".spatial-slot-row");
      for (const row of rows) {
        const role = row.dataset.role;
        const select = row.querySelector(".spatial-slot-select");
        const delayInput = row.querySelector(".spatial-slot-delay");
        const zoneNameInput = row.querySelector(".spatial-room-label-input");
        const deviceId = select ? select.value : "";
        if (deviceId) {
          const selectedOption = select.options[select.selectedIndex];
          slots[role] = {
            role,
            deviceId,
            deviceName: selectedOption ? selectedOption.textContent.replace(/\s*\([^)]*\)$/, "") : deviceId,
            delayMs: Number(delayInput?.value) || 0,
            zoneName: zoneNameInput ? zoneNameInput.value.trim() : undefined,
          };
        }
      }

      await api("/api/spatial/groups", {
        method: "POST",
        body: JSON.stringify({ id, name, mode, slots }),
      });

      closeSpatialEditor();
      await refreshSpatialGroups();
      await refreshDevices();
      showToast("设备组已成功保存！");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(btn, false);
    }
  }

  async function deleteSpatialGroup(id) {
    try {
      await api("/api/spatial/groups/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await refreshSpatialGroups();
      await refreshDevices();
      showToast("设备组已删除");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function triggerSpatialTestTone(groupId = "", role = undefined) {
    const id = groupId || $("#spatialGroupId").value;
    if (!id) {
      showToast("请先保存设备组后再执行校准测试", "error");
      return;
    }
    showToast("正在向指定音箱下发校准提示语音...");
    try {
      const res = await api("/api/spatial/test-tone", {
        method: "POST",
        body: JSON.stringify({ groupId: id, role }),
      });
      if (res.message) showToast(res.message);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  if ($("#exportLogsBtn")) $("#exportLogsBtn").addEventListener("click", () => void downloadLogs());
  if ($("#openSpatialModalBtn")) $("#openSpatialModalBtn").addEventListener("click", () => openSpatialEditor(null));
  if ($("#closeSpatialEditorBtn")) $("#closeSpatialEditorBtn").addEventListener("click", () => closeSpatialEditor());
  if ($("#cancelSpatialBtn")) $("#cancelSpatialBtn").addEventListener("click", () => closeSpatialEditor());
  if ($("#spatialGroupMode")) $("#spatialGroupMode").addEventListener("change", (e) => {
    updateWholeHouseToolbar(e.target.value);
    renderSpatialSlots(e.target.value);
  });
  if ($("#addAllOnlineSpeakersBtn")) $("#addAllOnlineSpeakersBtn").addEventListener("click", () => addAllOnlineSpeakers());
  if ($("#addRoomSpeakerBtn")) $("#addRoomSpeakerBtn").addEventListener("click", () => addRoomSpeaker());
  if ($("#spatialForm")) $("#spatialForm").addEventListener("submit", (e) => void saveSpatialGroup(e));
  if ($("#spatialTestToneAllBtn")) $("#spatialTestToneAllBtn").addEventListener("click", () => void triggerSpatialTestTone());

  $("#enabledToggle").addEventListener("change", () => void updateEnabled());
  $("#playForm").addEventListener("submit", (event) => void playTest(event));
  $("#refreshCommands").addEventListener("click", () => void refreshCommands().catch((error) => showError(error.message)));

  const theme = localStorage.getItem("lyranest-xiaoai-bridge-theme");
  applyTheme(theme === "light" || theme === "dark" ? theme : "dark");
  if (getToken()) void showBridge();
  else void loadAccessMode().catch((error) => showToast(error.message, "error"));
})();
