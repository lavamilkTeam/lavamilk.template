# 官网 PostgreSQL 接入

状态：2026-10-27 新增社区 PostgreSQL 18 本地支持。2026-10-28 官网账户已独立迁入 `lavamilk_account`，详见 [统一账户迁移](shared-accounts.md)；聊天、榜单与平台会话仍在原 MySQL，本页描述的整个社区库切换尚未执行。管理站是独立项目。

## 现有访问边界

前端通过同源 `/api/pig-king` 访问 `server/community/index.js`，该入口按数据库 URL 选择私有 SQL 适配器。网站内容 CMS 仍由 PocketBase 提供 `/api/collections/*`，不在本次迁移范围。

| 功能 | HTTP 接口 | PostgreSQL 表 |
| --- | --- | --- |
| GitHub 登录、回调、当前会话、退出 | `GET auth/login`、`GET auth/callback`、`GET auth/session`、`POST auth/logout` | community_users、community_sessions、community_oauth |
| 当前账户资料 | `GET/PATCH me/profile` | account_profiles、community_users |
| 扫描、榜单、公开报告 | `POST account-scan`、`GET account-leaderboard`、`GET account-report/{account}` | community_jobs、community_reports、community_report_history、community_legacy_reports |
| 聊天身份、会话列表及管理 | `GET chat/session`、`GET/POST chat/conversations`、`PATCH/DELETE chat/conversations/{id}` | ai_conversations |
| 聊天历史、发送、重试、取消 | `GET/POST chat/conversations/{id}/turns`、`POST .../{turnId}/retry`、`POST .../{turnId}/cancel` | ai_turns、ai_messages |
| 健康 | `GET health` | 执行真实数据库探测 |

表中路径均以 `/api/pig-king/` 为前缀。共有 11 张业务表，另有 `schema_migrations`。旧 `POST chat` 仍是兼容接口，不持久化对话。现有身份验证、HttpOnly Cookie、Origin 校验及用户数据隔离保持不变；没有新增匿名用户列表或管理员权限。

## 本地运行

需要 Node.js 22.16+ 和已启动的 Docker Desktop。

```sh
npm ci
npm ci --prefix server
npm ci --prefix apps/ai-agent
npm run db:setup
npm run dev:api:pg
```

另一个终端运行 `npm run dev`，访问 `http://localhost:5173`。Vite 的 `/api/pig-king` 已代理到本机 8091。

- PostgreSQL：`127.0.0.1:55432`，数据库 `lavamilk_local`，用户 `lavamilk_dev`。
- 随机密码和数据库 URL 保存在 `.env.postgres.local`，权限 600，Git 忽略。此本地开发角色由镜像初始化，不作为生产权限配置。
- 文件中的 `PUBLIC_ORIGIN=http://localhost:5173` 必须与实际浏览器来源一致。
- `db:setup` 可重复执行，不覆盖已有凭据，不清空数据。Docker 命名卷保存开发数据，PostgreSQL 18 挂载 `/var/lib/postgresql`。
- 开发库初始为空。真实 GitHub 登录需要在该本地文件补入独立测试 OAuth App 的 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 并配置回调；未配置时登录入口会标记不可用。
- CMS 和 AI 模型仍需各自的本地服务/配置。本次数据库验证通过测试注入的 GitHub/模型响应完成，不调用生产账户或模型。

检查 `http://127.0.0.1:8091/api/pig-king/health`，应返回 `status: ok` 与 `database: postgresql`。

停止数据库并保留数据：

```sh
docker compose -f compose.postgres.yml --env-file .env.postgres.local stop
```

再次运行 `npm run db:setup` 即可启动并校验。不要用 `down -v`，它会删除开发数据卷。

## 迁移与数据类型

运行库由 `DATABASE_URL` 决定：`mysql://` 保留旧适配器；`postgresql://` 或 `postgres://` 使用 pg。凭据只在后端，不进入 Vite 公开环境变量。

显式迁移仍通过 `MIGRATION_DATABASE_URL` 调用 `node server/migrate.js`；加 `--check` 只校验版本。开发 setup 会显式调用迁移；普通后端启动从不自动建表。迁移校验不一致时拒绝启动，不自动修改 ledger。

PostgreSQL 使用 JSONB、UUID、BYTEA 和 TIMESTAMPTZ。会话 revision 与 turnNo 以字符串返回；分页保留 UTC 微秒，不通过 JavaScript Date 丢掉微秒。涉及任务状态的 SQL 使用 `clock_timestamp()`，避免长事务固定的 transaction timestamp 改变租约语义。创建会话通过 `ON CONFLICT DO NOTHING` 保证幂等，再检查所属用户；不会在 PostgreSQL 已失败的事务中继续执行查询。

扫描与聊天 worker 保留原有行锁顺序、120 秒租约和晚到回复拒绝逻辑。聊天内容、幂等键、活动轮次及关联记录均由数据库约束保护。MySQL 实现和历史迁移继续保留，用于现有线上服务兼容。

## 验证

```sh
npm run check
npm run test:integration
npm run test:postgres
npm run test:e2e
```

PostgreSQL 测试自动创建并清理独立容器；只接受 `TEST_POSTGRES_URL` 指定的专用测试库（库名必须含 test），不使用开发或生产 `DATABASE_URL`。测试运行同一套 OAuth/扫描/聊天 HTTP 行为，并补充 PostgreSQL 约束、游标和校验场景。MySQL 测试继续单独执行。

## 随后上线的前置事项

本次只建立全新的本地数据库，未复制线上用户和聊天记录，也未实现跨库数据搬迁工具。上线前需要另外完成：

1. 在服务器建立独立 PostgreSQL 库与最小权限应用角色，配置备份、网络和 TLS，先执行显式迁移。
2. 备份并验证恢复现有 MySQL；安排停止写入窗口，为上述 11 张表制作并演练数据迁移，保留 GitHub 数值 ID、哈希、JSON、UTC 微秒及聊天顺序。不能把空库直接当作现有线上库切换。
3. 对比行数、数据校验和、外键及账户归属；处理尚未完成的扫描/聊天租约后再启动服务。
4. 更新部署接收器：当前 `ops/deploy/deploy.py` 仅认可 MySQL 健康值与既有适配器审批结构。生产发布前必须让它校验 PostgreSQL 适配器及迁移哈希、识别 `postgresql` 健康值，并执行发布测试。当前新增迁移会被已有审批门禁拦截，不应绕过。
5. 切换服务端连接配置，验证登录、历史聊天、榜单和写入。PG 开始接受新写入后，回退旧 MySQL 需要先同步新增数据；仅改回 URL 会丢失切换后的业务数据。

技术依据：[node-postgres 事务](https://node-postgres.com/features/transactions)、[类型处理](https://node-postgres.com/features/types)、[PostgreSQL 18 文档](https://www.postgresql.org/docs/18/)。
