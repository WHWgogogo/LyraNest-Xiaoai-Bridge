# LyraNest XiaoAI Bridge REST API 接口文档

本文档提供 LyraNest 小爱桥接器（XiaoAI Bridge）完整的 RESTful API 接口规范，供移动端 App（iOS / Android / Flutter）、Web 端、TV 端及第三方智能家居系统（如 Home Assistant 等）对接使用。

---

## 1. 通用协议与鉴权

### 1.1 服务基础地址 (Base URL)
- **局域网默认地址**：`http://<NAS_IP>:52199` （Docker 部署默认映射端口或飞牛 FPK 端口，如 `8090` / `18090` / `52199`）
- **数据传输格式**：所有请求与响应体均采用 `application/json; charset=utf-8`。

### 1.2 认证与鉴权机制
除 `/healthz`、`/api/bootstrap` 以及首次初始化口令接口无需鉴权外，其余所有 `/api/*` 接口均受访问口令保护。

客户端需在 HTTP 请求头中携带以下任一 Header：
```http
Authorization: Bearer <ACCESS_TOKEN>
```
或
```http
X-Bridge-Token: <ACCESS_TOKEN>
```

#### 鉴权错误响应
- **HTTP 401 Unauthorized**: 未提供口令或口令错误。
  ```json
  {
    "error": "invalid access token"
  }
  ```
- **HTTP 403 Forbidden**: 服务处于未初始化状态或口令受限。

---

## 2. 播放投送与远程播控 API (Player API)

### 2.1 投送单曲播放 (`POST /api/player/play`)
将指定歌曲推送到小爱音箱立即播放，并重置该音箱的播放队列为当前单曲。

- **Path**: `/api/player/play`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  | 字段 | 类型 | 必填 | 说明 |
  | :--- | :--- | :--- | :--- |
  | `device_id` | string | 否 | 目标小爱音箱的唯一 ID。省略时推送到默认主音箱 |
  | `track` | object | 是 | 歌曲对象 |
  | `track.id` | string | 是 | 律巢曲库歌曲 ID |
  | `track.title` | string | 是 | 歌曲名称 |
  | `track.artist` | string | 否 | 歌手名称 |
- **请求示例**:
  ```json
  {
    "device_id": "livingroom_lx06",
    "track": {
      "id": "trk_01h9xyz",
      "title": "晴天",
      "artist": "周杰伦"
    }
  }
  ```
- **成功响应 (HTTP 200)**:
  ```json
  {
    "success": true,
    "current_track": {
      "id": "trk_01h9xyz",
      "title": "晴天",
      "artist": "周杰伦"
    },
    "device_id": "livingroom_lx06",
    "device": "客厅小爱音箱"
  }
  ```
- **错误响应**:
  - `400`: 缺少有效的 `track.id` 或 `track.title`。
  - `404`: 指定的 `device_id` 不存在或未启用。
  - `409`: 小米账号未登录。
  - `502`: 音箱下发指令失败（音箱离线或拒绝连接）。

---

### 2.2 投送播放队列 / 歌单 (`POST /api/player/queue`)
将一批歌曲或整个歌单推送到指定小爱音箱构建播放队列，并从指定位置开始播放。

- **Path**: `/api/player/queue`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  | 字段 | 类型 | 必填 | 说明 |
  | :--- | :--- | :--- | :--- |
  | `device_id` | string | 否 | 目标音箱 ID。省略时推送到主音箱 |
  | `queue_name` | string | 否 | 队列来源名称（默认：“外部推送队列”） |
  | `start_index` | integer | 否 | 起始播放索引，从 0 开始，默认 0 |
  | `tracks` | object[] | 三选一 | 完整歌曲对象数组，每项包含 `{ id, title, artist }` |
  | `track_ids` | string[] | 三选一 | 歌曲 ID 列表 |
  | `playlist_id`| string | 三选一 | 律巢歌单 ID（使用该音箱绑定的账号读取） |
- **请求示例 (批量投送歌曲)**:
  ```json
  {
    "device_id": "bedroom_l05c",
    "start_index": 0,
    "queue_name": "手机收藏投送",
    "tracks": [
      { "id": "t1", "title": "晴天", "artist": "周杰伦" },
      { "id": "t2", "title": "七里香", "artist": "周杰伦" }
    ]
  }
  ```
- **成功响应 (HTTP 200)**:
  ```json
  {
    "success": true,
    "queue_name": "手机收藏投送",
    "count": 2,
    "start_index": 0,
    "current_track": {
      "id": "t1",
      "title": "晴天",
      "artist": "周杰伦"
    },
    "device_id": "bedroom_l05c",
    "device": "卧室小爱音箱"
  }
  ```

---

### 2.3 播控指令操作 (`POST /api/player/control`)
向指定音箱下发切歌、暂停、继续、切换播放模式等操作。

- **Path**: `/api/player/control`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  | 字段 | 类型 | 必填 | 说明 |
  | :--- | :--- | :--- | :--- |
  | `device_id` | string | 否 | 目标音箱 ID。省略时操作默认主音箱（支持普通音箱与空间/全屋虚拟设备） |
  | `action` | string | 是 | 动作类型，见下表 |
  | `mode` | string | 条件必填 | 当 `action="mode"` 时必填：`sequence` \| `loop` \| `shuffle` \| `single_loop` |
  | `volume` | number | 条件必填 | 当 `action="volume"` 时指定绝对音量（0 ~ 100 整数） |
  | `delta` | number | 条件可选 | 当 `action="volume"` 且未提供 `volume` 时指定相对步进增减（如 `+5` 或 `-5`） |

#### `action` 支持列表：
| `action` 取值 | 功能描述 |
| :--- | :--- |
| `play` | 继续播放（若当前队列处于暂停状态，恢复播放当前歌曲） |
| `pause` | 暂停播放 |
| `stop` | 停止播放 |
| `next` | 切换到下一首（自动推进队列并在末尾从曲库自动漫游补歌） |
| `previous` | 切换到上一首 |
| `shuffle` | 快捷将当前队列随机打乱并切换为随机模式 |
| `mode` | 切换播放模式（需配合 `mode` 字段） |
| `volume` | 调节音箱音量（需配合 `volume` 或 `delta` 字段，支持普通音箱及全屋/多声道设备） |

- **音量调节请求示例**:
  ```json
  {
    "device_id": "bedroom_l05c",
    "action": "volume",
    "volume": 35
  }
  ```
- **音量调节成功响应 (HTTP 200)**:
  ```json
  {
    "success": true,
    "action": "volume",
    "volume": 35,
    "device_id": "bedroom_l05c"
  }
  ```

---

### 2.4 音量快捷读写接口 (`GET` / `POST /api/player/volume`)

#### 1. 查询音箱当前音量 (`GET /api/player/volume`)
- **Path**: `/api/player/volume`
- **Method**: `GET`
- **Query 参数**: `device_id`（可选，缺省为主音箱）
- **响应示例 (HTTP 200)**:
  ```json
  {
    "success": true,
    "device_id": "bedroom_l05c",
    "device": "主卧小爱音箱",
    "volume": 35
  }
  ```

#### 2. 设置音箱音量 (`POST /api/player/volume`)
- **Path**: `/api/player/volume`
- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "device_id": "bedroom_l05c",
    "volume": 45
  }
  ```
- **响应示例 (HTTP 200)**:
  ```json
  {
    "success": true,
    "device_id": "bedroom_l05c",
    "device": "主卧小爱音箱",
    "volume": 45
  }
  ```

---

### 2.4 查询音箱播放状态 (`GET /api/player/status`)
获取指定音箱或全局所有启用音箱的实时播放状态、队列大小与当前曲目。

- **Path**: `/api/player/status`
- **Method**: `GET`
- **Query 参数**:
  - `device_id` (可选): 指定查询特定音箱的播放状态。

#### 场景 1：查询指定音箱 (`?device_id=xxx`)
- **响应示例 (HTTP 200)**:
  ```json
  {
    "active": true,
    "play_mode": "loop",
    "current_track": {
      "id": "t1",
      "title": "晴天",
      "artist": "周杰伦"
    },
    "current_index": 0,
    "queue_size": 2,
    "queue_source": "手机收藏投送",
    "has_more": true,
    "device": {
      "device_id": "bedroom_l05c",
      "name": "卧室小爱音箱",
      "hardware": "L05C"
    },
    "lyranest_username": "kid_bedroom"
  }
  ```

#### 场景 2：全局查询 (不带参数)
- **响应示例 (HTTP 200)**:
  返回主音箱状态，并在 `devices` 数组中返回所有已启用音箱的聚合状态：
  ```json
  {
    "active": true,
    "play_mode": "loop",
    "current_track": { "id": "t1", "title": "晴天" },
    "current_index": 0,
    "queue_size": 1,
    "queue_source": "外部推送队列",
    "has_more": false,
    "selected_device": {
      "device_id": "livingroom_lx06",
      "name": "客厅小爱音箱",
      "hardware": "LX06"
    },
    "devices": [
      {
        "device_id": "livingroom_lx06",
        "name": "客厅小爱音箱",
        "hardware": "LX06",
        "active": true,
        "play_mode": "loop",
        "current_track": { "id": "t1", "title": "晴天" },
        "current_index": 0,
        "queue_size": 1,
        "queue_source": "外部推送队列",
        "has_more": false,
        "lyranest_username": "admin"
      },
      {
        "device_id": "bedroom_l05c",
        "name": "卧室小爱音箱",
        "hardware": "L05C",
        "active": false,
        "play_mode": "shuffle",
        "current_track": null,
        "current_index": 0,
        "queue_size": 0,
        "queue_source": "",
        "has_more": false,
        "lyranest_username": "kid_bedroom"
      }
    ]
  }
  ```

---

## 3. 设备发现与管理 API

### 3.1 获取音箱设备列表 (`GET /api/devices`)
读取当前小米账号下绑定的全部小爱硬件设备，并包含各音箱的启用状态、专属账号及当前播放指示。客户端设备选择弹窗应优先调用此接口。

- **Path**: `/api/devices`
- **Method**: `GET`
- **成功响应 (HTTP 200)**:
  ```json
  [
    {
      "device_id": "livingroom_lx06",
      "name": "客厅小爱音箱",
      "hardware": "LX06",
      "miot_did": "12345678",
      "enabled": true,
      "is_selected": true,
      "lyranest_username": "admin",
      "has_custom_account": false,
      "is_playing": true,
      "current_track": {
        "id": "t1",
        "title": "晴天",
        "artist": "周杰伦"
      },
      "play_mode": "loop"
    },
    {
      "device_id": "bedroom_l05c",
      "name": "卧室小爱音箱",
      "hardware": "L05C",
      "miot_did": "87654321",
      "enabled": true,
      "is_selected": false,
      "lyranest_username": "kid_bedroom",
      "has_custom_account": true,
      "is_playing": false,
      "current_track": null,
      "play_mode": "shuffle"
    }
  ]
  ```

---

## 4. 全链路播放测试 API

### 4.1 测试向音箱发送播放指令 (`POST /api/test-play`)
验证指定音箱能否正常从 LyraNest 获取音频流并成功播放。

- **Path**: `/api/test-play`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "device_id": "livingroom_lx06",
    "keyword": "七里香"
  }
  ```
  *(注：`device_id` 可选；`keyword` 可选，缺省时自动播放曲库第一首歌)*
- **成功响应 (HTTP 200)**:
  ```json
  {
    "playing": true,
    "track": "七里香",
    "artist": "周杰伦",
    "stream_url": "http://192.168.1.100:8080/api/v1/tracks/t2/stream?access_token=...",
    "device_id": "livingroom_lx06",
    "device": "客厅小爱音箱"
  }
  ```

---

## 5. 配置管理 API

### 5.1 获取配置 (`GET /api/config`)
- **Path**: `/api/config`
- **Method**: `GET`
- **成功响应 (HTTP 200)**:
  ```json
  {
    "version": 1,
    "enabled": true,
    "lyranest_base_url": "http://192.168.1.100:8080",
    "lyranest_username": "admin",
    "speaker_base_url": "http://192.168.1.100:8080",
    "poll_interval_sec": 2,
    "selected_device_id": "livingroom_lx06",
    "enabled_device_ids": ["livingroom_lx06", "bedroom_l05c"],
    "device_bindings": {
      "bedroom_l05c": {
        "device_id": "bedroom_l05c",
        "enabled": true,
        "lyranest_username": "kid_bedroom",
        "has_password": true
      }
    },
    "voice_commands": {},
    "search_limit": 10,
    "auto_continue_library": true,
    "play_mode": "loop"
  }
  ```
  *(注：所有密码字段均已被脱敏返回 `has_password: true`)*

### 5.2 更新配置 (`PUT /api/config`)
- **Path**: `/api/config`
- **Method**: `PUT`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  支持部分更新。示例如下：
  ```json
  {
    "enabled": true,
    "poll_interval_sec": 2,
    "selected_device_id": "livingroom_lx06",
    "enabled_device_ids": ["livingroom_lx06", "bedroom_l05c"],
    "device_bindings": {
      "bedroom_l05c": {
        "device_id": "bedroom_l05c",
        "enabled": true,
        "lyranest_username": "kid_bedroom",
        "lyranest_password": "NewSecretPassword123"
      }
    }
  }
  ```
- **成功响应 (HTTP 200)**: 返回更新后的完整配置对象。

---

## 6. 系统监控与语音日志 API

### 6.1 服务健康检查 (`GET /healthz`)
- **说明**: 公开接口，无需鉴权。
- **Path**: `/healthz`
- **Method**: `GET`
- **成功响应 (HTTP 200)**:
  ```json
  {
    "status": "ok",
    "version": "1.2.0"
  }
  ```

### 6.2 综合运行状态 (`GET /api/status`)
- **Path**: `/api/status`
- **Method**: `GET`
- **成功响应 (HTTP 200)**:
  ```json
  {
    "version": "1.2.0",
    "enabled": true,
    "xiaomi_login_state": "authenticated",
    "xiaomi_user_id": "123456789",
    "selected_device": {
      "device_id": "livingroom_lx06",
      "name": "客厅小爱音箱",
      "hardware": "LX06"
    },
    "enabled_device_count": 2,
    "enabled_device_ids": ["livingroom_lx06", "bedroom_l05c"],
    "lyranest_connected": true,
    "lyranest_username": "admin",
    "poller_running": true,
    "last_error": null
  }
  ```

### 6.3 最近语音识别记录 (`GET /api/commands`)
获取小爱音箱最近识别到的 20 条语音对话及桥接器的响应动作记录。

- **Path**: `/api/commands`
- **Method**: `GET`
- **成功响应 (HTTP 200)**:
  ```json
  [
    {
      "timestamp": 1726200000000,
      "query": "播放晴天",
      "action": "play",
      "keyword": "晴天",
      "track_title": "晴天",
      "success": true,
      "device_id": "livingroom_lx06",
      "device_name": "客厅小爱音箱"
    }
  ]
  ```

---

## 7. 小米账号会话管理 API

### 7.1 提交小米账号密码登录 (`POST /api/xiaomi/login/password`)
- **Path**: `/api/xiaomi/login/password`
- **Method**: `POST`
- **Request Body**: `{"username": "<xiaomi_account>", "password": "<xiaomi_password>"}`
- **响应 (HTTP 200)**: `{"status": "pending" | "authenticated" | "verification_required"}`

### 7.2 查询小米登录状态 (`GET /api/xiaomi/login/status`)
- **Path**: `/api/xiaomi/login/status`
- **Method**: `GET`
- **响应 (HTTP 200)**:
  ```json
  {
    "state": "authenticated",
    "message": "已登录",
    "notification_url": null
  }
  ```

### 7.3 提交二次验证码 (`POST /api/xiaomi/login/verification`)
当状态为 `verification_required` 时提交短信或邮箱验证码。
- **Path**: `/api/xiaomi/login/verification`
- **Method**: `POST`
- **Request Body**: `{"code": "123456"}`

### 7.4 退出小米登录 (`POST /api/xiaomi/logout`)
清除本地加密保存的小米 Token 并停止轮询。
- **Path**: `/api/xiaomi/logout`
- **Method**: `POST`
- **响应 (HTTP 200)**: `{"success": true}`

---

## 8. 诊断日志导出 API

### 8.1 导出最近诊断运行日志 (`GET /api/logs/export`)
- **说明**: 从内存滚动缓冲区（RingBuffer）中导出纯文本诊断日志，开箱支持 Docker 及各种 NAS 原生环境，包含运行环境、拓扑模式及流水日志。支持通过 Header 或 URL Query 鉴权（便于浏览器直接下载）。
- **Path**: `/api/logs/export`
- **Method**: `GET`
- **Query 参数**:
  - `hours`: 导出时间跨度（小时），默认为 `1`，最大支持 `24`
  - `token`: 鉴权 Access Token（可选，支持浏览器直接跳转下载）
- **响应 (HTTP 200)**:
  - `Content-Type`: `text/plain; charset=utf-8`
  - `Content-Disposition`: `attachment; filename="lyranest-bridge-logs-<timestamp>.log"`

---

## 9. 音乐实验室 · 多音箱空间音频 API (实验性)

### 9.1 获取空间音频组列表 (`GET /api/spatial/groups`)
- **Path**: `/api/spatial/groups`
- **Method**: `GET`
- **成功响应 (HTTP 200)**:
  ```json
  {
    "groups": [
      {
        "id": "sp_mu6adggp_auh0",
        "name": "客厅立体声",
        "mode": "stereo_2_0",
        "enabled": true,
        "slots": {
          "FL": { "role": "FL", "deviceId": "dev1", "deviceName": "客厅左", "delayMs": 0, "volumeOffsetDb": 0 },
          "FR": { "role": "FR", "deviceId": "dev2", "deviceName": "客厅右", "delayMs": 10, "volumeOffsetDb": 0 }
        },
        "masterRole": "FL",
        "updatedAt": "2026-09-18T01:35:00.000Z"
      }
    ],
    "role_definitions": { ... },
    "modes": [
      { "id": "stereo_2_0", "label": "2.0 立体声对", "roles": ["FL", "FR"], "minSpeakers": 2 },
      { "id": "front_center_3_1", "label": "3.1 前排影院 (含中置人声)", "roles": ["FL", "FR", "FC"], "minSpeakers": 3 },
      { "id": "surround_5_1", "label": "5.1 环绕声系统", "roles": ["FL", "FR", "FC", "SL", "SR"], "minSpeakers": 5 }
    ]
  }
  ```

### 9.2 保存或更新空间音频组 (`POST /api/spatial/groups`)
- **Path**: `/api/spatial/groups`
- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "id": "sp_xxx",
    "name": "客厅立体声",
    "mode": "stereo_2_0",
    "enabled": true,
    "slots": {
      "FL": { "role": "FL", "deviceId": "dev1", "deviceName": "左音箱", "delayMs": 0, "volumeOffsetDb": 0 },
      "FR": { "role": "FR", "deviceId": "dev2", "deviceName": "右音箱", "delayMs": 15, "volumeOffsetDb": 0 }
    }
  }
  ```
- **成功响应 (HTTP 200)**: `{"group": { ... }}`

### 9.3 删除空间音频组 (`POST /api/spatial/groups/delete`)
- **Path**: `/api/spatial/groups/delete`
- **Method**: `POST`
- **Request Body**: `{"id": "sp_xxx"}`
- **成功响应 (HTTP 200)**: `{"success": true, "deleted_id": "sp_xxx"}`

### 9.4 声道校准发声测试 (`POST /api/spatial/tone`)
- **说明**: 通过小米原生 TTS 声学通道在指定声道或全组音箱上按序发声（如“左前声道测试音”），帮助用户校准音箱摆位与延时。
- **Path**: `/api/spatial/tone`
- **Method**: `POST`
- **Request Body**: `{"groupId": "sp_xxx", "role": "FL"}` (省略 role 则依次测试全组声道)
- **成功响应 (HTTP 200)**:
  ```json
  {
    "success": true,
    "message": "已向 2/2 台音箱下发声道校准测试提示",
    "details": [
      { "role": "FL", "deviceName": "左音箱", "ok": true },
      { "role": "FR", "deviceName": "右音箱", "ok": true }
    ]
  }
  ```
