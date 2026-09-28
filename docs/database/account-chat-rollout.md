# 账户与对话接入

## 已实现

- GitHub 登录同步必要的公开资料；站内昵称独立保存，不保存 OAuth token、完整上游响应或邮箱。
- 聊天支持新建、列表/历史分页、改名、归档/恢复、删除、失败重试和取消。刷新或关闭页面不丢失已提交的问题。
- 同一账户同时最多一轮生成；数据库锁/唯一键保证请求幂等，模型上下文只来自当前会话。列表 30 条、历史 20 轮一页。
- 用户删除即隐藏对话并取消生成；7 天后 worker 分批物理清理。旧页面内存中的对话无法追溯补存。
- 旧账户下次 GitHub 登录同步资料；此前仍可聊天和设置昵称。

## 显式迁移

先完成数据库一致性备份。使用 MySQL 8.4，迁移账号需要 DDL 权限；凭据由环境注入，不写入命令历史或 Git。

```sh
MIGRATION_DATABASE_URL="$DATABASE_URL" node server/migrate.js
MIGRATION_DATABASE_URL="$DATABASE_URL" node server/migrate.js --check
```

`000-community` 登记现有基础表，`001-account-chat` 增加四张表。`schema_migrations` 记录 checksum 与 applying/complete 状态；重复执行完整版本无副作用。DDL 中途失败会留下 applying，必须先检查实际建表状态再修复，禁止直接把记录改为 complete。

运行时 `openStore` 只读检查版本，不自动建表。生产发布前管理员将已验证版本的 `server/community/lib/mysql.js` SHA256 和 `server/migrations` 文件哈希表写入 root 管理的 `/opt/lavamilk-deploy/approved-schema.json`：

```json
{"adapter":"<SHA256>","migrations":{"000-community.sql":"<SHA256>","001-account-chat.sql":"<SHA256>","index.js":"<SHA256>"}}
```

部署 receiver 独立安装，不执行包内运维脚本，拒绝未经登记的数据库文件变化。CI 仅发布代码，启动检查失败则回滚文件和服务，保留新表与聊天记录。以后新增迁移须先在测试库验证，再备份、迁移及更新登记。

## 运维范围

worker 当前和 API 同进程运行，每 500ms 检查任务；单实例模型容量沿用现有适配器。异常运行租约 120 秒后标为 interrupted，用户主动重试；不会自动反复调用模型。保存用量是最近一次尝试的模型返回值，不能用于精确计费。

本次执行发布前的一致性备份；每日备份、异机加密副本、30 天轮换、告警和恢复演练仍属于后续运维配置。应用回滚不执行 DROP TABLE。

## 2026-09-29 执行记录

生产 MySQL 8.4.11 的账户主键类型/排序规则符合迁移前提。迁移前备份位于服务器 `/www/backups/lavamilk/account-chat-before-20260929/database.sql`，附 SHA256；已恢复到独立临时库验证原有 7 张表，验证后移除临时库。两个迁移版本执行及 checksum 校验成功；旧 API 在增量迁移后继续健康。部署 receiver 更新为仅接受管理员登记的版本。
