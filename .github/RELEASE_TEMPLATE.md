<!--
GitHub Release 说明模板
创建 Release 时复制本文件内容，按版本填写。标题用 vX.Y.Z，对应 CHANGELOG.md 同版本条目。
-->

## Wicket vX.Y.Z

<!-- 一句话概括本次重点。例：登录体验升级 + 关键写入修复并入镜像。 -->

### ✨ 新增 / 变更
-

### 🐛 修复
-

### ⚠️ 升级提醒
<!-- 有破坏性或需手动操作时填写，否则删除本节。 -->
-

### 🐳 Docker 镜像
```bash
docker pull ghcr.io/sooua/wicket:X.Y.Z
# 或 :latest
```

升级现有部署：
```bash
cd /path/to/wicket
# 如曾临时挂载补丁，先删除 docker-compose.yml 中的 ./patches/ssh.js 行
docker compose pull && docker compose up -d --force-recreate
curl http://<host>:8181/healthz   # 预期 {"ok":true,...}
```

### 📦 多架构
`linux/amd64` · `linux/arm64`

---
完整变更见 [CHANGELOG.md](../blob/main/CHANGELOG.md) · 对比：https://github.com/sooua/wicket/compare/vA.B.C...vX.Y.Z
