# LyraNest XiaoAI Bridge（小爱音箱桥接服务）

<p align="center">
  <img src="assets/lyranest-xiaoai-bridge-console.png" alt="LyraNest XiaoAI Bridge" width="600" />
</p>

<p align="center">为 LyraNest 音乐服务提供小米/小爱音箱语音联动、无缝投送与断点续播的官方桥接扩展。</p>

<p align="center">
  <a href="https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest"><img src="https://img.shields.io/github/v/release/WHWgogogo/LyraNest-Xiaoai-Bridge?display_name=tag&label=Release" alt="Latest Release" /></a>
  <a href="https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest"><img src="https://img.shields.io/badge/Platform-fnOS%20%7C%20Synology%20%7C%20QNAP%20%7C%20TerraMaster%20%7C%20UGNAS%20%7C%20CWNAS%20%7C%20Docker-4f46e5" alt="Platforms" /></a>
  <a href="https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest/download/docker-compose.yml"><img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker Compose" /></a>
</p>

<p align="center">
  <a href="https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest">下载最新版</a> ·
  <a href="https://lyranest.cc.cd/">官网</a> ·
  <a href="#docker-compose-部署">Docker 部署</a> ·
  <a href="https://github.com/WHWgogogo/LyraNest">LyraNest 主项目</a>
</p>

> **插件说明**：本插件为 LyraNest 官方音频生态扩展组件，专门负责与小米/小爱音箱（XiaoAI）进行信令交互、语音指令捕获与音频直连播放。使用前请先部署 [LyraNest 主服务](https://github.com/WHWgogogo/LyraNest)。

当前稳定版本：`1.1.6`

交流 QQ 群：`700454910`

---

## 1.1.6 更新日志

- **多音箱会话隔离与多账号绑定**：重构音箱会话管理通道，支持同一局域网下绑定多台不同型号的小爱音箱并实现独立的播放状态管理。
- **有声书语音点播与双向断点续播**：新增有声书书籍与章节语音检索指令，音箱端播放进度实时回传同步至 LyraNest 服务端与全端客户端。
- **虚拟播放时钟（Virtual Clock）**：引入服务端心跳虚拟时钟机制，彻底解决音箱休眠状态回传延迟、丢帧与偶发断流问题。
- **畅网 NAS (CWNAS / AINAS) 原生支持**：正式推出针对畅网私有云的一键安装规范包 `LyraNest-XiaoAI-Bridge-1.1.6-cwnas.cpk`。
- **全 NAS 体系官方包升级**：针对飞牛 fnOS、群晖 DSM、铁威马 TOS 7、威联通 QNAP、绿联 UGnas 发布深度优化的 1.1.6 原生应用包。

---

## 功能简介

- **语音点歌与点播**：通过小爱音箱对唤醒词说出歌曲名、歌手名或有声书名，自动从个人私有 LyraNest 曲库匹配并推送高清音频流。
- **歌单与播控联动**：支持“播放我的收藏”、“播放歌单”、“暂停”、“下一首”等常用语音控制口令。
- **双向进度同步**：音箱播控、切歌、暂停操作实时与 LyraNest 移动端 App、Web 播放器和 TV 端保持双向同步。
- **安全与本地化运行**：支持创建独立 6 位数字管理访问口令，会话 Token 本地加密保存，拒绝云端敏感泄露。
- **轻量与跨架构支持**：原生包内存占用极低，Docker 镜像提供 AMD64 与 ARM64 双架构自适应支持。

---

## 获取安装包与部署文件

请前往 [GitHub 最新发行版](https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest) 下载对应平台的文件：

| 文件 | 适用平台 / 架构 | 说明 |
| :--- | :--- | :--- |
| `LyraNest-XiaoAI-Bridge-1.1.6-fnos-native.fpk` | 飞牛 fnOS (x86/ARM) | 飞牛 NAS 原生安装包（推荐） |
| `LyraNest-XiaoAI-Bridge-1.1.6-cwnas.cpk` | 畅网 NAS (CWNAS / AINAS) | 畅网私有云原生应用安装包 |
| `LyraNest-XiaoAI-Bridge-1.1.6-synology-x86_64.spk` | 群晖 DSM (Intel / AMD) | 群晖 DSM 7.x x86_64 套件 |
| `LyraNest-XiaoAI-Bridge-1.1.6-synology-armv8.spk` | 群晖 DSM (ARM64) | 群晖 DSM 7.x ARM64 套件 |
| `LyraNest-XiaoAI-Bridge-1.1.6-terramaster-x86_64.deb` | 铁威马 TOS 7 (x86_64) | 铁威马应用中心原生安装包 |
| `LyraNest-XiaoAI-Bridge-1.1.6-terramaster-aarch64.deb`| 铁威马 TOS 7 (ARM64) | 铁威马应用中心原生安装包 |
| `LyraNest-XiaoAI-Bridge-1.1.6-qnap-x86_64.qpkg` | 威联通 QNAP (x86_64) | 威联通 App Center 原生套件 |
| `LyraNest-XiaoAI-Bridge-1.1.6-qnap-arm_64.qpkg` | 威联通 QNAP (ARM64) | 威联通 App Center 原生套件 |
| `LyraNest-XiaoAI-Bridge-1.1.6-ugnas-amd64.upk` | 绿联 NAS (UGOS AMD64) | 绿联私有云原生应用包 |
| `LyraNest-XiaoAI-Bridge-1.1.6-ugnas-arm64.upk` | 绿联 NAS (UGOS ARM64) | 绿联私有云原生应用包 |
| `docker-compose.yml` | 通用 Docker 环境 | Docker Compose 一键部署配置 |

---

## 飞牛 fnOS 原生 FPK 安装（推荐）

1. 从 [GitHub 最新发行版](https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest) 下载 `LyraNest-XiaoAI-Bridge-1.1.6-fnos-native.fpk`。
2. 打开飞牛应用中心，选择“手动安装 / 上传应用”，上传 FPK 文件并完成安装。
3. 在飞牛系统应用列表中点击图标打开，或在浏览器中访问 `http://<飞牛局域网IP>:18090`。
4. 首次进入请设置 6 位数字管理访问密码，登录小米账号并完成音箱绑定与服务地址配置。

---

## 畅网 NAS (CWNAS / AINAS) 原生 CPK 安装

畅网 NAS 用户可下载 `LyraNest-XiaoAI-Bridge-1.1.6-cwnas.cpk`。在畅网 NAS 系统应用管理器中点击“手动安装 / 本地安装”，选择下载的 `.cpk` 文件即可一键部署并自动注册后台服务与入口图标。

---

## 其他 NAS 原生安装包

QNAP、Synology DSM、绿联 NAS 与铁威马 TOS 7 用户可从 [GitHub 最新发行版](https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest) 下载对应架构的原生包，在各自系统的应用中心或套件中心选择手动安装：

- **威联通 QNAP**：启用“允许安装非 QNAP 签名的应用程序”，手动上传 `.qpkg`。
- **群晖 DSM**：打开套件中心点击“手动安装”，上传 `.spk` 安装。
- **绿联 NAS**：在应用中心选择“本地安装”，上传对应架构的 `.upk`。
- **铁威马 TOS 7**：在应用中心选择“手动安装”，上传对应架构的 `.deb`。

安装后均可通过 `http://<NAS_IP>:18090` 访问管理台。

---

## Docker 镜像

服务端镜像统一发布至 GitHub Container Registry：

```text
ghcr.io/whwgogogo/lyranest-xiaoai-bridge:1.1.6
```

支持自动多架构自适应（`linux/amd64` 与 `linux/arm64`），默认提供 `1.1.6` 与 `latest` 标签。

---

## Docker Compose 部署

根目录提供了标准的 [`docker-compose.yml`](docker-compose.yml)：

```yaml
services:
  xiaoai-bridge:
    image: ghcr.io/whwgogogo/lyranest-xiaoai-bridge:1.1.6
    container_name: lyranest-xiaoai-bridge
    restart: unless-stopped
    mem_limit: 128m
    environment:
      BRIDGE_PORT: "8090"
      BRIDGE_DATA_DIR: /data
      BRIDGE_ACCESS_TOKEN: "${BRIDGE_ACCESS_TOKEN:-}"
      BRIDGE_RUNTIME: docker
      TZ: "${TZ:-Asia/Shanghai}"
    ports:
      - "${BRIDGE_HOST_PORT:-18090}:8090"
    volumes:
      - "${BRIDGE_DATA_DIR:-./data}:/data:rw"
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:8090/healthz').then((response) =>
          process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3
```

### 部署与启动命令

```bash
mkdir -p lyranest-xiaoai-bridge && cd lyranest-xiaoai-bridge
curl -fLO https://github.com/WHWgogogo/LyraNest-Xiaoai-Bridge/releases/latest/download/docker-compose.yml
mkdir -p data
docker compose pull
docker compose up -d
```

---

## 首次配置与配对

1. **设置管理口令**：首次访问管理后台（默认端口 `18090`）时，根据向导设置 6 位数字管理密码。
2. **登录小米账号**：输入小米账号及密码完成鉴权，如果触发安全风控，根据界面提示输入短信或邮箱验证码。
3. **选择小爱音箱**：账号登录成功后，系统会自动列出账号名下的全部音箱硬件，选择需要联动的音箱设备。
4. **填写 LyraNest 服务地址**：
   - **Bridge 访问地址**：填写桥接服务与 LyraNest 通信的内网地址（如 `http://192.168.1.100:8080`）；
   - **音箱直连地址**：填写小爱音箱拉取音频流的地址（音箱必须能够在局域网内直接访问该地址）。
5. **开启联动与测试**：保存后点击“播放测试”，音箱将播放提示音，随后即可使用语音自由点歌！

---

## 官方生态与项目友链

- [LyraNest 主项目](https://github.com/WHWgogogo/LyraNest)：LyraNest 官方全平台自托管音乐服务。
- [LyraNest AirPlay Bridge](https://github.com/WHWgogogo/LyraNest-AirPlay-Bridge)：AirPlay 2 无线投送桥接插件。
- [LyraNest Local Output](https://github.com/WHWgogogo/LyraNest-Local-Output)：NAS 3.5mm 耳机孔与 USB DAC 声卡直出插件。
- [LyraNest Community](https://github.com/WHWgogogo/LyraNest-Community)：开源社区版。
