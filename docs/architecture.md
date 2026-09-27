# 模块边界与验证

## 模块

- `src/features/ai-agent/AiAgent.vue` 是官网 `/ai-agent` 页面入口，通过同源 iframe 展示 `/ai-chat/`。`apps/ai-agent` 独立构建 Nuxt UI Chat 模板，不跨应用导入源码或服务端模块；复制构建结果由 `scripts/copy-ai-agent.mjs` 完成。账户和模型接入待后续配置，目前不发送消息、不存储会话或 API Key。

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
