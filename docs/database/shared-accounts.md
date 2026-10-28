# 官网统一账户迁移

2026-10-28，官网账号与资料迁入宝塔 PostgreSQL `lavamilk_account`。原始来源是 MySQL `community_users` 与 `account_profiles`。GitHub 数字 ID 是外部身份键，跨平台 UUID 是统一账户键；不按昵称或邮箱合并。

## 存储边界

`server/accounts/index.js` 是独立账户模块公共入口，提供经过 OAuth 验证的 signIn、session 身份检查、profile、preferences、health 与 close。私有 SQL 位于 lib，社区应用只调用公共入口。`ACCOUNT_DATABASE_URL` 是服务器私有配置；没有此配置仍运行旧模式，配置后数据库失效必须报错，不回退到 MySQL 身份。

基础账户表由 manage 的 `ops/accounts/001-initial.sql` 所有。官网新增 `server/accounts/schema.sql` 的 `website_accounts` 与 `website_account_schema`，通过统一 UUID 关联基础表。website_accounts 保留 GitHub ID、用户名、头像、原始时间和完整原资料 JSON；JSON 保留 NULL 与原始 UTC 微秒字符串。测试中的共享 schema fixture 是版本 1 合同副本，不是生产迁移入口。

新登录首先建立/更新 PG 账户、GitHub 身份和官网成员关系，再更新官网 MySQL 的平台投影并签发原有会话。UUID 映射幂等且由事务锁保护。MySQL 用户行继续作为聊天/榜单外键投影；平台 Cookie 和会话有效期保持原逻辑，每次已登录访问额外检查 PG 用户、平台及成员状态。普通用户仍不能获得 manage 管理员权限。

账户资料读取以 PG 为准。修改显示名/语言先写 PG，再写旧 MySQL 投影。两库没有分布式事务：若第二步失败，HTTP 返回错误，重试相同资料可修复投影。不能在接受新写入后直接删除 PG 配置回退；需要先核对并补齐两库差异。GitHub OAuth token 和私人邮箱不入库。聊天、榜单、OAuth 临时状态及平台会话仍在原 MySQL，CMS/FRP 未迁移。

## 迁移入口与核对

`server/accounts/import.js` 的 importWebsiteAccounts 接受 MySQL sourceUrl、PostgreSQL targetUrl 和 preview/apply/verify 模式。`server/import-accounts.js` 只从 SOURCE_MYSQL_URL、ACCOUNT_DATABASE_URL 读取私有配置。

```sh
node --env-file=/private/migration.env server/import-accounts.js
node --env-file=/private/migration.env server/import-accounts.js --apply
node --env-file=/private/migration.env server/import-accounts.js --verify
```

preview 完整执行后回滚。apply 在源一致性快照和目标事务内导入；现有目标记录不覆盖，差异将使整个目标事务回滚。核对包括账号/资料数量、所有源字段的规范化 SHA-256、身份与平台关联。正式导入必须暂停写入、重新备份，再迁移核对；不是在线双写迁移工具。该模块不迁移聊天或密码，也不制造测试账号。

## 生产记录

- 3 个账号、2 份资料、3 个 GitHub 身份映射已迁移。没有资料的账号仍保留 NULL，未被删除或合并。
- 源与目标校验值均为 `bb06a1939cab9f5741d8bcd6816ee40659185286ee921bcdc77522c7fb96df56`。
- 官网使用独立的 `lavamilk_web_accounts` 角色。仅拥有所需账户表的读/插入/更新权限，不能创建数据库、管理角色或删除账号；manage 原角色仍只有读取权限。
- PostgreSQL 原始本机 trust 规则已改为本机 socket peer 与 TCP 密码认证；正确密码、错误密码拒绝、普通系统用户不得冒充 postgres 均已验证。
- 备份：`/www/backups/lavamilk/account-migration-20261028-132224`。包含最终 MySQL dump、PG 初始化前快照、旧后端与 Compose/Nginx/发布配置。MySQL dump 已恢复到本机隔离临时库并核对账号/资料数量，临时库随后清理。
- `/opt/lavamilk-account-migration/completed.json` 保存实际发布文件 SHA-256 清单与迁移结果；私有连接串不在仓库。
- 本次仅替换后端并重新创建 api 服务，未发布前端。线上 Nginx 将旧 `/ai-chat/` 入口返回 410；现有整站发布校验仍要求该入口可用，因此本次不触发整站自动发布。后续整站发布前需要单独核对这项既有路由与发布检查的差异。
- 服务器发布门禁现在额外校验 accounts 模块文件，阻止旧产物移除统一账户接入；更新已审批账户代码或 schema 需按显式迁移流程核对基线。

## 验证与回退

`npm run test:accounts` 使用两个独立测试数据库，验证事务预演、重复导入、冲突不覆盖、完整资料与微秒、旧会话保留、新 OAuth 登录入库、UUID 去重、用户/平台成员停用、资料投影、异常不回退和退出。`npm run check:all` 同时覆盖原 MySQL/PostgreSQL 社区接口与浏览器行为。

流量恢复前失败会恢复旧后端、Compose 与 Nginx；保留 PG 已导入数据以便核对。流量恢复后先重新进入维护窗口，备份两个数据库，核对 PG 新账号、资料与 MySQL 投影并补齐，再恢复配置和旧后端；仅恢复文件不能撤销或同步后续账户写入。恢复 PostgreSQL 认证文件会重新启用旧 trust，普通应用回退不应恢复这项认证设置。
