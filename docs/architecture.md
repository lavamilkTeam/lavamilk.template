# 模块边界与验证

## 模块

- `src/features/ai-agent/AiAgent.vue` 是官网 `/ai-agent` 页面入口，通过同源 iframe 展示 `/ai-chat/`。`apps/ai-agent` 独立构建 Nuxt UI Chat 模板，不跨应用导入源码或服务端模块；复制构建结果由 `scripts/copy-ai-agent.mjs` 完成。通过同源 `/api/pig-king/chat/conversations` 调用持久化聊天接口，复用 GitHub HttpOnly 会话；消息保存在 MySQL，浏览器只缓存所选会话 ID。聊天应用通过自己的 `api.js` 访问 HTTP，不接触模型密钥。

- `src/composables/useGitHubSession.js` 为官网顶部和猪猪榜共享的 GitHub 会话入口；独立聊天应用通过同源 HTTP 和只通知状态变化的 BroadcastChannel 同步登录状态，不跨应用导入源码。
- `server/community/lib/model.js` 是社区内部的统一模型适配器，猪猪榜和智能体共用单并发及 90 秒上限；聊天先验证登录、Origin、消息角色和长度，再调用配置中的固定模型地址。

- `src/router.js` 声明页面 URL、历史模式及旧 `/#pig-king` 登录链接兼容。App 通过 RouterView 渲染；页面与菜单使用 Vue Router 公共接口，不反向导入路由配置。
- `src/components` 为页面布局和可复用 UI。`Lavamilk.vue` 暂时保留模板的多页面布局，不在本次修复中整体重写。
- `src/features/pig-king/PigKing.vue` 是社区页面入口；`api.js` 是浏览器 HTTP 边界。
- `server/community/index.js` 是现行社区 HTTP 应用入口。`lib/` 内的 OAuth、MySQL、扫描和 AI 适配器为私有实现；测试从应用入口走真实 HTTP + MySQL，上游 GitHub/AI 通过 transport 注入。
- `scripts/cms-sync/index.mjs` 是内容同步公共入口，注入内容、凭据和 fetch；CLI 负责文件和环境变量。先映射输入并读取所有分页，全部校验通过后才开始内容写入。写入失败立即停止；跨集合写入不是事务，写入阶段失败时可能已部分更新，修复上游后重新运行。
- `pocketbase/pb_hooks/pig-account/{index,server}.cjs` 和 `pig-king/index.cjs` 是保留的旧版公共入口。旧版报告刷新仅在成功完成后替换旧报告和排名；扫描进度与已完成报告可以同时存在。现行 MySQL 后端原本已采用独立任务表和报告表。

模块根文件为公共入口，子目录为私有实现；模块内部可以互相调用。测试通过公开入口验证行为，不导入 lib。禁止依赖环、浏览器和服务端互相导入、生产代码引用测试、跨模块引用私有子目录。`.dependency-cruiser.cjs` 自动执行这些限制并解析 Vue 文件。

PocketBase `.pb.js` 钩子中的动态 `require(__hooks + ...)` 是框架运行时约定，静态工具无法解析，必须人工检查它们只调用模块根入口。PocketBase 迁移及生成的 `pb_data` 类型属于框架产物，不纳入通用 lint。ESLint 保留已有单词组件名 `Lavamilk` 的命名例外。

## 检查

使用 Node 22.16+，先执行 `npm ci` 和 `npm ci --prefix server`、`npm ci --prefix apps/ai-agent`。

- `npm run check`：ESLint（浏览器、服务端、脚本、钩子、测试）、Vue/JS 类型检查、依赖边界、单元测试、生产构建。
- `npm run typecheck`：检查全部前端 JS/Vue 和 CMS 同步模块/CLI。现有后端动态 JS 由 lint、公共接口测试和真实数据库集成测试覆盖；尚未迁移为完整严格类型系统。
- `npm run test:integration`：自动启动一个临时 MySQL 8.4 Docker 容器，随机端口和凭据，执行现行社区 HTTP 测试，结束后删除容器。也可显式指定 `TEST_DATABASE_URL`（库名必须含 test），只能使用专用测试库；不会读取生产 `DATABASE_URL`。
- `npx playwright install chromium`：首次安装浏览器。
- `npm run test:e2e`：先运行 `npm run build`，测试使用 production preview，覆盖直达/刷新/前进后退、移动导航、多语言、404、OAuth 旧链接和失败刷新保留报告。CMS、GitHub 会话及扫描 HTTP 被模拟，不访问真实账户。
- `npm run check:all`：以上完整流程；GitHub Actions 对 push 和 pull request 执行，MySQL 使用独立 CI service，不能用跳过的集成测试冒充通过。

边界规则修改后，应临时从模块外和模块 tests 中导入 lib，确认检查失败，撤销临时文件后再次检查。不能仅用一次正常通过证明规则有效。

## 发布边界

`ops/deploy/package.py` 只打包前端构建结果和 Git 跟踪的后端运行文件；`ops/deploy/deploy.py` 是部署模块的公开入口，独立安装在服务器，不从发布包执行运维脚本。部署模块不被应用源码导入。Python 测试通过其公开入口覆盖坏包、路径穿越、迁移拦截和实际文件回滚；服务命令与 HTTP 检查在测试中替换。`npm run test:deploy` 已加入 `check:all`。部署不执行数据库迁移、CMS 同步或修改服务凭据，配置步骤见 [deployment-cicd.md](deployment-cicd.md)。

## 账户与聊天持久化

[数据库方案](database/account-chat.md) 与 [部署迁移说明](database/account-chat-rollout.md) 说明四张新增表、任务租约、幂等及账户隔离。`server/migrations/index.js` 是迁移模块公共入口，SQL 文件是版本化输入，CLI `server/migrate.js` 负责环境变量；应用启动只校验 ledger 和 checksum，不执行 DDL。迁移不能从 HTTP 触发。

`server/community/lib/chat.js` 负责 HTTP 校验和单 worker，`chat-store.js` 负责参数化 SQL、所有者检查与短事务。模型调用在事务外，120 秒租约包含现有 90 秒请求上限，过期结果不能提交。浏览器轮询生成状态，卸载不取消任务；显式取消和软删除会阻止晚到回复。

真实 MySQL 测试通过应用 HTTP 入口覆盖账户资料白名单、用户隔离、消息幂等、重启恢复、失败重试、取消/删除、过期租约和归档 revision；DDL 测试覆盖 FK/CHECK/UNIQUE。浏览器测试覆盖刷新恢复、登出清屏、失败重试、取消和移动端 Markdown。旧无持久化 POST `/chat` 暂留作已打开旧页面的兼容接口。
