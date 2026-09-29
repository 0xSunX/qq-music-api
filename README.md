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

### 5. 设置凭证

1. 进入 **Settings** > **Variables and Secrets** > **Add**
2. Type: **Secret**
3. Name: `INITIAL_CREDENTIAL`
4. Value: 粘贴你的凭证 JSON
5. 点击 **Save and Deploy**

> 凭证可用 [tooplick/qq-music-download](https://github.com/tooplick/qq-music-download) 登录获取

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
| `/api/top` | 获取排行榜 |
| `/admin` | 数据库初始化 |

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
