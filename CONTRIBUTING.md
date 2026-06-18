# 贡献指南

欢迎参与 Wicket。这是一个通过 SSH 管理内网主备 Caddy 的运维面板——**它持有 SSH 凭据并能改写生产配置**，所以下面的安全约定比代码风格更重要，请务必读完。

## 本地开发

```bash
npm install
cp .env.example .env     # 填入域名后缀与主备 SSH 凭据
npm start                # 默认 http://127.0.0.1:8181
```

- 纯 Node.js + Express + 原生前端，**无构建步骤**：改完 `src/`、`public/` 直接重启/刷新即可。
- 改完后端先做语法检查：`node --check src/server.js`。
- 提交前用真实或测试节点验证关键路径（见下"测试"）。

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/server.js` | Express 路由、状态快照、/metrics、后台看护 |
| `src/ssh.js` | SSH 执行与**远程文件读写原语** |
| `src/caddyfile.js` | 面板托管块的生成 / 解析 / 增删 |
| `src/lock.js` | 写操作全局互斥锁 |
| `src/oplog.js` | 服务端操作日志 |
| `src/store.js` | 本地服务记录 |
| `public/` | 单文件多页前端（`app.js` 渲染外壳与各页） |

## 安全红线（必须遵守）

1. **SSH 写入原语**：`writeRemoteFile` 绝不能把文件内容与 `sudo -S` 的密码流共用 stdin——历史上正是这个 bug 把 Caddyfile 写成 0 字节。任何改动写入逻辑的 PR，必须在真实节点验证"写入→读回比对→非空→`caddy validate` 通过"。
2. **凭据脱敏**：任何会把 Caddyfile 内容回传前端的接口（预览、备份 diff 等）必须经 `redactLine` 脱敏，绝不泄漏 Cloudflare Token / 密码。
3. **只动自己的块**：只增删 `# caddy-panel:start … / :end …` 标记块，不得覆盖整文件结构、不动全局 `tls` 块。
4. **先备份后写入**：所有写操作必须先备份、`validate` 失败自动回滚，并经 `withWriteLock` 串行化。
5. **不提交机密**：`.env`、令牌、密码不得进入提交、日志或 PR 描述。

## 测试

- 后端：`node --check`；针对一台可达节点验证 `/api/status`、`/api/services`、预览、以及（谨慎地）写入回归。
- 前端：浏览器打开各页，确认无水平溢出、加载/空/错误态正常、登录页与令牌流可用。
- 不要对生产节点执行真实部署/删除来"顺便测试"。

## 提交与分支

- 从 `main` 切分支开发，提交信息用祈使句简述意图（例：`Fix writeRemoteFile truncation`）。
- 一个 PR 聚焦一件事；涉及写入/安全的改动在描述里说明验证方式。

## 发版

见 [README 的发版小节](./README.md#-发版) 与 [`scripts/release.sh`](./scripts/release.sh)。流程：更新 `CHANGELOG.md` → `./scripts/release.sh X.Y.Z`（打 tag、推送触发镜像构建、按 CHANGELOG 创建 Release）。
