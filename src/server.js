const express = require("express");
const tls = require("tls");
const net = require("net");
const { z } = require("zod");
const { config } = require("./config");
const { readRemoteFile, runSsh, shellQuote, sudo, writeRemoteFile } = require("./ssh");
const { parseDiscoveredServices, parseManagedServices, removeBlock, upsertBlock, buildBlock } = require("./caddyfile");
const { deleteService, readServices, saveService } = require("./store");
const { withWriteLock } = require("./lock");
const { readOps, appendOp, clearOps } = require("./oplog");

const app = express();
app.use(express.json({ limit: "1mb" }));

// 可选 Token 鉴权：设置 PANEL_TOKEN 后，/api 与 /metrics 需携带 token
function tokenOk(req) {
  if (!config.token) return true;
  const header = req.headers["x-panel-token"];
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const query = req.query.token;
  return header === config.token || bearer === config.token || query === config.token;
}
function requireToken(req, res, next) {
  if (tokenOk(req)) return next();
  res.status(401).json({ ok: false, error: "未授权：缺少或错误的访问令牌" });
}
app.use("/api", requireToken);

app.use(express.static("public"));

const CADDYFILE = `${config.caddyDir}/Caddyfile`;
const BACKUP_RE = /^Caddyfile\.backup-[A-Za-z0-9._:-]+$/;

// 脱敏：Caddyfile 全局块可能含 Cloudflare Token / 密码，绝不回传前端原文
function redactLine(line) {
  return line
    .replace(/((?:acme_dns|dns)\s+cloudflare\s+)(\S+)/i, "$1********")
    .replace(/(\b(?:api_token|token|password|secret)\b\s+)(\S+)/i, "$1********");
}

// 基于 LCS 的行级 diff，返回 [{t:" "|"-"|"+", text}]，文本已脱敏
function diffLines(aText, bText) {
  const a = String(aText).split("\n");
  const b = String(bText).split("\n");
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: " ", text: redactLine(a[i]) }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", text: redactLine(a[i]) }); i += 1; }
    else { out.push({ t: "+", text: redactLine(b[j]) }); j += 1; }
  }
  while (i < n) { out.push({ t: "-", text: redactLine(a[i]) }); i += 1; }
  while (j < m) { out.push({ t: "+", text: redactLine(b[j]) }); j += 1; }
  return out;
}

// 只保留有变更的行及其上下文，避免回传整份配置
function toHunks(diff, ctx = 2) {
  const keep = new Array(diff.length).fill(false);
  diff.forEach((d, idx) => {
    if (d.t !== " ") {
      for (let k = Math.max(0, idx - ctx); k <= Math.min(diff.length - 1, idx + ctx); k += 1) keep[k] = true;
    }
  });
  const hunks = [];
  let cur = null;
  for (let idx = 0; idx < diff.length; idx += 1) {
    if (keep[idx]) {
      if (!cur) { cur = []; hunks.push(cur); }
      cur.push(diff[idx]);
    } else cur = null;
  }
  return hunks;
}

const serviceSchema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/),
  upstream: z.string().trim().url().regex(/^https?:\/\//),
  insecureTls: z.boolean().default(false),
  note: z.string().trim().max(160).optional().default(""),
});

function ensureLanHostname(hostname) {
  if (!hostname.endsWith(`.${config.suffix}`) && hostname !== config.suffix) {
    throw new Error(`域名必须属于 ${config.suffix}`);
  }
}

function getRemoteCaddyfile(node) {
  return readRemoteFile(node, CADDYFILE);
}

async function backupCaddyfile(node) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${config.caddyDir}/Caddyfile.backup-${stamp}`;
  const result = await runSsh(
    node,
    sudo(node, `cp ${shellQuote(CADDYFILE)} ${shellQuote(backupPath)}`),
  );
  if (result.code !== 0) {
    throw new Error(`${node.name}: backup failed: ${result.stderr || result.stdout}`);
  }
  return backupPath;
}

async function validateAndReload(node) {
  const validate = await runSsh(
    node,
    sudo(node, `/usr/local/bin/docker exec ${shellQuote(config.container)} caddy validate --config /etc/caddy/Caddyfile`),
  );
  if (validate.code !== 0) {
    throw new Error(`${node.name}: caddy validate failed: ${validate.stderr || validate.stdout}`);
  }

  const reload = await runSsh(
    node,
    sudo(node, `/usr/local/bin/docker exec ${shellQuote(config.container)} caddy reload --config /etc/caddy/Caddyfile`),
  );
  if (reload.code !== 0) {
    throw new Error(`${node.name}: caddy reload failed: ${reload.stderr || reload.stdout}`);
  }

  return { validate: validate.stdout + validate.stderr, reload: reload.stdout + reload.stderr };
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// 面板托管块的归一化哈希，用于主备一致性比对
function managedHash(caddyfile) {
  const items = parseManagedServices(caddyfile)
    .map((s) => `${s.hostname}|${s.upstream}|${s.insecureTls ? 1 : 0}`)
    .sort();
  return djb2(items.join("\n"));
}

function getCertificate(ip, servername) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: ip, port: 443, servername, rejectUnauthorized: false, timeout: 7000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error("未读取到证书"));
          return;
        }
        resolve({
          ok: true,
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysLeft: Math.ceil((new Date(cert.valid_to).getTime() - Date.now()) / 86400000),
        });
      },
    );
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS 连接超时"));
    });
    socket.on("error", reject);
  });
}

function probeTcp(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (reachable, error) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ reachable, ms: Date.now() - start, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "连接超时"));
    socket.once("error", (err) => finish(false, err.code || err.message));
    socket.connect(port, host);
  });
}

async function nodeStatus(node) {
  const [container, caddyfile] = await Promise.allSettled([
    runSsh(
      node,
      sudo(node, `/usr/local/bin/docker ps --filter name=${shellQuote(config.container)} --format '{{.Names}} {{.Status}}'`),
    ),
    getRemoteCaddyfile(node),
  ]);

  const reachable = container.status === "fulfilled";

  const cert = await getCertificate(node.caddyIp, `grafana.${config.suffix}`).catch((error) => ({
    ok: false,
    error: error.message,
  }));

  const cf = caddyfile.status === "fulfilled" ? caddyfile.value : null;

  return {
    role: node.role,
    name: node.name,
    host: node.host,
    caddyIp: node.caddyIp,
    reachable,
    container:
      container.status === "fulfilled"
        ? { ok: container.value.code === 0, output: container.value.stdout.trim() }
        : { ok: false, output: container.reason.message },
    managedServices:
      cf !== null
        ? new Set([...parseDiscoveredServices(cf), ...parseManagedServices(cf)].map((item) => item.hostname)).size
        : null,
    managedHash: cf !== null ? managedHash(cf) : null,
    certificate: cert,
  };
}

async function getMergedServices() {
  const local = await readServices();
  const remote = await getRemoteCaddyfile(config.nodes[0])
    .then((content) => [...parseDiscoveredServices(content), ...parseManagedServices(content)])
    .catch(() => []);
  const merged = new Map();
  [...remote, ...local].forEach((service) => merged.set(service.hostname, { ...merged.get(service.hostname), ...service }));
  return [...merged.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
}

// 并发上限映射
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx;
      idx += 1;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/* ============ 接口 ============ */

app.get("/api/config", (req, res) => {
  res.json({
    suffix: config.suffix,
    nodes: config.nodes.map(({ role, name, host, caddyIp }) => ({ role, name, host, caddyIp })),
    integration: {
      authEnabled: Boolean(config.token),
      metricsPath: "/metrics",
      certWarnDays: config.certWarnDays,
      watchIntervalSec: Math.round(config.watchIntervalMs / 1000),
      alertmanager: Boolean(config.alertmanagerUrl),
      webhook: Boolean(config.webhookUrl),
    },
  });
});

app.get("/api/status", async (req, res) => {
  try {
    const nodes = await Promise.all(config.nodes.map(nodeStatus));
    const hashes = nodes.map((n) => n.managedHash).filter((h) => h !== null);
    const consistent = hashes.length < 2 ? null : hashes.every((h) => h === hashes[0]);
    res.json({ ok: true, nodes, consistent });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/services", async (req, res) => {
  try {
    res.json({ ok: true, services: await getMergedServices() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 预览（只读，不写入、不部署）：返回将写入的配置块与脱敏 diff
app.post("/api/services/preview", async (req, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "输入格式不正确", details: parsed.error.flatten() });
    return;
  }
  const service = parsed.data;
  try {
    ensureLanHostname(service.hostname);
    const block = buildBlock(service);
    const original = await getRemoteCaddyfile(config.nodes[0]);
    const next = upsertBlock(original, service, config.suffix);
    const exists = parseManagedServices(original).some((s) => s.hostname === service.hostname);
    res.json({
      ok: true,
      hostname: service.hostname,
      upstream: service.upstream,
      block,
      mode: exists ? "update" : "create",
      diff: toHunks(diffLines(original, next)),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/services", async (req, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "输入格式不正确", details: parsed.error.flatten() });
    return;
  }

  const service = parsed.data;
  try {
    ensureLanHostname(service.hostname);
    const out = await withWriteLock(async () => {
      const results = [];
      for (const node of config.nodes) {
        const original = await getRemoteCaddyfile(node);
        const backupPath = await backupCaddyfile(node);
        const next = upsertBlock(original, service, config.suffix);
        await writeRemoteFile(node, CADDYFILE, next);
        try {
          const action = await validateAndReload(node);
          results.push({ node: node.name, ok: true, backupPath, ...action });
        } catch (error) {
          await writeRemoteFile(node, CADDYFILE, original);
          await validateAndReload(node).catch(() => {});
          throw new Error(`${error.message}。已尝试恢复 ${node.name} 的原 Caddyfile，备份：${backupPath}`);
        }
      }
      await saveService({ ...service, managed: true });
      return results;
    });

    await appendOp({
      action: `部署 ${service.hostname}`,
      ok: true,
      message: `${service.hostname} → ${service.upstream}\n` + out.map((r) => `· ${r.node}：已备份 ${r.backupPath}，validate/reload 完成`).join("\n"),
    });
    res.json({ ok: true, service: { ...service, managed: true }, results: out });
  } catch (error) {
    await appendOp({ action: `部署 ${service.hostname}`, ok: false, message: `失败：${error.message}` });
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/services/:hostname", async (req, res) => {
  const hostname = String(req.params.hostname || "").toLowerCase();
  try {
    ensureLanHostname(hostname);
    const out = await withWriteLock(async () => {
      const results = [];
      for (const node of config.nodes) {
        const original = await getRemoteCaddyfile(node);
        const backupPath = await backupCaddyfile(node);
        const next = removeBlock(original, hostname);
        await writeRemoteFile(node, CADDYFILE, next);
        try {
          const action = await validateAndReload(node);
          results.push({ node: node.name, ok: true, backupPath, ...action });
        } catch (error) {
          await writeRemoteFile(node, CADDYFILE, original);
          await validateAndReload(node).catch(() => {});
          throw new Error(`${error.message}。已尝试恢复 ${node.name} 的原 Caddyfile，备份：${backupPath}`);
        }
      }
      await deleteService(hostname);
      return results;
    });

    await appendOp({
      action: `删除 ${hostname}`,
      ok: true,
      message: out.map((r) => `· ${r.node}：已备份 ${r.backupPath}，validate/reload 完成`).join("\n"),
    });
    res.json({ ok: true, results: out });
  } catch (error) {
    await appendOp({ action: `删除 ${hostname}`, ok: false, message: `失败：${error.message}` });
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 一键对齐主备：以 source（默认主）为准，把面板托管块同步到另一台
app.post("/api/sync", async (req, res) => {
  const sourceRole = req.body.source === "backup" ? "backup" : "primary";
  const source = config.nodes.find((n) => n.role === sourceRole) || config.nodes[0];
  const targets = config.nodes.filter((n) => n.role !== sourceRole);
  try {
    const out = await withWriteLock(async () => {
      const srcContent = await getRemoteCaddyfile(source);
      const srcManaged = parseManagedServices(srcContent);
      const results = [];
      for (const node of targets) {
        const original = await getRemoteCaddyfile(node);
        const tgtManaged = parseManagedServices(original);
        let next = original;
        for (const m of tgtManaged) {
          if (!srcManaged.some((s) => s.hostname === m.hostname)) next = removeBlock(next, m.hostname);
        }
        for (const m of srcManaged) {
          next = upsertBlock(next, { hostname: m.hostname, upstream: m.upstream, insecureTls: m.insecureTls }, config.suffix);
        }
        if (next === original) { results.push({ node: node.name, ok: true, changed: false }); continue; }
        const backupPath = await backupCaddyfile(node);
        await writeRemoteFile(node, CADDYFILE, next);
        try {
          await validateAndReload(node);
          results.push({ node: node.name, ok: true, changed: true, backupPath });
        } catch (error) {
          await writeRemoteFile(node, CADDYFILE, original);
          await validateAndReload(node).catch(() => {});
          throw new Error(`${error.message}。已尝试恢复 ${node.name} 的原 Caddyfile，备份：${backupPath}`);
        }
      }
      return results;
    });
    await appendOp({
      action: `对齐主备（以 ${source.name} 为准）`,
      ok: true,
      message: out.map((r) => `· ${r.node}：${r.changed ? `已同步，备份 ${r.backupPath}` : "无需变更"}`).join("\n"),
    });
    res.json({ ok: true, source: source.name, results: out });
  } catch (error) {
    await appendOp({ action: "对齐主备", ok: false, message: `失败：${error.message}` });
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/test", async (req, res) => {
  const hostname = String(req.body.hostname || "").toLowerCase();
  try {
    ensureLanHostname(hostname);
    const results = await Promise.all(
      config.nodes.map(async (node) => {
        const cert = await getCertificate(node.caddyIp, hostname).catch((e) => ({ ok: false, error: e.message }));
        return { node: node.name, ip: node.caddyIp, cert };
      }),
    );
    await appendOp({
      action: `测试 ${hostname}`,
      ok: true,
      message: results.map((r) => `· ${r.node}（${r.ip}）：${r.cert.daysLeft != null ? `剩余 ${r.cert.daysLeft} 天，到期 ${r.cert.validTo}` : r.cert.error || "未取得证书"}`).join("\n"),
    });
    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 后端可达性探测（从面板主机 TCP 连接）
app.post("/api/probe", async (req, res) => {
  try {
    let host = String(req.body.host || "").trim();
    let port = Number(req.body.port);
    if (!host && req.body.upstream) {
      const m = String(req.body.upstream).match(/^https?:\/\/([^:/]+)(?::(\d+))?/);
      if (m) {
        host = m[1];
        port = port || Number(m[2]) || (String(req.body.upstream).startsWith("https") ? 443 : 80);
      }
    }
    if (!host || !port) {
      res.status(400).json({ ok: false, error: "需要 host 与 port" });
      return;
    }
    const result = await probeTcp(host, port);
    res.json({ ok: true, host, port, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 批量健康巡检：所有服务在主备的 TLS 证书
app.get("/api/healthcheck", async (req, res) => {
  try {
    const services = await getMergedServices();
    const rows = await mapLimit(services, 8, async (service) => {
      const nodes = await Promise.all(
        config.nodes.map(async (node) => {
          const cert = await getCertificate(node.caddyIp, service.hostname).catch((e) => ({ ok: false, error: e.message }));
          return { node: node.name, ip: node.caddyIp, ok: Boolean(cert.ok), daysLeft: cert.daysLeft ?? null, error: cert.error };
        }),
      );
      return { hostname: service.hostname, managed: Boolean(service.managed), upstream: service.upstream, nodes };
    });
    const okCount = rows.filter((r) => r.nodes.every((n) => n.ok)).length;
    res.json({ ok: true, total: rows.length, okCount, rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* ---- 备份与回滚 ---- */

app.get("/api/backups", async (req, res) => {
  const role = String(req.query.node || "primary");
  const node = config.nodes.find((n) => n.role === role) || config.nodes[0];
  try {
    const result = await runSsh(node, `ls -1 ${shellQuote(config.caddyDir)} 2>/dev/null`);
    const files = result.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((name) => BACKUP_RE.test(name))
      .sort()
      .reverse()
      .map((name) => ({
        name,
        // 文件名形如 Caddyfile.backup-2026-06-16T11-22-33-444Z
        stamp: name.replace(/^Caddyfile\.backup-/, ""),
      }));
    res.json({ ok: true, node: node.role, name: node.name, files });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 备份 diff（只读、脱敏）：展示「当前 → 该备份」的差异，不回传原始配置
app.get("/api/backups/diff", async (req, res) => {
  const role = String(req.query.node || "primary");
  const file = String(req.query.file || "");
  const node = config.nodes.find((n) => n.role === role) || config.nodes[0];
  if (!BACKUP_RE.test(file)) {
    res.status(400).json({ ok: false, error: "非法的备份文件名" });
    return;
  }
  try {
    const [backup, current] = await Promise.all([
      readRemoteFile(node, `${config.caddyDir}/${file}`),
      getRemoteCaddyfile(node).catch(() => ""),
    ]);
    // 以「当前」为基准，diff 到「备份」内容：+ 表示回滚后新增的行，- 表示回滚后移除的行
    const diff = diffLines(current, backup);
    const added = diff.filter((d) => d.t === "+").length;
    const removed = diff.filter((d) => d.t === "-").length;
    res.json({ ok: true, file, node: node.role, name: node.name, added, removed, hunks: toHunks(diff) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/backups/restore", async (req, res) => {
  const role = String(req.body.node || "primary");
  const file = String(req.body.file || "");
  const node = config.nodes.find((n) => n.role === role) || config.nodes[0];
  if (!BACKUP_RE.test(file)) {
    res.status(400).json({ ok: false, error: "非法的备份文件名" });
    return;
  }
  try {
    const out = await withWriteLock(async () => {
      const restored = await readRemoteFile(node, `${config.caddyDir}/${file}`);
      const original = await getRemoteCaddyfile(node);
      const safetyBackup = await backupCaddyfile(node);
      await writeRemoteFile(node, CADDYFILE, restored);
      try {
        const action = await validateAndReload(node);
        return { node: node.name, ok: true, safetyBackup, ...action };
      } catch (error) {
        await writeRemoteFile(node, CADDYFILE, original);
        await validateAndReload(node).catch(() => {});
        throw new Error(`${error.message}。已恢复回滚前的 Caddyfile，安全备份：${safetyBackup}`);
      }
    });
    await appendOp({ action: `回滚 ${node.name}`, ok: true, message: `已恢复 ${file}\n· 回滚前安全备份：${out.safetyBackup}\n· validate/reload 完成` });
    res.json({ ok: true, result: out });
  } catch (error) {
    await appendOp({ action: `回滚 ${node.name}`, ok: false, message: `恢复 ${file} 失败：${error.message}` });
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 备份保留清理：保留最近 N 个，删除更早的 Caddyfile.backup-*（白名单，永不动当前 Caddyfile）
app.post("/api/backups/prune", async (req, res) => {
  const role = req.body.node === "backup" ? "backup" : "primary";
  const node = config.nodes.find((n) => n.role === role) || config.nodes[0];
  const keep = Math.max(1, Math.min(200, Number(req.body.keep) || 20));
  try {
    const out = await withWriteLock(async () => {
      const list = await runSsh(node, `ls -1 ${shellQuote(config.caddyDir)} 2>/dev/null`);
      const files = list.stdout.split("\n").map((s) => s.trim()).filter((name) => BACKUP_RE.test(name)).sort().reverse();
      const toDelete = files.slice(keep);
      if (toDelete.length) {
        const paths = toDelete.map((f) => shellQuote(`${config.caddyDir}/${f}`)).join(" ");
        const r = await runSsh(node, sudo(node, `rm -f ${paths}`));
        if (r.code !== 0) throw new Error(`删除失败：${r.stderr || r.stdout}`);
      }
      return { total: files.length, kept: Math.min(keep, files.length), deleted: toDelete.length };
    });
    await appendOp({ action: `清理备份 ${node.name}`, ok: true, message: `保留最近 ${out.kept} 个，删除 ${out.deleted} 个` });
    res.json({ ok: true, ...out });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* ---- 操作日志 ---- */

app.get("/api/oplog", async (req, res) => {
  res.json({ ok: true, ops: await readOps() });
});

app.post("/api/oplog", async (req, res) => {
  await appendOp({ action: req.body.action, ok: req.body.ok !== false, message: req.body.message });
  res.json({ ok: true });
});

app.delete("/api/oplog", async (req, res) => {
  await clearOps();
  res.json({ ok: true });
});

/* ---- 监控快照 / Prometheus 指标 / 后台看护 ---- */
let lastSnapshot = { time: 0, nodes: [], consistent: null, total: 0, managed: 0 };

async function takeSnapshot() {
  const nodes = await Promise.all(config.nodes.map(nodeStatus));
  const hashes = nodes.map((n) => n.managedHash).filter((h) => h !== null);
  const consistent = hashes.length < 2 ? null : hashes.every((h) => h === hashes[0]);
  let total = 0;
  let managed = 0;
  try {
    const s = await getMergedServices();
    total = s.length;
    managed = s.filter((x) => x.managed).length;
  } catch { /* 忽略 */ }
  lastSnapshot = { time: Date.now(), nodes, consistent, total, managed };
  return lastSnapshot;
}

function metricsText() {
  const s = lastSnapshot;
  const out = [];
  const block = (name, help, type, lines) => { out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines); };
  block("caddy_panel_up", "Panel process up", "gauge", ["caddy_panel_up 1"]);
  block("caddy_panel_last_snapshot_timestamp_seconds", "Last snapshot unix time", "gauge", [`caddy_panel_last_snapshot_timestamp_seconds ${Math.floor(s.time / 1000)}`]);
  block("caddy_panel_node_reachable", "SSH reachable (1/0)", "gauge", s.nodes.map((n) => `caddy_panel_node_reachable{node="${n.name}",role="${n.role}"} ${n.reachable ? 1 : 0}`));
  block("caddy_panel_container_up", "caddy-ha container running (1/0)", "gauge", s.nodes.map((n) => `caddy_panel_container_up{node="${n.name}",role="${n.role}"} ${n.container && n.container.ok ? 1 : 0}`));
  block("caddy_panel_cert_days_left", "Wildcard cert days remaining", "gauge", s.nodes.filter((n) => n.certificate && typeof n.certificate.daysLeft === "number").map((n) => `caddy_panel_cert_days_left{node="${n.name}",role="${n.role}"} ${n.certificate.daysLeft}`));
  if (s.consistent !== null) block("caddy_panel_config_consistent", "Primary/backup managed config consistent (1/0)", "gauge", [`caddy_panel_config_consistent ${s.consistent ? 1 : 0}`]);
  block("caddy_panel_service_total", "Total services", "gauge", [`caddy_panel_service_total ${s.total}`]);
  block("caddy_panel_service_managed", "Panel-managed services", "gauge", [`caddy_panel_service_managed ${s.managed}`]);
  return out.join("\n") + "\n";
}

app.get("/metrics", async (req, res) => {
  if (!tokenOk(req)) { res.status(401).type("text/plain").send("unauthorized\n"); return; }
  if (!lastSnapshot.time) { await takeSnapshot().catch(() => {}); }
  res.type("text/plain; version=0.0.4").send(metricsText());
});

let prevConds = new Set();
function buildConditions(s) {
  const c = [];
  for (const n of s.nodes) {
    if (!n.reachable) c.push({ key: `unreachable:${n.role}`, alertname: "CaddyNodeUnreachable", severity: "critical", node: n.name, summary: `${n.name}（${n.host}）SSH 不可达` });
    else if (!(n.container && n.container.ok)) c.push({ key: `container:${n.role}`, alertname: "CaddyContainerDown", severity: "warning", node: n.name, summary: `${n.name} caddy-ha 容器未运行` });
    const cert = n.certificate;
    if (cert && !cert.ok) c.push({ key: `certfail:${n.role}`, alertname: "CaddyCertUnreadable", severity: "critical", node: n.name, summary: `${n.name} 通配符证书读取失败` });
    else if (cert && cert.ok && typeof cert.daysLeft === "number" && cert.daysLeft < config.certWarnDays) c.push({ key: `cert:${n.role}`, alertname: "CaddyCertExpiringSoon", severity: "warning", node: n.name, summary: `${n.name} 通配符证书剩余 ${cert.daysLeft} 天` });
  }
  if (s.consistent === false) c.push({ key: "inconsistent", alertname: "CaddyConfigInconsistent", severity: "warning", node: "-", summary: "主备 Caddy 面板配置不一致" });
  return c;
}

async function postJson(url, body, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function notifyAlertmanager(conds) {
  if (!config.alertmanagerUrl || !conds.length) return;
  const url = config.alertmanagerUrl.replace(/\/$/, "") + "/api/v2/alerts";
  const now = new Date().toISOString();
  await postJson(url, conds.map((c) => ({
    labels: { alertname: c.alertname, severity: c.severity, instance: config.panelInstance, node: c.node },
    annotations: { summary: c.summary },
    startsAt: now,
  })));
}

async function notifyWebhook(conds) {
  if (!config.webhookUrl || !conds.length) return;
  await postJson(config.webhookUrl, { source: config.panelInstance, time: new Date().toISOString(), alerts: conds.map((c) => ({ severity: c.severity, summary: c.summary })) });
}

async function watchTick() {
  let s;
  try { s = await takeSnapshot(); } catch { return; }
  const conds = buildConditions(s);
  const curKeys = new Set(conds.map((c) => c.key));
  // Alertmanager：每周期推送当前全部 firing（未再推送的会自动 resolve）
  if (config.alertmanagerUrl && conds.length) notifyAlertmanager(conds).catch(() => {});
  // Webhook + oplog：仅在新增告警（上升沿）时触发，避免刷屏
  const fresh = conds.filter((c) => !prevConds.has(c.key));
  if (fresh.length) {
    notifyWebhook(fresh).catch(() => {});
    appendOp({ action: "告警", ok: false, message: fresh.map((c) => `· [${c.severity}] ${c.summary}`).join("\n") }).catch(() => {});
  }
  prevConds = curKeys;
}

let watcherStarted = false;
function startWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  takeSnapshot().catch(() => {});
  setInterval(() => { watchTick().catch(() => {}); }, config.watchIntervalMs);
}

function onListening(host) {
  console.log(`LAN Caddy panel listening on http://${host}:${config.port}`);
  if (host !== "127.0.0.1" && !config.token) {
    console.warn("⚠ 面板未绑定本机回环且未设置 PANEL_TOKEN，内网可直接访问。建议设置 PANEL_TOKEN 或将 BIND_HOST 设为 127.0.0.1。");
  }
  if (config.token) console.log("访问令牌已启用（PANEL_TOKEN）");
  if (config.alertmanagerUrl) console.log(`告警将推送至 Alertmanager：${config.alertmanagerUrl}`);
  if (config.webhookUrl) console.log(`告警将推送至 Webhook：${config.webhookUrl}`);
  startWatcher();
}

function listenOn(host, allowFallback) {
  let bound = false;
  const server = app.listen(config.port, host, () => { bound = true; onListening(host); });
  server.on("error", (err) => {
    if (bound) { console.error(`监听运行中出错：${err.message}`); return; }
    if (allowFallback && err.code === "EACCES" && host !== "0.0.0.0") {
      console.warn(`绑定 ${host}:${config.port} 被系统拒绝（${err.code}），回退到 0.0.0.0。强烈建议设置 PANEL_TOKEN 保护访问。`);
      listenOn("0.0.0.0", false);
    } else {
      console.error(`监听 ${host}:${config.port} 失败：${err.message}`);
      process.exit(1);
    }
  });
}

listenOn(config.bindHost, true);
