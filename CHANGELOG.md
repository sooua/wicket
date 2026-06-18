# Changelog

本项目的所有重要变更记录于此。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.2] - 2026-06-18

### Changed
- 登录认证从浏览器原生 `prompt` 弹框升级为符合设计系统的**全屏登录页**（品牌标识、密码框、错误提示、验证中状态）；多个并发请求共用同一登录态，只弹一次。
- 设置页新增「退出登录（清除本机令牌）」，仅在服务端启用 `PANEL_TOKEN` 时显示。

### Notes
- v1.0.1 的 `writeRemoteFile` 修复已包含在镜像内；前端随镜像分发，`docker compose pull && docker compose up -d --force-recreate` 即可获得新登录页。

## [1.0.1] - 2026-06-17

### Fixed
- **严重**：修复 `writeRemoteFile` 把远程文件写成 0 字节的 bug。`sudo -S` 用 stdin 读密码，旧实现又把文件内容管道进同一条 stdin，密码 `printf` 吞掉了内容流，`tee` 写入空内容导致 Caddyfile 被截断。改为先写入临时文件，再 `sudo cat tmp > path`，内容流与密码流互不干扰。
- 影响：v1.0.0 的所有写操作（部署 / 删除 / 回滚 / 对齐主备）会损坏 Caddyfile，**请务必升级到 ≥ v1.0.1**。

## [1.0.0] - 2026-06-17

### Added
- 全屏运维控制台（暖色设计系统）：左导航 + 顶部状态栏 + 工作区 + 抽屉，自动刷新与相对时间戳。
- 独立页面：总览 / 域名路由 / 证书状态 / 备份与回滚 / 操作日志 / 设置。
- 域名路由：搜索、筛选、测试主备 TLS、复制验证命令、编辑、删除；现有手写配置只读，可「复制为新增」。
- 新增服务：子域名自动拼接、后端协议/IP/端口、后端 TCP 可达性探测、**预览部署**（先看配置块与脱敏 diff 再写）。
- 写入流程：全局互斥锁串行化 → 备份 → 写入 → `caddy validate` → `reload`，失败自动回滚。
- 备份与回滚：列出 `Caddyfile.backup-*`、脱敏差异、一键回滚、保留 N 个并清理更早备份。
- 主备一致性检测与「一键对齐主备」。
- 操作日志服务端持久化（`data/oplog.json`）。
- 监控告警：`/metrics`（Prometheus，`wicket_*` 指标）、后台看护、Alertmanager / Webhook 推送、证书到期与节点异常告警。
- 安全：默认绑定 `127.0.0.1`、可选 `PANEL_TOKEN`、敏感行（Cloudflare Token / 密码）脱敏，界面不展示任何凭据。
- 部署：Dockerfile、docker-compose、systemd 单元、`/healthz`；GitHub Actions 在 tag 推送时构建多架构镜像发布到 `ghcr.io/sooua/wicket`。

[Unreleased]: https://github.com/sooua/wicket/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/sooua/wicket/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/sooua/wicket/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/sooua/wicket/releases/tag/v1.0.0
