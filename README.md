# 官网（Vue 3 + PocketBase 动态官网）

基于开源模板 [saas-landing-page-template](https://github.com/hannah-wright/saas-landing-page-template)（MIT）改造的动态官网：

- **前台**：Vite + Vue 3 + Tailwind CSS v4（`Lavamilk.vue` 单文件组件，含 11 个页面）
- **后台可编辑**：PocketBase（自带管理后台，内容存 SQLite 数据库）
- **多语言**：vue-i18n + JSON 语言包（`src/locales/`），顶栏可切换 English / 简体中文，选择记忆在 localStorage
- **动效**：Hero 进场动画 + logo 跑马灯（模板自带），叠加滚动进场淡入（`src/plugins/reveal.js`）
- **内容策略**：英文优先读 PocketBase（后台可编辑），其它语言读语言包；CMS 连不上时自动回退语言包，站点永不白屏

## 目录结构

```
src/
  components/Lavamilk.vue        页面组件（全部文案走 i18n）
  components/LanguageSwitcher.vue 语言切换器
  composables/useSiteContent.js  CMS 拉取 + 语言包兜底
  locales/en.json                英文语言包（content 字段同时是 CMS 种子数据）
  locales/zh-CN.json             简体中文语言包
  i18n.js                        vue-i18n 实例 + 语言记忆
  plugins/reveal.js              滚动进场动效
  assets/globals.css             设计令牌 + 动效样式
scripts/pocketbase-setup.mjs     CMS 初始化脚本（建集合 + 灌种子数据）
pocketbase/                      PocketBase 可执行文件与数据
```

## 启动

### 1. 安装依赖

```bash
npm install --cache /tmp/guanwang-npm-cache   # 若默认缓存有权限问题，指定缓存目录
```

### 2. 启动后台 CMS（PocketBase）

```bash
cd pocketbase
./pocketbase serve --http=127.0.0.1:8090
```

- 管理后台：http://127.0.0.1:8090/_/
- 账号：`admin@example.com` / `admin123456`

首次使用需初始化集合与数据：

```bash
npm run pb:setup
```

之后改了 `src/locales/en.json` 里的 `content.*`（品牌、Hero、功能、定价、FAQ、更新日志），用这条命令推到 CMS：

```bash
npm run pb:sync     # 就地更新，不删集合、不改 schema
```

> `pb:setup` 是**删集合重建**（会重置后台里的修改），只在首次初始化时用；
> `pb:sync` 是**增量同步**（按 sort 顺序更新记录，多退少补），日常改文案用这个。

### 3. 启动前台

```bash
npm run dev        # http://localhost:5173
```

> Vite 将 `/api/pig-king` 代理到社区 API（8091），其他 `/api` 代理到 PocketBase（8090）。社区服务启动见下方文档。

## 后台怎么改内容

登录 http://127.0.0.1:8090/_/ 后，左侧可见这些集合：

| 集合 | 对应前台内容 |
|---|---|
| settings | 品牌名、Hero 标题/副标题、页脚介绍 |
| features | 首页/功能页的功能卡片 |
| tiers | 定价套餐 |
| faqs | 常见问题 |
| changelog | 更新日志 |

改完保存即生效（刷新前台页面即可看到）。若 PocketBase 未启动，前台会自动用语言包内容渲染。

## 多语言（English / 简体中文）

顶栏 `Sign in` 左侧有语言切换器，切换后写入 `localStorage`（key: `lavamilk-locale`），刷新保持。

新增语言只需两步：

1. 复制 `src/locales/en.json` 为 `src/locales/<code>.json` 并翻译；
2. 在 `src/i18n.js` 的 `messages` 与 `LOCALES` 里登记该语言。

语言包结构：

| 键 | 用途 |
|---|---|
| `nav` / `action` / `footer` | 导航、按钮、页脚等界面文案 |
| `home` / `page.*` | 各页面标题与正文 |
| `docsGroups` / `posts` / `roles` / `contacts` / `aboutStats` / `dash.*` | 列表数据 |
| `content.*` | 品牌信息与功能/套餐/FAQ/更新日志（= CMS 种子数据） |

> 目前 **CMS 只覆盖英文**：英文走后台可编辑，中文走语言包。如果中文也要后台可编辑，需要给 PocketBase 集合加 `_zh` 字段并在 `useSiteContent` 里按语言取字段。

## 首次下载 PocketBase 二进制

`pocketbase/pocketbase` 已加入 `.gitignore`。若换机器，需重新下载：

```bash
# macOS (Apple Silicon)，版本号以 GitHub Releases 为准
curl -4 -L -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v0.40.4/pocketbase_0.40.4_darwin_arm64.zip"
cd pocketbase && unzip -o /tmp/pb.zip && chmod +x pocketbase
```

## GitHub 个人猪猪榜（v4）

社区入口使用 GitHub 授权登录，只能扫描登录者本人的公开活动。MySQL 独立保存账户、会话、扫描任务、最新报告与历次报告；个人排名长期保留，六小时缓存只控制重复扫描。组织旧报告迁入历史存档，不进入个人榜单。AI 通过现有私有隧道连接本地 Gemma，从建号至今分页扫描可检索公开记录，逐批阅读提交说明与 PR/Issue 正文，生成带证据的尖锐吐槽；仅在有具体优秀证据时表扬。覆盖限制和处理上限见配置文档。

生产部署、OAuth App 创建、环境变量、测试与回滚见 [GitHub 社区配置](docs/github-community.md)。GitHub OAuth App 已配置，真实 Safari 授权与官网登录已验证。此前的 [账户扫描文档](docs/pig-account-scanning.md) 是 v2 实现记录，线上社区路由现已由 Node API 接管，旧匿名扫描入口关闭。

「社区」菜单还保留暂未填写链接的 lavapiggy 社区选项。Google Noto 猪猪 SVG 许可保留在 `public/emoji/`，页面使用高清双语表情图。

运行 `npm run check:all` 验证静态检查、评分、模块边界、构建、真实 MySQL 及浏览器交互。测试环境要求见下文。

## License

模板 MIT 许可（见 `LICENSE`）。

## URL 路由与质量检查（2026-09-27）

页面已支持 `/features`、`/docs`、`/pig-king` 等独立 URL、直接访问、刷新及浏览器前进/后退。生产 Nginx 必须合并 `ops/nginx/lavamilk-spa.conf`，具体见 [部署文档](docs/deployment-lavamilk.md#2026-09-27-url-路由发布要求)。本地 Vite 开发/预览自动提供 history fallback。

使用 Node 22.16+，运行 `npm ci`、`npm ci --prefix server`、`npm ci --prefix apps/ai-agent`、`npx playwright install chromium`，然后执行 `npm run check:all`。完整流程包含 lint、前端/CMS 类型检查、模块边界、单元测试、构建、真实 MySQL 集成和浏览器交互测试；本地集成测试需要 Docker，CI 自动提供测试数据库。详细范围见 [架构与检查](docs/architecture.md)。

`pb:sync` 现在要求显式设置 `PB_ADMIN_EMAIL` 和 `PB_ADMIN_PASSWORD`，不再回退到默认密码。同步前完整读取并验证所有集合，读取失败不写入；写入阶段失败会退出并返回非零状态，可能已完成部分更新，排除故障后可重跑。旧 `pb:setup` 仍是破坏性重建脚本，不用于发布或日常内容更新。


### AI智能体（界面预览）

导航“社区”菜单中的“AI智能体”进入 `/ai-agent`，展示基于 [Nuxt UI Chat](https://github.com/nuxt-ui-templates/chat-vue) 的独立聊天界面。账户和模型接入留待配置；当前发送按钮禁用，不产生模拟回复。模板 MIT 许可见 `apps/ai-agent/LICENSE`。

首次执行 `npm ci --prefix apps/ai-agent`。本地开发分别运行 `npm run dev` 和 `npm run dev:agent`（5174），从官网 5173 访问。`npm run build` 会一并构建官网和聊天应用，将聊天静态资源输出到 `dist/ai-chat/`。生产无需新增后端服务。
