<div align="center">

# 🪟 Wicket

**A small gate for your homelab.**

内网 HTTPS 反向代理与通配符证书的自托管运维控制台——通过 SSH 管理一对主备 Caddy。

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![status](https://img.shields.io/badge/status-self--hosted-orange)

</div>

---

Wicket 是一个轻量、本地优先的运维面板：给运行在两台主机（主 / 备）上的 [Caddy](https://caddyserver.com/) 添加、查看、测试内网域名反向代理，并监控通配符证书。它通过 SSH 操作 Caddy，**只管理自己写入的配置块**，每次写入前自动备份、写入后 `validate` + `reload`、失败自动回滚。

> Wicket 是面向 Caddy 的独立第三方管理工具，与 Caddy 项目无官方关联。

## ✨ 功能

- **总览**：主备节点在线状态、通配符证书剩余天数、主备配置一致性；证书将到期 / 配置不一致 / 节点掉线时顶部告警；「健康巡检」一键并发测试所有域名在主备的 TLS。
- **域名路由**：服务表（搜索 / 筛选 / 测试 / 复制验证命令 / 编辑 / 删除）；现有手写配置只读、可「复制为新增」转为面板托管；新增表单支持后端 TCP 可达性探测与**预览部署**（先看配置块与脱敏 diff，确认后再写）。
- **证书状态**：主备通配符证书详情与剩余天数。
- **备份与回滚**：列出每台主机的 `Caddyfile.backup-*`，查看脱敏差异，一键回滚（回滚前再安全备份，`validate` + `reload`，失败自动还原）；支持保留最近 N 个、清理更早备份。
- **操作日志**：服务端持久化，记录部署 / 删除 / 测试 / 回滚 / 告警，可按类型筛选。
- **一键对齐主备**：检测到不一致时，可以主为准把面板托管块同步到备机。
- **监控与告警**：`/metrics` 暴露 Prometheus 指标，可接入 Grafana；也支持直推 Alertmanager / 通用 Webhook。
- **暖色全屏界面**：左导航 + 顶部状态栏 + 工作区 + 抽屉，自动刷新与相对时间戳。

## 🚀 快速开始

```bash
git clone https://github.com/<your-github-username>/wicket.git
cd wicket
npm install
cp .env.example .env   # 然后按下方说明填写
npm start
```

打开 `http://127.0.0.1:8181`（端口见 `.env` 的 `PORT`）。

## ⚙️ 配置（`.env`）

| 变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口（默认 8181） |
| `BIND_HOST` | 监听地址，默认 `127.0.0.1`（仅本机）。需远程抓 `/metrics` 时改 `0.0.0.0` 并设 `PANEL_TOKEN` |
| `PANEL_TOKEN` | 可选访问令牌；设置后 `/api` 与 `/metrics` 需携带 `x-panel-token` / `Authorization: Bearer` / `?token=` |
| `LAN_DOMAIN_SUFFIX` | 域名后缀，如 `home.example.net`（对应通配符 `*.home.example.net`） |
| `PRIMARY_*` / `BACKUP_*` | 两台主机的名称、SSH 主机、用户、密码，以及对外 Caddy IP |
| `CADDY_DIR` / `CADDY_CONTAINER` | Caddyfile 所在目录与容器名 |
| `CERT_WARN_DAYS` | 证书剩余天数告警阈值（默认 14） |
| `WATCH_INTERVAL_SEC` | 后台看护轮询周期（默认 60） |
| `ALERTMANAGER_URL` / `WEBHOOK_URL` | 可选告警推送目标 |

> 凭据只存在服务端 `.env`（已被 `.gitignore` 排除），界面与所有接口都不展示密码 / Cloudflare Token。

## 🌐 新增服务（写入流程）

先点「预览变更」查看将写入的配置块与脱敏 diff，确认后「部署」会：

1. 读取两台主机的 `Caddyfile`
2. 分别备份为 `Caddyfile.backup-<时间戳>`
3. 写入面板托管的 `host matcher + handle` 块
4. `caddy validate` → `caddy reload`
5. 失败时恢复原 Caddyfile

所有写操作经全局互斥锁串行化，避免并发交错损坏配置。

## 📈 接入 Grafana

Wicket 在 `/metrics` 暴露 Prometheus 指标：

```text
wicket... 暂以 caddy_panel_ 前缀输出：
caddy_panel_up
caddy_panel_node_reachable{node,role}     # SSH 可达 1/0
caddy_panel_container_up{node,role}       # 容器运行 1/0
caddy_panel_cert_days_left{node,role}     # 通配符证书剩余天数
caddy_panel_config_consistent             # 主备一致 1/0
caddy_panel_service_total / _managed
caddy_panel_last_snapshot_timestamp_seconds
```

`prometheus.yml`：

```yaml
scrape_configs:
  - job_name: wicket
    metrics_path: /metrics
    static_configs:
      - targets: ["<面板IP>:8181"]
    # 若设置了 PANEL_TOKEN：
    authorization:
      type: Bearer
      credentials: "<PANEL_TOKEN>"
```

Grafana 告警规则示例（触发后走 Grafana 联系点通知）：

```text
证书将到期：  min(caddy_panel_cert_days_left) < 14
节点不可达：  min(caddy_panel_node_reachable) < 1
容器停止：    min(caddy_panel_container_up) < 1
配置不一致：  caddy_panel_config_consistent < 1
面板离线：    up{job="wicket"} == 0
```

不接 Grafana 也行：配置 `ALERTMANAGER_URL`（每周期推当前告警到 `/api/v2/alerts`，自动 resolve）或 `WEBHOOK_URL`（告警新出现时推一次，适配 Server酱 / 企业微信 / 自建）。

## 🔒 证书续签

通配符证书的签发与**自动续签由你主机上的 Caddy 自己完成**（ACME，如 Cloudflare DNS 挑战，Token 写在 Caddyfile 全局块）。Wicket **不读取 / 不展示 / 不修改**这部分，只做剩余天数监控与预警。

## 🛡️ 安全边界

- 只管理自己写入的 `# caddy-panel:start … / :end …` 配置块；迁移前手写的配置显示为「现有配置」，只读、不允许从面板删除。
- 预览、备份差异等接口对 Cloudflare Token / 密码等敏感行做脱敏，绝不回传原始配置。
- 不修改路由器 / DNS / 其它主机，不重启主机，不执行危险命令。

## 🧩 技术栈

Node.js · Express · ssh2 · zod · 原生 HTML/CSS/JS（无构建步骤）。

## 📄 License

[MIT](./LICENSE)
