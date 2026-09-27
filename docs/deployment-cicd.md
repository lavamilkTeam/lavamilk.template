# GitHub 自动发布

`.github/workflows/check.yml` 对 push / PR 执行 Node 22 安装、lint、类型和模块边界检查、单元测试、部署失败回滚测试、MySQL 8.4 集成测试、Chromium 浏览器测试及两个前端的构建。检查成功后上传同一份 `release-COMMIT` 产物，仅 `main` 的 push / 手动运行进入 `production` 发布。PR 不读取部署 Secret。

发布任务串行执行，不中断正在切换的版本；服务器还有文件锁和工作流序号检查，阻止迟到的旧版本覆盖新版本。工作流名称/文件迁移时需保留序号连续性，或由管理员核对并重置服务器 `current.json` 中的序号。

## 一次性配置

1. 将经过审查的 `ops/deploy/deploy.py` 安装为 `/opt/lavamilk-deploy/deploy.py`，由 root 持有且不可被应用用户写入。服务器需 Python 3.9+、Docker、curl、nginx；沿用现有 Node 容器镜像和宝塔站点。
2. 生成一把专用于此仓库的 Ed25519 密钥，不复用个人/root 日常私钥。在服务器 root 的 `authorized_keys` 为这把公钥添加前缀：
   ```text
   restrict,command="/usr/bin/python3 /opt/lavamilk-deploy/deploy.py" ssh-ed25519 PUBLIC_KEY lavamilk-github-deploy
   ```
   这把密钥只能接收 `deploy COMMIT RUN_NUMBER` 和标准输入中的发布包，不能开启交互 shell、SFTP 或端口转发。它仍能发布应用代码，应只交给可信仓库管理员。
3. 在仓库 Actions Secrets 保存 `LAVAMILK_DEPLOY_KEY`（专用私钥）和 `LAVAMILK_KNOWN_HOSTS`（通过现有可信 SSH 连接核验的 `45.192.97.209` 主机公钥行）。禁止用未验证的临时 keyscan 替代主机校验；不要把私钥提交到 Git。
4. 如果 GitHub 套餐支持，给 `production` environment 限定部署分支 `main`；不设置人工审批即可每次推送自动发布。工作流自身也检查分支和事件。
5. 在现有 HTTPS server 块中加入 `ops/nginx/lavamilk-spa.conf` 的 `/ai-chat/` 部分，先备份再执行 `nginx -t` 和 reload。保留原有 API、TLS、ACME、日志和宝塔 include。

## 发布范围和限制

产物只包含 `dist`、跟踪的 `server`、PocketBase hooks 与用于比对的 migrations；不含 node_modules、测试、数据库、环境文件和未跟踪内容。校验完整清单、commit 与每个文件 SHA-256，拒绝路径穿越、链接、隐藏文件和重复文件。

只有后端改变才在现行 Node 镜像中以用户 1000 执行 `npm ci --omit=dev --ignore-scripts`，不向安装容器传入生产凭据。只有受影响的 API 或 PocketBase 服务重启。前端保留旧哈希资源以支持已打开的页面，最后原子替换入口 HTML。

MySQL schema adapter (`server/community/lib/mysql.js`) 或 PocketBase migrations 变化会在任何线上文件写入前拒绝自动发布。此类变更需要单独的数据备份与迁移方案，并在人工完成后更新对应基线；本流程不自动迁移/回滚数据库、不运行 CMS seed/sync、不更新服务器上接收脚本自身、不改其他站点或容器。后端应保持对现有持久化数据的兼容性，文件回滚不能撤销业务写入。

发布验证包括页面直达、独立 AI 应用、全部 JS/CSS 等构建资源字节、静态资源 404、社区及 CMS 健康状态。任何验证失败恢复本次保存的前后端文件并验证旧版本，GitHub 任务以失败结束。断开 SSH / TERM / INT 会尝试回滚；断电或 SIGKILL 需要管理员恢复。

## 状态与回滚

- 当前成功发布：`/www/backups/lavamilk/cicd/current.json`。
- 每次备份：`/www/backups/lavamilk/cicd/RUN-COMMIT-TIMESTAMP/`，包含 `restore.json`，目录仅 root 可读。
- 保留备份以便人工回滚；定期检查磁盘并在确认稳定后由管理员清理旧备份。前端旧哈希资源也需定期清理。
- 管理员通过普通 SSH 进入服务器，锁定同一 `deploy.lock` 后，使用已安装模块的 `restore(Path(BACKUP))` 恢复指定备份。`restore.json` 描述该次发布替换的范围，因此它恢复的是该次发布**之前**的版本。
- 凭据轮换：新增专用公钥、更新 GitHub Secret、验证一次发布后删除旧公钥。撤销自动部署：移除专用 authorized_keys 行；日常 SSH 密钥不受影响。

GitHub 部署环境、并发与 Secrets 的行为参考 [官方部署文档](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)。

## 配置记录（2026-09-27）

服务器接收脚本、专用 forced-command 公钥和 `/ai-chat/` Nginx 规则已安装；日常 root 登录方式未改动。尝试用专用密钥运行普通 shell 命令被接收端拒绝。Nginx 语法检查和线上页面/资源/API 验证通过。安装前备份位于 `/www/backups/lavamilk/cicd-setup-20260927-155726/`。

GitHub 内置浏览器尚未登录，两个 Actions Secrets 仍待保存，尚未完成 GitHub 自动发布实跑。接收端已准备好，但当前不能将该状态称为“自动上线已启用”。
