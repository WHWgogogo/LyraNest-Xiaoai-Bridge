# LyraNest XiaoAI Bridge

<p align="center">
  <strong>让小爱音箱播放你的 LyraNest 私人音乐库。</strong>
</p>

<p align="center">
  <a href="https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest"><img src="https://img.shields.io/badge/Release-1.0.8-f95f4d" alt="Release 1.0.8" /></a>
  <a href="https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest"><img src="https://img.shields.io/badge/Platform-fnOS%20%7C%20QNAP%20%7C%20Synology%20%7C%20UGOS%20%7C%20TerraMaster%20%7C%20Docker-4f46e5" alt="Platforms" /></a>
  <a href="https://lyranest.dpdns.org/"><img src="https://img.shields.io/badge/Powered%20by-LyraNest-f95f4d" alt="Powered by LyraNest" /></a>
</p>

<p align="center">
  <a href="https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest">下载最新版</a> ·
  <a href="https://lyranest.dpdns.org/">LyraNest 官网</a> ·
  <a href="https://github.com/WHWgogogo/LyraNest">LyraNest 主项目</a> ·
  <a href="#飞牛-fnos-安装">飞牛安装</a> ·
  <a href="#其他-nas-原生安装">其他 NAS 安装</a> ·
  <a href="#docker-离线部署">Docker 部署</a>
</p>

<p align="center">
  <img src="assets/lyranest-xiaoai-bridge-console.png" alt="LyraNest XiaoAI Bridge 管理台" width="100%" />
</p>

LyraNest（律巢）是一套面向个人 NAS、家庭服务器与局域网音乐库的自托管音乐服务。LyraNest XiaoAI Bridge 是它的音箱扩展：将一台小爱音箱连接到你的 LyraNest 服务后，就可以用语音搜索并播放自己曲库中的音乐。

当前稳定版本：`1.0.8`

## 下载最新版

请前往 [GitHub 最新发行版](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest) 下载对应文件。以下链接始终指向当前稳定发行：

| 文件 | 下载 | 适用场景 |
| --- | --- | --- |
| `LyraNest-XiaoAI-Bridge-1.0.8-fnos-native.fpk` | [下载 FPK](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-fnos-native.fpk) | 飞牛 fnOS 原生应用安装包，x86/ARM 通用 |
| `LyraNest-XiaoAI-Bridge-1.0.8-terramaster-x86_64.deb` / `LyraNest-Xiaomi-Bridge_x86_64.deb` | [下载铁威马 x86_64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-terramaster-x86_64.deb) | 铁威马 TOS 7 Intel / AMD 设备（商店标准命名包：[LyraNest-Xiaomi-Bridge_x86_64.deb](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-Xiaomi-Bridge_x86_64.deb)） |
| `LyraNest-XiaoAI-Bridge-1.0.8-terramaster-aarch64.deb` / `LyraNest-Xiaomi-Bridge_aarch64.deb` | [下载铁威马 ARM64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-terramaster-aarch64.deb) | 铁威马 TOS 7 ARM64 设备（商店标准命名包：[LyraNest-Xiaomi-Bridge_aarch64.deb](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-Xiaomi-Bridge_aarch64.deb)） |
| `LyraNest-XiaoAI-Bridge-1.0.8-qnap.qpkg` | [下载 QNAP 通用包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-qnap.qpkg) | 威联通 QTS / QuTS hero 通用包 |
| `LyraNest-XiaoAI-Bridge-1.0.8-qnap-x86_64.qpkg` | [下载 QNAP x86_64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-qnap-x86_64.qpkg) | 威联通 Intel / AMD 设备 |
| `LyraNest-XiaoAI-Bridge-1.0.8-qnap-arm_64.qpkg` | [下载 QNAP ARM64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-qnap-arm_64.qpkg) | 威联通 ARM64 设备 |
| `LyraNest-XiaoAI-Bridge-1.0.8-synology.spk` | [下载群晖通用包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-synology.spk) | 群晖 DSM 通用 SPK |
| `LyraNest-XiaoAI-Bridge-1.0.8-synology-x86_64.spk` | [下载群晖 x86_64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-synology-x86_64.spk) | 群晖 Intel / AMD 设备 |
| `LyraNest-XiaoAI-Bridge-1.0.8-synology-armv8.spk` | [下载群晖 ARMv8 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-synology-armv8.spk) | 群晖 ARMv8、RTD1296、RTD1619B、Armada37xx |
| `LyraNest-XiaoAI-Bridge-1.0.8-ugnas-amd64.upk` | [下载绿联 AMD64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-ugnas-amd64.upk) | 绿联 UGOS Pro x86_64 设备 |
| `LyraNest-XiaoAI-Bridge-1.0.8-ugnas-arm64.upk` | [下载绿联 ARM64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-ugnas-arm64.upk) | 绿联 UGOS Pro ARM64 设备 |
| `docker-compose.yml` | [下载 Compose 文件](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/docker-compose.yml) | Docker Compose 在线部署配置 |
| `LyraNest-XiaoAI-Bridge-1.0.6-docker-image-linux-amd64.tar` | [下载 Docker 离线镜像 (1.0.6)](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/download/v1.0.6/LyraNest-XiaoAI-Bridge-1.0.6-docker-image-linux-amd64.tar) | Linux AMD64 / x86_64 离线 Docker 部署归档 |

## 1.0.8 更新摘要

- **随机播放与循环模式**：新增随机与循环播放模式（支持语音口令“随机播放”、“循环播放”、“顺序播放”等智能切换）。
- **艺术家连播与复合限定词点歌**：支持“播放周杰伦的歌”、“播放王菲的如愿”等高精度歌手+歌名复合匹配与整位歌手曲目连播。
- **漫游容量与队列调度扩充**：扩充曲库漫游候选池与播放队列调度能力，优化音箱播放完毕自动切下一首的响应效率。
- **铁威马 TOS 7 规范化**：安装包根目录补齐 `config.ini`、`LyraNest-Xiaomi-Bridge.lang` 与 `LyraNest-Xiaomi-Bridge.svg` 元数据，完全符合应用中心审核上架规范。
- **多平台 NAS 制品升级**：全面同步飞牛 fnOS、威联通 QNAP、群晖 Synology DSM、绿联 UGOS Pro 等全架构原生安装包。

## 它能做什么

- 登录小米账号并发现局域网中的小爱音箱。
- 在管理台选择要控制的音箱，完成 LyraNest 服务连接。
- 将“播放某首歌”“下一首”“暂停”“停止”等语音请求转成曲库操作。
- 由音箱直接访问 LyraNest 的音乐流，Bridge 不转发音频数据。
- 提供播放测试、连接状态和最近语音指令记录，方便日常排查。

## 它和 LyraNest 的关系

LyraNest 负责保存音乐、搜索曲库、管理账号并提供播放地址；XiaoAI Bridge 负责把这些能力带给小爱音箱。它是一个独立安装、独立更新的配套应用，不会替代 LyraNest 主服务。

使用前，请先部署可正常访问的 [LyraNest](https://github.com/WHWgogogo/LyraNest)。小爱音箱也必须能通过局域网访问你在 Bridge 中填写的 LyraNest 地址。

## 飞牛 fnOS 安装

飞牛 NAS 用户推荐安装 FPK：

1. 下载 [LyraNest XiaoAI Bridge 1.0.8 FPK](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-fnos-native.fpk)。
2. 在飞牛应用中心选择手动安装，上传 FPK 并完成安装。
3. 在应用设置中选择未被占用的访问端口，默认是 `18090`。
4. 从飞牛桌面打开应用，首次进入创建 6 位数字访问口令。
5. 登录小米账号，选择音箱，填写 LyraNest 服务地址后保存配置。

飞牛桌面入口使用飞牛统一网关；你也可以通过 `http://<飞牛地址>:<端口>` 从局域网访问管理台。

## 其他 NAS 原生安装

### 威联通 QNAP

在 QTS 或 QuTS hero 的 App Center 中启用“允许安装非 QNAP 签名的应用程序”，然后选择本地手动安装：

- Intel / AMD 设备使用 [QNAP x86_64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-qnap-x86_64.qpkg)。
- ARM64 设备使用 [QNAP ARM64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-qnap-arm_64.qpkg)。
- 不确定架构时，可尝试 [QNAP 通用包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-qnap.qpkg)。

安装完成后访问 `http://<QNAP_IP>:18090`。QNAP 设备需要可用的 Node.js 20+ 与 Python 3 运行环境。

### 群晖 DSM

在套件中心选择手动安装并上传对应 SPK：

- Intel / AMD 设备使用 [群晖 x86_64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-synology-x86_64.spk)。
- ARMv8、RTD1296、RTD1619B、Armada37xx 设备使用 [群晖 ARMv8 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-synology-armv8.spk)。
- 不确定架构时，可尝试 [群晖通用包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-synology.spk)。

同名 `.skg` 文件与 `.spk` 内容一致，仅用于需要 SKG 后缀的兼容场景；常规 DSM 手动安装请选择 `.spk`。

### 绿联 UGOS Pro

在绿联私有云应用中心选择本地安装并上传对应 UPK：

- x86_64 设备使用 [绿联 AMD64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-ugnas-amd64.upk)。
- ARM64 设备使用 [绿联 ARM64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-ugnas-arm64.upk)。

安装后从应用中心打开 LyraNest XiaoAI Bridge，或通过应用配置的 `18090` 端口进入管理台。

### 铁威马 TerraMaster (TOS 7)

在 TOS 7 管理系统的“应用中心”中选择手动安装并上传对应 `.deb` 安装包：

- Intel / AMD 设备使用 [铁威马 x86_64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-terramaster-x86_64.deb)（或商店标准命名包 [LyraNest-Xiaomi-Bridge_x86_64.deb](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-Xiaomi-Bridge_x86_64.deb)）。
- ARM64 设备使用 [铁威马 ARM64 包](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.8-terramaster-aarch64.deb)（或商店标准命名包 [LyraNest-Xiaomi-Bridge_aarch64.deb](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-Xiaomi-Bridge_aarch64.deb)）。

安装完成后，从桌面打开应用或访问 `http://<NAS_IP>:18090`，完成首次配置。

## Docker 离线部署

Docker 镜像适用于 Linux AMD64 / x86_64 设备，与飞牛 FPK 是两种独立的安装方式。下载镜像并导入：

```bash
docker load -i LyraNest-XiaoAI-Bridge-1.0.6-docker-image-linux-amd64.tar
```

启动 Bridge：

```bash
docker run -d --name lyranest-xiaoai-bridge \
  --restart unless-stopped \
  -p 18090:8090 \
  -v /vol1/1000/lyranest-xiaoai-bridge/data:/data \
  -e TZ=Asia/Shanghai \
  lyranest-xiaoai-bridge:1.0.6
```

然后在浏览器打开 `http://<NAS_IP>:18090`，完成首次设置即可。Docker 方式不使用飞牛统一网关。

## Docker Compose 部署

下面是完整的 Compose 配置。将它保存为 `docker-compose.yml`，也可以直接下载 [docker-compose.yml](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/docker-compose.yml)。

```yaml
services:
  xiaoai-bridge:
    # 支持从 GitHub 容器镜像库在线拉取，也可使用离线加载的本地镜像 lyranest-xiaoai-bridge:1.0.6
    image: ghcr.io/whwgogogo/lyranest-xiaoai-bridge:1.0.6
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
      - "${BRIDGE_DATA_DIR:-/vol1/1000/lyranest-xiaoai-bridge/data}:/data:rw"
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

下载 Docker 镜像归档并导入：

```bash
mkdir -p lyranest-xiaoai-bridge
cd lyranest-xiaoai-bridge
curl -fLO https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest/download/LyraNest-XiaoAI-Bridge-1.0.6-docker-image-linux-amd64.tar
docker load -i LyraNest-XiaoAI-Bridge-1.0.6-docker-image-linux-amd64.tar
```

启动服务：

```bash
docker compose up -d
```

默认使用 `18090` 端口和 `/vol1/1000/lyranest-xiaoai-bridge/data` 数据目录。需要调整端口、数据目录或时区时，在执行命令前设置环境变量：

```bash
export BRIDGE_HOST_PORT=18091
export BRIDGE_DATA_DIR=/srv/lyranest-xiaoai-bridge/data
export TZ=Asia/Shanghai
docker compose up -d
```

也可以在 Compose 文件所在目录创建 `.env`：

```dotenv
BRIDGE_HOST_PORT=18090
BRIDGE_DATA_DIR=/vol1/1000/lyranest-xiaoai-bridge/data
TZ=Asia/Shanghai
```

首次打开 `http://<NAS_IP>:<BRIDGE_HOST_PORT>` 时创建 6 位数字访问口令。需要无人值守部署时，再在 `.env` 中增加 `BRIDGE_ACCESS_TOKEN`。

## 首次配置

1. 创建管理台的 6 位数字访问口令。
2. 输入小米账号和密码；小米要求时，再输入短信或邮箱验证码。
3. 刷新并选择一台小爱音箱。
4. 填写 Bridge 访问 LyraNest 的服务地址，以及音箱可访问的 LyraNest 地址。
5. 保存配置并启用 Bridge，随后可用“播放测试”验证全链路。

“LyraNest 服务地址”供 Bridge 搜索音乐；“音箱可达的 LyraNest 地址”供音箱直接播放。两者在反向代理、多网卡或跨主机部署时可能不同。

## 使用提示

- 当前支持单账号、单音箱，适合家庭和个人局域网使用。
- 小爱相关连接基于非官方兼容能力；小米账号风控、验证要求或服务调整可能需要重新登录。
- 配置和已加密的小米登录会话保存在数据目录；请不要删除 Docker 数据卷或飞牛应用数据。
- 管理台口令仅适合可信局域网。请勿将端口直接暴露到互联网；远程使用时建议通过防火墙或带认证的反向代理保护。

## 相关链接

- [LyraNest 官网](https://lyranest.dpdns.org/)
- [LyraNest 主项目](https://github.com/WHWgogogo/LyraNest)
- [LyraNest XiaoAI Bridge 最新下载](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/releases/latest)

> 本仓库提供 LyraNest XiaoAI Bridge 的正式安装包和使用说明，不包含完整源代码。
