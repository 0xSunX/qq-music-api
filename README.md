# QQ Music API

基于 Cloudflare Workers + D1 数据库的 QQ 音乐 API 服务。

📖 **文档站**：[isunc.com](https://isunc.com)

## 🚀 部署 (Cloudflare Dashboard)

### 1. Fork 仓库

Fork 此仓库到你的 GitHub 账户。

### 2. 创建 D1 数据库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **D1 SQL Database** > **Create database**
3. 名称填写: `qq-music-api`
4. 复制 **Database ID**，填入 `wrangler.toml`

### 3. 创建 Worker

1. 进入 **Workers & Pages** > **Create**
2. 选择 **Create Worker**
3. 名称填写: `qq-music-api`
4. 点击 **Deploy**

### 4. 连接 Git 仓库

1. 进入刚创建的 Worker > **Settings** > **Build** > **Connect Git repository**
2. 选择你 Fork 的仓库
3. Build command 留空
4. 点击 **Save and Deploy**

### 5. 设置密钥 (Secrets)

进入 **Settings** > **Variables and Secrets** > **Add**，依次添加以下三个 Secret (Type 选 **Secret**)：

| Name | 说明 | 是否必须 |
|------|------|---------|
| `INITIAL_CREDENTIAL` | 首次部署的凭证 JSON 种子，仅库空时写入 | 是 |
| `SETUP_KEY` | 站点初始化部署密钥，`/api/setup` POST 需带请求头 `X-Setup-Key` 匹配；不配则初始化入口禁用 | 是 |
| `DEVICE_SECRET` | 设备标识 HMAC-SHA256 签名密钥；配置后注册/登录的 deviceId 必须为服务端签发的合法签名 | 是 |
| `REQUEST_SECRET` | 请求签名 HMAC-SHA256 密钥，用于防抓包重放/脚本刷；与后台「风控防护」页的签名开关**同时满足**才真正校验请求签名，二缺一自动跳过 | 否 |

每个添加后点击 **Save and Deploy**。

> 凭证可用 [tooplick/qq-music-download](https://github.com/tooplick/qq-music-download) 登录获取
> `SETUP_KEY` / `DEVICE_SECRET` / `REQUEST_SECRET` 建议用长随机串 (如 `openssl rand -hex 32` 生成)。`DEVICE_SECRET` 一旦更换，所有已签发的 deviceId 全部失效，需客户端重新换取。

**关于 `REQUEST_SECRET`（可选，请求签名/防重放）**

1. **配置位置**：与其它 Secret 完全一致——Cloudflare Dashboard → 你的 Worker → **Settings** → **Variables and Secrets** → **Add**，Name 填 `REQUEST_SECRET`，Type 选 **Secret**，Value 填 `openssl rand -hex 32` 生成的随机串，保存后 **Save and Deploy**。
2. **启用条件（双开关，缺一不生效）**：
   - ① 配好 `REQUEST_SECRET` 这个 Secret；
   - ② 登录后台 → 控制台「🛡 风控防护」→ 点「切换请求签名校验」打开开关（对应 `risk_config.req_sign_enabled = 1`）。
   两个条件都满足，服务端才会校验请求头 `X-Req-Sign` / `X-Req-Ts` / `X-Req-Nonce`；只配 Secret 不开开关、或只开开关没配 Secret，签名校验都会被自动跳过，不会误伤线上。
3. **签名算法**：客户端对 `method + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + sha256Hex(body)` （注意：canonical 里的 `path` 需含按参数名排序后的 query 串，如 `/api/song/url?mid=..&quality=..`，query 已纳入签名以防参数被篡改）做 HMAC-SHA256（小写 hex）；时间窗 ±300 秒；nonce 落 `req_nonce` 表防重放，重复即拒。
4. **⚠️ 开启前必读**：一旦开关打开，**所有访问私有业务端点（`/api/song/*`、`/api/lyric`、`/api/album`、`/api/playlist`、`/api/singer`、`/api/credential/refresh`、`/api/user?action=me|logout|appopen`）的客户端都必须带合法签名**，否则返回 403。老客户端若未适配签名逻辑会直接不可用——建议确认客户端已支持、或先灰度，再开这个开关。

### 6. 初始化

访问 `https://你的域名/admin` 初始化数据库。

---

## 📖 API 端点

| 端点 | 说明 |
|------|------|
| `/api/search?keyword=xxx` | 搜索歌曲/歌手/专辑/歌单 (**公开**，无需登录；按 IP 限流 30 次/分钟) |
| `/api/song/url?mid=xxx&quality=flac` | 获取歌曲播放链接 (quality: master/atmos/atmos_51/flac/320/128，默认 flac，自动降级) |
| `/api/song/detail?mid=xxx` | 获取歌曲详情 |
| `/api/song/cover?mid=xxx` | 获取歌曲封面 |
| `/api/lyric?mid=xxx&qrc=1&trans=1` | 获取歌词 (支持参数: qrc(逐字), trans(翻译), roma(罗马音)) |
| `/api/album?mid=xxx` | 获取专辑详情 |
| `/api/playlist?id=xxx` | 获取歌单详情 |
| `/api/singer?mid=xxx` | 获取歌手信息 |
| `/api/top` | 获取排行榜 (公开, 无需登录; 按 IP 限流 30 次/分钟) |
| `/admin` | 数据库初始化 |
| `/api/admin/risk` | 风控防护管理 (**需 admin**；全员风控含匿名，VIP/匿名专属阈值可调) |

### 音质参数说明

| quality 参数 | 音质 | 格式 |
|-------------|------|------|
| `master` | 臻品母带 24Bit 192kHz | .flac |
| `atmos` / `atmos_2` | 臻品全景声 16Bit 44.1kHz | .flac |
| `atmos_51` | 臻品音质 16Bit 44.1kHz | .flac |
| `flac` | FLAC 无损 16Bit~24Bit | .flac |
| `320` | MP3 320kbps | .mp3 |
| `128` | MP3 128kbps | .mp3 |

> 默认 `flac`，当请求音质不可用时自动按上表从上到下降级。
>
> 音质权限：普通用户受服务端 `max_quality`（默认 320）上限约束，超出上限自动按上限音质取值；会员与管理員不受音质限制。调用次数：普通用户每日有限（默认 50，可调），会员固定 1000，管理员不限；用量按北京时间当天计数、次日重置。

---

## ⚠️ 免责声明

本项目仅供学习参考，禁止用于商业用途。

---

## 🛠️ 开发文档

### 项目结构

```
├── src
│   ├── api          # API 路由处理逻辑
│   ├── lib          # 工具库 (加密/解密, 请求封装, 凭证管理)
│   └── index.js     # 入口文件
├── wrangler.toml    # Cloudflare Workers 配置
└── package.json     # 依赖管理 (pako 等)
```

### 本地开发

1. **安装依赖**
   ```bash
   npm install
   ```

2. **本地运行**
   ```bash
   npx wrangler dev
   ```

3. **部署**
   ```bash
   npx wrangler deploy
   ```

### 关键依赖说明

- **pako**:用于处理 QRC/Roma 歌词的 Zlib 解压（替代兼容性较差的 DecompressionStream）。
- **TripleDES**: 位于 `src/lib/tripledes.js`，用于 QQ 音乐加密数据的解密。
