# GitHub 账户猪猪榜

账户版为 v2，使用独立的 `pig_accounts` 集合。原 `pig_scores` 和旧仓库扫描 API 保留，两个榜单不混排。前端入口仍是「社区 → 猪猪榜」。

## 数据范围

- 输入 GitHub 用户名、组织名或主页 URL；不接受任意外部 URL。
- 分页遍历拥有的全部公开仓库元数据（含 Fork、归档仓库），不抓取源码或 README 全文。超过 10,000 个仓库会明确失败，不会宣称已完整扫描。
- 活动窗口固定为开始扫描时向前 90 天。个人账户读取本人发表的公开提交、PR、Issues；组织账户读取组织公开仓库内的活动。
- 三类活动各读取最近 100 条，保留 GitHub 搜索总数和 `incomplete_results` 标记。提交搜索覆盖默认分支，合并、机器人和重复 SHA 不参与评分。不会把样本误称为完整历史。
- 固定评分沿用凌晨、修复、谜语、撤回四项娱乐规则。PR、Issues 和仓库资料供报告与 AI 使用，不改变既有四项权重。
- 至少 20 条有效提交参榜；账户报告缓存 6 小时，榜单只展示最近 7 天扫描的账户 Top 50。

GitHub 限制参考：[Search API](https://docs.github.com/en/rest/search/search)、[commit 搜索范围](https://docs.github.com/en/search-github/searching-on-github/searching-commits)。

## AI 配置

在 **PocketBase 服务端环境**中提供：

- `PIG_AI_URL`：兼容 Chat Completions 协议的完整 HTTPS 地址（包含 `/chat/completions` 路径）。
- `PIG_AI_MODEL`：该服务商支持的模型 ID。
- `PIG_AI_KEY`：服务端 API key。仅管理员配置的本机回环 HTTP 地址允许无 key；远端地址必须使用 HTTPS 和 key。
- `PIG_AI_PROVIDER=llamacpp`：本地 llama.cpp 专用，关闭思考并启用 JSON 输出。
- `PIG_GITHUB_TOKEN`：可选，用于提高 GitHub 公开数据请求额度。

不要把密钥写进源码、文档、前端 `VITE_` 变量或聊天记录。生产配置按用户要求通过宝塔界面完成；服务重启后生效。已确认用户 VM 102 的 llama.cpp 模型为 `gemma-4-12b`，端口为内网 `192.168.2.5:8080`；基础模型调用通过。已通过 Proxmox 上的持久 SSH 反向隧道接通官网服务器本机 `127.0.0.1:18081`，模型端口没有向公网开放。2026-09-24 真实账户报告中英文总结通过，生成约 59 秒。

一次报告请求同时生成中英文文本。传给模型的是统计、最多 15 个仓库简介、四类提交证据及各 12 个 PR/Issue 标题；不发送提交者邮箱、私有仓库、评论全文。固定 system prompt 把标题、描述视为不可信数据，模型不能执行工具或修改评分。生成结果经 JSON 校验，引用必须对应输入中的证据 ID；前端以纯文本展示，链接由后端从已知证据生成。

AI 未配置显示「尚未启用」，失败、超时或输出不合法显示「暂时无法总结」，保留已扫描数据和固定分数。失败报告也会缓存 6 小时，避免反复调用模型；管理员完成配置后，可通过 PocketBase 后台将特定测试账户的 `completedAt` 设为 0、`job` 和 `report` 置空，再重新扫描，或等待缓存过期。

## 运行与模块边界

- `pig-account/index.cjs`：账户规范化和扫描状态转换；GitHub 与 AI 通过注入接口调用。仅通过旧评分模块 `pig-king/index.cjs` 复用规则。
- `pig-account/server.cjs`：事务保存、任务锁、缓存、榜单和报告查询。PocketBase JSON 原始字段在此转换成 JS 对象。
- `pig-account/lib/summary.cjs`：私有模型适配器，不允许其他模块直接导入。
- `pig-account.pb.js`：PocketBase 路由入口与运行时适配。CommonJS 和 `.pb.js` 为框架约定。
- `src/features/pig-king/api.js`：前端唯一网络边界。页面离开时取消后续请求；重新输入同一账户会恢复任务。

每个 POST `/api/pig-king/account-scan` 最多推进一次外部请求，返回进度或完成报告。短事务先领取 120 秒租约，再释放数据库锁并请求外部服务；同账户并发复用同一任务，旧 worker 不覆盖新租约。上游错误保留进度并冷却 60 秒。API 每 IP 每分钟最多 30 次，前端每步间隔 2.2 秒。GET `/api/pig-king/account-leaderboard` 只返回紧凑排名条目；GET `/api/pig-king/account-report/{account}` 返回完整已生成报告。集合 CRUD 禁止匿名读写，分数与任务阶段不能由客户端指定。

部署需新增 `1790208000_pig_accounts.js` 迁移和 `pig-account.pb.js`、`pig-account/`，然后重启 PocketBase；不要替换生产 `pb_data`。本地验证使用真实 PocketBase 0.40.4、测试用例和前端构建。跨模块导入仅使用根入口；当前已通过 `npm run lint:boundaries` 自动检查，完整验证流程见 `docs/architecture.md`。
