# LyraNest XiaoAI Bridge

LyraNest XiaoAI Bridge 是 [LyraNest](https://lyranest.dpdns.org/) 的独立小爱音箱集成器。它部署在局域网中，将小米小爱音箱连接到 LyraNest 自托管音乐库，让音箱可以依据语音指令搜索并播放自己的曲库。

> 本仓库仅发布可安装制品、校验文件和使用说明，不包含 Bridge 或 LyraNest 的源代码。

![LyraNest XiaoAI Bridge 管理页](assets/lyranest-xiaoai-bridge-console.png)

## 项目与下载

| 入口 | 地址 |
| --- | --- |
| LyraNest 项目主页 | [lyranest.dpdns.org](https://lyranest.dpdns.org/) |
| Bridge 发布仓库 | [WHWgogogo/LyraNest-Xiaomi-Bridge](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge) |
| 当前制品目录 | [releases/1.0.1](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/tree/main/releases/1.0.1) |
| 校验文件 | [SHA256SUMS-1.0.1.txt](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/raw/refs/heads/main/releases/1.0.1/SHA256SUMS-1.0.1.txt) |

LyraNest 主项目负责曲库、账号、音乐检索与流媒体服务；Bridge 只负责小米账号授权、音箱发现、语音指令处理和向音箱下发播放控制。音频由音箱直接访问 LyraNest，不经过 Bridge 中转。

## 版本 1.0.1

发布于 2026 年 9 月 1 日。

| 制品 | 下载 | 用途 |
| --- | --- | --- |
| 飞牛 FPK | [LyraNest-XiaoAI-Bridge-1.0.1-fnos-native.fpk](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/raw/refs/heads/main/releases/1.0.1/LyraNest-XiaoAI-Bridge-1.0.1-fnos-native.fpk) | 飞牛应用中心原生安装包 |
| Docker 镜像 | [LyraNest-XiaoAI-Bridge-1.0.1-docker-image-linux-amd64.tar](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/raw/refs/heads/main/releases/1.0.1/LyraNest-XiaoAI-Bridge-1.0.1-docker-image-linux-amd64.tar) | Linux amd64 离线 Docker 镜像 |
| SHA-256 | [SHA256SUMS-1.0.1.txt](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/raw/refs/heads/main/releases/1.0.1/SHA256SUMS-1.0.1.txt) | FPK 与 Docker 镜像完整性校验 |

### Docker 离线部署

下载镜像后导入：

```bash
docker load -i LyraNest-XiaoAI-Bridge-1.0.1-docker-image-linux-amd64.tar
```

启动独立 Bridge 容器：

```bash
docker run -d --name lyranest-xiaoai-bridge \
  --restart unless-stopped \
  -p 18090:8090 \
  -v /vol1/1000/lyranest-xiaoai-bridge/data:/data \
  -e TZ=Asia/Shanghai \
  lyranest-xiaoai-bridge:1.0.1
```

随后访问 `http://<NAS_IP>:18090`。首次进入创建 6 位数字访问口令，登录小米账号，选择音箱，填写 LyraNest 服务地址并保存即可。

### 飞牛 FPK 安装

1. 在飞牛应用中心选择手动安装，上传 FPK。
2. 在向导中设置未占用端口，默认是 `18090`。
3. 从飞牛桌面打开 Bridge，或通过 `http://<NAS_IP>:<端口>` 访问。
4. 在 Bridge 中完成小米登录、音箱选择和 LyraNest 连接。

`1.0.1` 优化了管理台布局，并在公开健康检查中返回当前版本。飞牛会将旧版本识别为可升级包。

## 使用前提

- 已部署可访问的 LyraNest 服务。
- 小爱音箱与 LyraNest 服务地址在同一可达局域网中。
- 一个可登录小米账号的单账号、单音箱使用场景。

Bridge 支持小米账号密码登录，并在小米要求时接收短信或邮箱验证码。它提供设备发现、固定语音指令、曲库搜索、播放测试和访问口令管理。

## 校验

Linux、macOS：

```bash
sha256sum -c SHA256SUMS-1.0.1.txt
```

Windows PowerShell：

```powershell
Get-FileHash .\LyraNest-XiaoAI-Bridge-1.0.1-fnos-native.fpk -Algorithm SHA256
Get-FileHash .\LyraNest-XiaoAI-Bridge-1.0.1-docker-image-linux-amd64.tar -Algorithm SHA256
```

## 说明

- Docker 与 FPK 是两种独立分发方式。Docker 不使用飞牛统一网关；FPK 会集成飞牛桌面入口。
- Bridge 保存配置和加密的小米会话，但不会在日志中记录明文口令或会话票据。
- 小米相关接口属于非官方兼容实现，可能会随小米服务变化而调整。
- 6 位数字口令适合可信局域网。共享网络建议用防火墙或带认证的反向代理限制访问。

项目主页与产品信息请访问 [LyraNest](https://lyranest.dpdns.org/)。本仓库的最新下载始终位于 [releases](https://github.com/WHWgogogo/LyraNest-Xiaomi-Bridge/tree/main/releases)。
