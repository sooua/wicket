"use strict";

/* ============ 常量 ============ */
const PAGE = document.body.dataset.page || "overview";
const SUFFIX_FALLBACK = "home.sooua.net";

const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.2"/><rect x="14" y="3" width="7" height="5" rx="1.2"/><rect x="14" y="12" width="7" height="9" rx="1.2"/><rect x="3" y="16" width="7" height="5" rx="1.2"/>',
  routes: '<path d="M8 4 4 8l4 4"/><path d="M4 8h13a3 3 0 0 1 3 3v1"/><path d="M16 20l4-4-4-4"/><path d="M20 16H7a3 3 0 0 1-3-3v-1"/>',
  certs: '<path d="M12 3l7 3v5.5c0 4.3-3 7.4-7 8.5-4-1.1-7-4.2-7-8.5V6z"/><path d="M9 12l2 2 4-4"/>',
  backups: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  logs: '<circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="16" y2="18"/>',
  settings: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.6"/><circle cx="15" cy="17" r="2.6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-1.8 6"/><path d="M20 4v6h-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  warn: '<path d="M12 3 2 20h20z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17.5" r=".6" fill="currentColor"/>',
};

function icon(name, cls = "svgico") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

const NAV = [
  { key: "overview", href: "index.html", label: "总览", ic: "overview" },
  { key: "routes", href: "routes.html", label: "域名路由", ic: "routes" },
  { key: "certs", href: "certs.html", label: "证书状态", ic: "certs" },
  { key: "backups", href: "backups.html", label: "备份与回滚", ic: "backups" },
  { key: "logs", href: "logs.html", label: "操作日志", ic: "logs" },
  { key: "settings", href: "settings.html", label: "设置", ic: "settings" },
];
const TITLES = { overview: "总览", routes: "域名路由", certs: "证书状态", backups: "备份与回滚", logs: "操作日志", settings: "设置" };

const state = {
  suffix: SUFFIX_FALLBACK,
  services: [],
  nodes: [],
  consistent: null,
  integration: null,
  lastUpdated: 0,
  filter: "all",
  query: "",
  logFilter: "all",
  loadingServices: false,
  backupNode: "primary",
  backupCount: 0,
  preview: { done: false, payloadKey: "" },
};

/* ============ 工具 ============ */
const $ = (s, r = document) => r.querySelector(s);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

let toastTimer;
function toast(message, kind = "ok") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3600);
}

const TOKEN_KEY = "panel_token";
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

// 登录态：401 时弹出全屏登录页，提交后重试；多个并发请求共用同一个登录 Promise
let loginState = { promise: null, resolve: null };
function requestToken(showError) {
  showLogin(showError);
  if (!loginState.promise) loginState.promise = new Promise((res) => { loginState.resolve = res; });
  return loginState.promise;
}
function showLogin(showError) {
  const scrim = $("#loginScrim");
  if (!scrim) return;
  scrim.hidden = false;
  const err = $("#loginError");
  if (err) { err.hidden = !showError; err.textContent = "令牌无效或已失效，请重新输入"; }
  const btn = $("#loginBtn");
  if (btn) { btn.disabled = false; btn.textContent = "进入控制台"; }
  setTimeout(() => $("#loginToken")?.focus(), 50);
}
function hideLogin() { const s = $("#loginScrim"); if (s && !s.hidden) s.hidden = true; }
function submitLogin() {
  const input = $("#loginToken");
  const err = $("#loginError");
  const value = input.value.trim();
  if (!value) { if (err) { err.hidden = false; err.textContent = "请输入访问令牌"; } return; }
  setToken(value);
  const btn = $("#loginBtn");
  if (btn) { btn.disabled = true; btn.textContent = "验证中…"; }
  const resolve = loginState.resolve;
  loginState = { promise: null, resolve: null };
  if (resolve) resolve(value);
}

async function api(path, options = {}) {
  let triedToken = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const tok = getToken();
    if (tok) headers["x-panel-token"] = tok;
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      await requestToken(triedToken); // 首次不报错；重试后仍 401 则提示令牌无效
      triedToken = true;
      continue;
    }
    hideLogin();
    const data = await res.json().catch(() => ({ ok: false, error: "响应解析失败" }));
    if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  }
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ---- 操作日志：服务端存储 ---- */
async function logClient(action, ok, message) {
  try { await api("/api/oplog", { method: "POST", body: JSON.stringify({ action, ok, message }) }); } catch { /* 忽略 */ }
}

/* ============ 外壳渲染 ============ */
function navHtml() {
  return NAV.map((n) =>
    `<a class="nav-item ${n.key === PAGE ? "active" : ""}" href="${n.href}"><span class="nav-ico">${icon(n.ic)}</span>${n.label}</a>`
  ).join("");
}

function statusStripHtml() {
  return `
    <div class="stat-chip" data-key="primary"><span class="dot dot-idle"></span><div class="stat-meta"><span class="stat-label">主 Caddy</span><span class="stat-value">检测中…</span></div></div>
    <div class="stat-chip" data-key="backup"><span class="dot dot-idle"></span><div class="stat-meta"><span class="stat-label">备 Caddy</span><span class="stat-value">检测中…</span></div></div>
    <div class="stat-chip" data-key="cert"><span class="dot dot-idle"></span><div class="stat-meta"><span class="stat-label">通配符证书</span><span class="stat-value">—</span></div></div>
    <div class="stat-chip" data-key="count"><span class="dot dot-neutral"></span><div class="stat-meta"><span class="stat-label">服务数量</span><span class="stat-value">—</span></div></div>`;
}

function pageContentHtml() {
  switch (PAGE) {
    case "routes": return `
      <section class="view">
        <div class="panel">
          <div class="panel-head">
            <h2>域名路由</h2>
            <div class="toolbar">
              <div class="search">${icon("search", "search-ico")}<input type="search" id="searchInput" placeholder="搜索域名 / 后端 / 备注" autocomplete="off" /></div>
              <div class="seg" id="filterRail">
                <button class="seg-item active" data-filter="all">全部</button>
                <button class="seg-item" data-filter="managed">面板托管</button>
                <button class="seg-item" data-filter="discovered">现有配置</button>
                <button class="seg-item" data-filter="insecure">自签后端</button>
              </div>
              <span class="count-badge" id="serviceCount">—</span>
            </div>
          </div>
          <div class="table-wrap">
            <table class="grid">
              <thead><tr>
                <th class="col-host">域名</th><th class="col-up">后端地址</th>
                <th class="col-src">来源</th><th class="col-tls">后端 TLS</th><th class="col-act">操作</th>
              </tr></thead>
              <tbody id="serviceList"><tr><td class="state-cell" colspan="5"><span class="spinner"></span>正在加载…</td></tr></tbody>
            </table>
          </div>
        </div>
      </section>`;
    case "certs": return `
      <section class="view">
        <div class="panel">
          <div class="panel-head"><h2>证书状态</h2><span class="panel-hint">基于现有通配符证书 *.${escapeHtml(state.suffix)}，续签由 NAS 上的 Caddy 自动完成</span></div>
          <div class="cert-grid" id="certGrid"><div class="placeholder">正在读取证书…</div></div>
        </div>
      </section>`;
    case "backups": return `
      <section class="view">
        <div class="panel">
          <div class="panel-head">
            <h2>备份与回滚</h2>
            <div class="toolbar">
              <div class="seg" id="backupNodeSeg">
                <button class="seg-item active" data-bn="primary">主 NAS</button>
                <button class="seg-item" data-bn="backup">备 NAS</button>
              </div>
              <span class="count-badge" id="backupCount">—</span>
              <button class="btn btn-ghost" id="pruneBtn">清理旧备份</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="grid">
              <thead><tr><th class="col-bk-time">备份时间</th><th class="col-bk-file">文件名</th><th class="col-bk-act">操作</th></tr></thead>
              <tbody id="backupList"><tr><td class="state-cell" colspan="3"><span class="spinner"></span>正在读取备份…</td></tr></tbody>
            </table>
          </div>
        </div>
      </section>`;
    case "logs": return `
      <section class="view">
        <div class="panel panel-fill">
          <div class="panel-head"><h2>操作日志</h2><div class="toolbar">
            <div class="seg" id="logFilter">
              <button class="seg-item active" data-lf="all">全部</button>
              <button class="seg-item" data-lf="部署">部署</button>
              <button class="seg-item" data-lf="删除">删除</button>
              <button class="seg-item" data-lf="测试">测试</button>
              <button class="seg-item" data-lf="回滚">回滚</button>
            </div>
            <button class="btn btn-ghost" id="copyLog">复制全部</button><button class="btn btn-ghost" id="clearLog">清空</button>
          </div></div>
          <div class="log-last" id="logLast">最近一次操作：暂无</div>
          <div class="oplog" id="oplog"><div class="placeholder"><span class="spinner"></span>正在读取…</div></div>
        </div>
      </section>`;
    case "settings": return `
      <section class="view">
        <div class="panel">
          <div class="panel-head"><h2>设置</h2><span class="panel-hint">只读信息，敏感凭据（密码 / Cloudflare Token）不在界面展示</span></div>
          <div class="settings-grid" id="settingsGrid"><div class="placeholder">读取中…</div></div>
          <div class="settings-actions" id="settingsActions"></div>
        </div>
      </section>`;
    default: return `
      <section class="view">
        <div class="alert-bar" id="alertBar" hidden></div>
        <div class="metric-row" id="metricRow"></div>
        <div class="panel">
          <div class="panel-head">
            <h2>主备节点状态</h2>
            <div class="toolbar"><span class="panel-hint">通过 SSH 实时读取，故障切换由 MikroTik 负责</span><button class="btn btn-ghost" id="healthBtn">${icon("pulse")}健康巡检</button></div>
          </div>
          <div class="node-grid" id="nodeGrid"><div class="placeholder">正在读取节点状态…</div></div>
        </div>
      </section>`;
  }
}

function drawerHtml() {
  return `
    <div class="drawer-scrim" id="drawerScrim" hidden></div>
    <aside class="drawer" id="drawer" hidden aria-hidden="true">
      <div class="drawer-head"><h2 id="drawerTitle">新增服务</h2><button class="icon-btn" id="closeDrawer" aria-label="关闭">${icon("close")}</button></div>
      <form class="drawer-body" id="serviceForm" autocomplete="off">
        <div class="field">
          <label for="subdomain">子域名</label>
          <div class="domain-input"><input type="text" id="subdomain" name="subdomain" placeholder="grafana" /><span class="domain-suffix" id="domainSuffix">.${escapeHtml(state.suffix)}</span></div>
          <div class="field-hint" id="fullDomainHint">完整域名：grafana.${escapeHtml(state.suffix)}</div>
        </div>
        <div class="field">
          <label>后端地址</label>
          <div class="upstream-row">
            <select id="proto" name="proto"><option value="http">http</option><option value="https">https</option></select>
            <input type="text" id="backendIp" name="backendIp" placeholder="10.0.0.88" class="up-ip" />
            <span class="up-colon">:</span>
            <input type="text" id="backendPort" name="backendPort" placeholder="8080" class="up-port" inputmode="numeric" />
            <button type="button" class="mini" id="probeBtn" title="测试后端 TCP 可达性">测试可达</button>
          </div>
          <div class="field-hint" id="upstreamHint">反代目标：http://10.0.0.88:8080</div>
        </div>
        <label class="check-row"><input type="checkbox" id="insecureTls" name="insecureTls" /><span>跳过后端证书校验（后端为自签 HTTPS 时勾选）</span></label>
        <div class="field"><label for="note">备注</label><input type="text" id="note" name="note" maxlength="160" placeholder="可选，例如：监控面板" /></div>
        <input type="hidden" id="hostname" name="hostname" />
        <div class="drawer-preview" id="drawerPreview" hidden></div>
        <div class="drawer-actions"><button type="button" class="btn btn-ghost" id="resetButton">重置</button><button type="submit" class="btn btn-primary" id="submitBtn">预览变更</button></div>
        <p class="drawer-warn">先「预览变更」查看将写入的配置与差异；确认后再「部署」。部署会备份两台 NAS 的 Caddyfile，写入后 validate + reload，失败自动回滚。</p>
      </form>`;
}

function modalHtml() {
  return `
    <div class="modal-scrim" id="modalScrim" hidden>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3 id="modalTitle"></h3><button class="icon-btn" id="modalClose" aria-label="关闭">${icon("close")}</button></div>
        <div class="modal-body" id="modalBody"></div>
        <div class="modal-foot"><button class="btn btn-ghost" id="modalCopy">复制结果</button><button class="btn btn-primary" id="modalOk">关闭</button></div>
      </div>
    </div>`;
}

function renderShell() {
  const addBtn = PAGE === "routes"
    ? `<button class="btn btn-primary" id="openAddBtn">${icon("plus")}新增服务</button>`
    : PAGE === "overview"
    ? `<a class="btn btn-primary" href="routes.html#add">${icon("plus")}新增服务</a>` : "";
  $("#app").innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">W</div>
        <div class="brand-text"><div class="brand-title">Wicket</div><div class="brand-sub" id="suffixBadge">*.${escapeHtml(state.suffix)}</div></div>
      </div>
      <nav class="nav">${navHtml()}</nav>
      <div class="sidebar-foot"><button class="btn btn-ghost btn-block" id="refreshButton">${icon("refresh")}刷新数据</button><div class="foot-note">Wicket · ${location.host}</div></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title">${TITLES[PAGE]}</div>
        <span class="updated" id="updatedAt" title="数据更新时间">—</span>
        <div class="status-strip" id="statusStrip">${statusStripHtml()}</div>
        ${addBtn}
      </header>
      <div class="workarea" id="workarea">${pageContentHtml()}</div>
    </div>`;

  const extra = document.createElement("div");
  extra.innerHTML = `${PAGE === "routes" ? drawerHtml() : ""}${modalHtml()}${loginHtml()}<div class="toast" id="toast" hidden></div>`;
  document.body.appendChild(extra);
}

function loginHtml() {
  return `
    <div class="login-scrim" id="loginScrim" hidden>
      <form class="login-card" id="loginForm" autocomplete="off">
        <div class="login-brand">
          <div class="brand-mark">W</div>
          <div><div class="login-title">Wicket</div><div class="login-sub">内网 Caddy 控制台</div></div>
        </div>
        <div class="login-field">
          <label for="loginToken">访问令牌</label>
          <input type="password" id="loginToken" placeholder="请输入 PANEL_TOKEN" autocomplete="current-password" />
        </div>
        <div class="login-error" id="loginError" hidden></div>
        <button type="submit" class="btn btn-primary login-btn" id="loginBtn">进入控制台</button>
        <div class="login-hint">令牌由服务端 .env 的 PANEL_TOKEN 设定 · 验证通过后保存在本浏览器</div>
      </form>
    </div>`;
}

let modalCopyText = "";
function openModal(title, bodyHtml, copyText = "") {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHtml;
  modalCopyText = copyText;
  $("#modalCopy").style.display = copyText ? "" : "none";
  $("#modalScrim").hidden = false;
}
function closeModal() { const m = $("#modalScrim"); if (m) m.hidden = true; }

function renderHunks(hunks) {
  if (!hunks || !hunks.length) return `<div class="diff-empty">无差异</div>`;
  return `<div class="diff">` + hunks.map((h) =>
    `<div class="diff-hunk">` + h.map((l) => {
      const t = l.t === "+" ? "add" : l.t === "-" ? "del" : "ctx";
      const sign = l.t === "+" ? "+" : l.t === "-" ? "−" : " ";
      return `<div class="diff-line dl-${t}"><span class="dl-sign">${sign}</span><span class="dl-text">${escapeHtml(l.text)}</span></div>`;
    }).join("") + `</div>`
  ).join(`<div class="diff-gap">⋯</div>`) + `</div>`;
}

/* ============ 状态栏 ============ */
function setChip(key, dotClass, value) {
  const chip = $(`#statusStrip [data-key="${key}"]`);
  if (!chip) return;
  $(".dot", chip).className = `dot ${dotClass}`;
  $(".stat-value", chip).textContent = value;
}
function nodeOnline(n) { return Boolean(n && n.container && n.container.ok); }
function wildcardCert() {
  for (const n of state.nodes) if (n.certificate && n.certificate.ok) return n.certificate;
  return null;
}
function renderStatusStrip() {
  const primary = state.nodes.find((n) => n.role === "primary");
  const backup = state.nodes.find((n) => n.role === "backup");
  setChip("primary", primary ? (nodeOnline(primary) ? "dot-good" : "dot-bad") : "dot-idle", primary ? (nodeOnline(primary) ? "在线" : (primary.reachable ? "容器异常" : "不可达")) : "—");
  setChip("backup", backup ? (nodeOnline(backup) ? "dot-good" : "dot-bad") : "dot-idle", backup ? (nodeOnline(backup) ? "在线" : (backup.reachable ? "容器异常" : "不可达")) : "—");
  const cert = wildcardCert();
  if (cert && typeof cert.daysLeft === "number") {
    setChip("cert", cert.daysLeft > 30 ? "dot-good" : cert.daysLeft > 14 ? "dot-warn" : "dot-bad", `${cert.daysLeft} 天`);
  } else setChip("cert", state.nodes.length ? "dot-bad" : "dot-idle", state.nodes.length ? "读取失败" : "—");
  setChip("count", "dot-neutral", `${state.services.length} 个`);
}

/* ============ 总览告警 ============ */
function renderAlerts() {
  const bar = $("#alertBar");
  if (!bar) return;
  const items = [];
  const cert = wildcardCert();
  if (cert && typeof cert.daysLeft === "number") {
    if (cert.daysLeft <= 14) items.push(["bad", `通配符证书仅剩 ${cert.daysLeft} 天，请检查 NAS 上 Caddy 的自动续签是否正常`]);
    else if (cert.daysLeft <= 30) items.push(["warn", `通配符证书剩余 ${cert.daysLeft} 天，留意续签`]);
  } else if (state.nodes.length) {
    items.push(["bad", "无法读取通配符证书，主备入口可能异常"]);
  }
  if (state.consistent === false) items.push(["bad", "主备 Caddy 的面板托管配置不一致", `<button class="mini" data-sync="1">一键对齐主备</button>`]);
  state.nodes.filter((n) => !n.reachable).forEach((n) => items.push(["bad", `${n.name}（${n.host}）SSH 不可达`]));
  state.nodes.filter((n) => n.reachable && !nodeOnline(n)).forEach((n) => items.push(["warn", `${n.name} 的 caddy-ha 容器未在运行`]));

  if (!items.length) { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.hidden = false;
  bar.innerHTML = items.map(([k, msg, action]) => `<div class="alert alert-${k}">${icon("warn", "alert-ico")}<span>${escapeHtml(msg)}</span>${action || ""}</div>`).join("");
}

/* ============ 各页渲染 ============ */
function renderMetrics() {
  const box = $("#metricRow");
  if (!box) return;
  const total = state.services.length;
  const managed = state.services.filter((s) => s.managed).length;
  const insecure = state.services.filter((s) => s.insecureTls).length;
  const cert = wildcardCert();
  const certText = cert && typeof cert.daysLeft === "number" ? `${cert.daysLeft}<small> 天</small>` : "—";
  const consText = state.consistent === null ? "—" : state.consistent ? "一致" : "不一致";
  box.innerHTML = `
    <div class="metric"><div class="metric-label">服务总数</div><div class="metric-value">${total}</div><div class="metric-sub">面板托管 ${managed} · 现有 ${total - managed}</div></div>
    <div class="metric"><div class="metric-label">自签后端</div><div class="metric-value">${insecure}</div><div class="metric-sub">跳过证书校验</div></div>
    <div class="metric"><div class="metric-label">证书剩余</div><div class="metric-value">${certText}</div><div class="metric-sub">*.${escapeHtml(state.suffix)}</div></div>
    <div class="metric"><div class="metric-label">主备一致性</div><div class="metric-value" style="color:var(--${state.consistent === false ? "bad" : state.consistent ? "good" : "text-3"})">${consText}</div><div class="metric-sub">面板托管块比对</div></div>`;
}

function renderNodes() {
  const box = $("#nodeGrid");
  if (!box) return;
  if (!state.nodes.length) { box.innerHTML = `<div class="placeholder">未能读取节点状态，请检查 SSH 连接后刷新。</div>`; return; }
  box.innerHTML = state.nodes.map((node) => {
    const online = nodeOnline(node);
    const cert = node.certificate || {};
    const certOk = cert.ok && typeof cert.daysLeft === "number";
    const roleText = node.role === "primary" ? "主节点" : "备节点";
    const stateText = !node.reachable ? "SSH 不可达" : online ? "在线" : "容器异常";
    const stateCls = !node.reachable ? "bad" : online ? "good" : "warn";
    const containerText = node.container?.output || (node.reachable ? "未运行" : "SSH 不可达");
    return `
      <article class="node">
        <div class="node-top">
          <span class="dot dot-${stateCls === "good" ? "good" : stateCls === "warn" ? "warn" : "bad"}"></span>
          <div><div class="node-name">${escapeHtml(node.name)}</div><div class="node-role">${roleText} · NAS ${escapeHtml(node.host)} · Caddy ${escapeHtml(node.caddyIp)}</div></div>
          <span class="node-badge badge ${stateCls}">${stateText}</span>
        </div>
        <div class="node-rows">
          <div class="node-line"><span class="k">容器</span><span class="v" title="${escapeHtml(containerText)}">${escapeHtml(containerText)}</span></div>
          <div class="node-line"><span class="k">证书到期</span><span class="v">${escapeHtml(certOk ? cert.validTo : (cert.error || "未知"))}</span></div>
          <div class="node-line"><span class="k">剩余天数</span><span class="v">${certOk ? cert.daysLeft + " 天" : "—"}</span></div>
          <div class="node-line"><span class="k">域名数</span><span class="v">${node.managedServices ?? "—"}</span></div>
        </div>
      </article>`;
  }).join("");
}

function renderCerts() {
  const box = $("#certGrid");
  if (!box) return;
  if (!state.nodes.length) { box.innerHTML = `<div class="placeholder">暂无证书数据，请刷新。</div>`; return; }
  box.innerHTML = state.nodes.map((node) => {
    const cert = node.certificate || {};
    const ok = cert.ok && typeof cert.daysLeft === "number";
    const cls = !ok ? "bad" : cert.daysLeft > 30 ? "good" : cert.daysLeft > 14 ? "warn" : "bad";
    const colorVar = cls === "good" ? "good" : cls === "warn" ? "warn" : "bad";
    const subject = ok && cert.subject ? (cert.subject.CN || JSON.stringify(cert.subject)) : "—";
    const issuer = ok && cert.issuer ? (cert.issuer.O || cert.issuer.CN || "—") : "—";
    return `
      <article class="cert-card">
        <div class="cert-head">
          <span class="cert-days" style="color:var(--${colorVar})">${ok ? cert.daysLeft : "—"}</span>
          <div><div class="node-name">${escapeHtml(node.name)} <span class="badge ${cls}">${ok ? "有效" : "异常"}</span></div><div class="node-role">${escapeHtml(node.caddyIp)} · 剩余天数</div></div>
        </div>
        <div class="cert-rows">
          <div class="node-line"><span class="k">主体 CN</span><span class="v" title="${escapeHtml(subject)}">${escapeHtml(subject)}</span></div>
          <div class="node-line"><span class="k">签发者</span><span class="v">${escapeHtml(issuer)}</span></div>
          <div class="node-line"><span class="k">起始</span><span class="v">${escapeHtml(ok ? cert.validFrom : "—")}</span></div>
          <div class="node-line"><span class="k">到期</span><span class="v">${escapeHtml(ok ? cert.validTo : (cert.error || "未知"))}</span></div>
        </div>
      </article>`;
  }).join("");
}

function renderSettings() {
  const box = $("#settingsGrid");
  if (!box) return;
  const p = state.nodes.find((n) => n.role === "primary");
  const b = state.nodes.find((n) => n.role === "backup");
  const ig = state.integration || {};
  const metricsUrl = `${location.origin}${ig.metricsPath || "/metrics"}`;
  const rows = [
    ["域名后缀", `*.${state.suffix}`],
    ["主 Caddy", p ? `${p.caddyIp}（NAS ${p.host}）` : "—"],
    ["备 Caddy", b ? `${b.caddyIp}（NAS ${b.host}）` : "—"],
    ["Caddyfile", "/volume1/docker/caddy-ha/Caddyfile"],
    ["容器名", "caddy-ha"],
    ["证书续签", "由 NAS 上的 Caddy 通过 ACME 自动续签，面板仅监控"],
    ["主备一致性", state.consistent === null ? "—" : state.consistent ? "一致" : "不一致"],
    ["访问令牌", ig.authEnabled ? "已启用（PANEL_TOKEN）" : "未启用"],
    ["Prometheus 指标", metricsUrl],
    ["证书告警阈值", ig.certWarnDays != null ? `剩余 < ${ig.certWarnDays} 天` : "—"],
    ["后台看护周期", ig.watchIntervalSec != null ? `每 ${ig.watchIntervalSec} 秒` : "—"],
    ["Alertmanager 推送", ig.alertmanager ? "已配置" : "未配置"],
    ["Webhook 推送", ig.webhook ? "已配置" : "未配置"],
    ["凭据", "存于服务端 .env，界面不展示密码 / Cloudflare Token"],
  ];
  box.innerHTML = rows.map(([k, v]) => `<div class="set-row"><span class="k">${escapeHtml(k)}</span><span class="v" title="${escapeHtml(v)}">${escapeHtml(v)}</span></div>`).join("");
  const acts = $("#settingsActions");
  if (acts) acts.innerHTML = ig.authEnabled ? `<button class="btn btn-ghost" id="logoutBtn">退出登录（清除本机令牌）</button>` : "";
}

/* 路由表 */
function filteredServices() {
  const q = state.query;
  return state.services.filter((s) => {
    const hay = `${s.hostname} ${s.upstream} ${s.note || ""}`.toLowerCase();
    const okQ = !q || hay.includes(q);
    const okF = state.filter === "all" ||
      (state.filter === "managed" && s.managed) ||
      (state.filter === "discovered" && !s.managed) ||
      (state.filter === "insecure" && s.insecureTls);
    return okQ && okF;
  });
}
function renderServices() {
  const tbody = $("#serviceList");
  if (!tbody) return;
  const count = $("#serviceCount");
  if (state.loadingServices) {
    tbody.innerHTML = `<tr><td class="state-cell" colspan="5"><span class="spinner"></span>正在加载服务列表…</td></tr>`;
    if (count) count.textContent = "—";
    return;
  }
  const list = filteredServices();
  if (count) count.textContent = `${list.length} / ${state.services.length} 个`;
  if (!state.services.length) { tbody.innerHTML = `<tr><td class="state-cell" colspan="5"><div class="big">暂无服务</div>点击右上角「新增服务」添加首个内网反代。</td></tr>`; return; }
  if (!list.length) { tbody.innerHTML = `<tr><td class="state-cell" colspan="5">没有匹配「${escapeHtml(state.query)}」的域名。</td></tr>`; return; }
  tbody.innerHTML = list.map((s) => {
    const src = s.managed ? `<span class="badge brand">面板托管</span>` : `<span class="badge">现有配置</span>`;
    const tls = s.insecureTls ? `<span class="badge warn">自签</span>` : `<span class="badge">普通</span>`;
    const editBtn = s.managed
      ? `<button class="mini" data-edit="${escapeHtml(s.hostname)}">编辑</button>`
      : `<button class="mini" data-adopt="${escapeHtml(s.hostname)}" title="以此为模板新增一条面板托管配置">复制为新增</button>`;
    const delBtn = s.managed ? `<button class="mini danger" data-delete="${escapeHtml(s.hostname)}">删除</button>` : "";
    return `
      <tr>
        <td class="col-host"><div class="cell-main truncate" title="${escapeHtml(s.hostname)}">${escapeHtml(s.hostname)}</div>${s.note ? `<div class="cell-note truncate" title="${escapeHtml(s.note)}">${escapeHtml(s.note)}</div>` : ""}</td>
        <td class="col-up"><div class="mono truncate" title="${escapeHtml(s.upstream)}">${escapeHtml(s.upstream)}</div></td>
        <td class="col-src">${src}</td>
        <td class="col-tls">${tls}</td>
        <td class="col-act"><div class="row-actions">
          <button class="mini" data-test="${escapeHtml(s.hostname)}" title="测试主备 TLS 证书">测试</button>
          <button class="mini" data-copy="${escapeHtml(s.hostname)}" title="复制验证命令">复制命令</button>
          ${editBtn}${delBtn}
        </div></td>
      </tr>`;
  }).join("");
}

/* 操作日志页（服务端） */
async function renderOpLogs() {
  const box = $("#oplog");
  if (!box) return;
  let ops = [];
  try { ops = (await api("/api/oplog")).ops || []; } catch (e) { box.innerHTML = `<div class="placeholder">读取日志失败：${escapeHtml(e.message)}</div>`; return; }
  const last = $("#logLast");
  if (last) {
    if (!ops.length) { last.textContent = "最近一次操作：暂无"; last.className = "log-last"; }
    else { last.textContent = `最近一次操作 · ${fmtTime(ops[0].t)} · ${ops[0].action}：${ops[0].ok ? "成功" : "失败"}`; last.className = `log-last ${ops[0].ok ? "ok" : "err"}`; }
  }
  if (!ops.length) { box.innerHTML = `<div class="placeholder">暂无操作记录。执行测试、部署、删除或回滚后会记录于此。</div>`; return; }
  const shown = state.logFilter === "all" ? ops : ops.filter((o) => o.action.includes(state.logFilter));
  if (!shown.length) { box.innerHTML = `<div class="placeholder">没有「${escapeHtml(state.logFilter)}」类型的操作记录。</div>`; return; }
  box.innerHTML = shown.map((o) => `
    <div class="oplog-item">
      <span class="dot ${o.ok ? "dot-good" : "dot-bad"}"></span>
      <div class="oplog-body">
        <div class="oplog-head"><span class="oplog-action">${escapeHtml(o.action)}</span><span class="badge ${o.ok ? "good" : "bad"}">${o.ok ? "成功" : "失败"}</span><span class="oplog-time">${fmtTime(o.t)}</span></div>
        <pre class="oplog-msg">${escapeHtml(o.message)}</pre>
      </div>
    </div>`).join("");
}

/* 备份页 */
async function renderBackups() {
  const tbody = $("#backupList");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td class="state-cell" colspan="3"><span class="spinner"></span>正在读取备份…</td></tr>`;
  let data;
  try { data = await api(`/api/backups?node=${state.backupNode}`); }
  catch (e) { tbody.innerHTML = `<tr><td class="state-cell" colspan="3">读取失败：${escapeHtml(e.message)}</td></tr>`; return; }
  state.backupCount = data.files.length;
  const cnt = $("#backupCount"); if (cnt) cnt.textContent = `${data.files.length} 个`;
  if (!data.files.length) { tbody.innerHTML = `<tr><td class="state-cell" colspan="3"><div class="big">暂无备份</div>面板每次写入 Caddyfile 前会自动备份，部署一次后即可在此回滚。</td></tr>`; return; }
  tbody.innerHTML = data.files.map((f) => {
    const stamp = f.stamp.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z").replace(/T/, " ").replace(/Z$/, "");
    return `
      <tr>
        <td class="col-bk-time"><div class="cell-main">${escapeHtml(stamp)}</div></td>
        <td class="col-bk-file"><div class="mono truncate" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div></td>
        <td class="col-bk-act"><div class="row-actions">
          <button class="mini" data-diff="${escapeHtml(f.name)}">查看差异</button>
          <button class="mini danger" data-restore="${escapeHtml(f.name)}">回滚到此</button>
        </div></td>
      </tr>`;
  }).join("");
}

/* ============ 数据加载 ============ */
async function loadConfig() {
  try {
    const cfg = await api("/api/config");
    state.suffix = cfg.suffix || SUFFIX_FALLBACK;
    state.integration = cfg.integration || null;
    const sb = $("#suffixBadge"); if (sb) sb.textContent = `*.${state.suffix}`;
    const ds = $("#domainSuffix"); if (ds) ds.textContent = `.${state.suffix}`;
    updateDomainHint();
  } catch { /* 用回退后缀 */ }
}
async function loadStatus() {
  try {
    const res = await api("/api/status");
    state.nodes = res.nodes || [];
    state.consistent = res.consistent ?? null;
  } catch { state.nodes = []; state.consistent = null; }
  state.lastUpdated = Date.now();
  renderStatusStrip(); renderMetrics(); renderNodes(); renderCerts(); renderSettings(); renderAlerts(); renderUpdatedAt();
}

function renderUpdatedAt() {
  const el = $("#updatedAt");
  if (!el) return;
  if (!state.lastUpdated) { el.textContent = "—"; return; }
  const s = Math.round((Date.now() - state.lastUpdated) / 1000);
  el.textContent = s < 5 ? "刚刚更新" : s < 60 ? `更新于 ${s} 秒前` : `更新于 ${Math.floor(s / 60)} 分前`;
}
async function loadServices() {
  state.loadingServices = true; renderServices();
  try { state.services = (await api("/api/services")).services || []; }
  catch { state.services = []; }
  state.loadingServices = false;
  renderServices(); renderMetrics(); renderStatusStrip();
}
async function loadAll() {
  await loadConfig();
  await Promise.all([loadStatus(), loadServices()]);
}

/* ============ 抽屉（仅路由页） ============ */
function cleanSubdomain(v) { return v.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, ""); }
function resetPreview() {
  state.preview = { done: false, payloadKey: "" };
  const box = $("#drawerPreview"); if (box) { box.hidden = true; box.innerHTML = ""; }
  const btn = $("#submitBtn"); if (btn) btn.textContent = "预览变更";
}
function updateDomainHint() {
  const f = $("#serviceForm"); if (!f) return;
  const sub = cleanSubdomain(f.subdomain.value);
  $("#fullDomainHint").textContent = sub ? `完整域名：${sub}.${state.suffix}` : `请输入子域名，例如 grafana`;
}
function buildUpstream() {
  const f = $("#serviceForm");
  const ip = f.backendIp.value.trim(), port = f.backendPort.value.trim();
  if (!ip) return "";
  return `${f.proto.value}://${ip}${port ? ":" + port : ""}`;
}
function updateUpstreamHint() {
  const up = buildUpstream();
  $("#upstreamHint").textContent = up ? `反代目标：${up}` : "请填写后端 IP 与端口";
}
function currentPayload() {
  const f = $("#serviceForm");
  const sub = cleanSubdomain(f.subdomain.value);
  const hostname = f.hostname.value || (sub ? `${sub}.${state.suffix}` : "");
  return { hostname, upstream: buildUpstream(), insecureTls: f.insecureTls.checked, note: f.note.value.trim() };
}
function openDrawer(service, opts = {}) {
  const f = $("#serviceForm"); if (!f) return;
  const adopt = Boolean(opts.adopt);
  if (service && !adopt) {
    $("#drawerTitle").textContent = "编辑服务";
    const sub = service.hostname.endsWith(`.${state.suffix}`) ? service.hostname.slice(0, -(state.suffix.length + 1)) : service.hostname;
    f.subdomain.value = sub; f.subdomain.disabled = true;
    setUpstreamFields(service);
    f.note.value = service.note || "";
    f.hostname.value = service.hostname;
  } else if (service && adopt) {
    $("#drawerTitle").textContent = "复制为新增";
    const sub = service.hostname.endsWith(`.${state.suffix}`) ? service.hostname.slice(0, -(state.suffix.length + 1)) : service.hostname;
    f.subdomain.value = sub; f.subdomain.disabled = false;
    setUpstreamFields(service);
    f.note.value = service.note || "";
    f.hostname.value = "";
  } else {
    $("#drawerTitle").textContent = "新增服务";
    f.reset(); f.subdomain.disabled = false; f.hostname.value = "";
  }
  resetPreview();
  updateDomainHint(); updateUpstreamHint();
  $("#drawer").hidden = false; $("#drawerScrim").hidden = false; $("#drawer").setAttribute("aria-hidden", "false");
  setTimeout(() => (f.subdomain.disabled ? f.backendIp : f.subdomain).focus(), 50);
}
function setUpstreamFields(service) {
  const f = $("#serviceForm");
  const m = service.upstream.match(/^(https?):\/\/([^:/]+)(?::(\d+))?/);
  f.proto.value = m ? m[1] : "http";
  f.backendIp.value = m ? m[2] : "";
  f.backendPort.value = m && m[3] ? m[3] : "";
  f.insecureTls.checked = Boolean(service.insecureTls);
}
function closeDrawer() {
  const d = $("#drawer"); if (!d) return;
  d.hidden = true; $("#drawerScrim").hidden = true; d.setAttribute("aria-hidden", "true");
}

/* ============ 事件 ============ */
function bindEvents() {
  $("#refreshButton")?.addEventListener("click", () => {
    toast("正在刷新…");
    loadAll().then(() => toast("已刷新", "ok")).catch((e) => toast(`刷新失败：${e.message}`, "err"));
    if (PAGE === "logs") renderOpLogs();
    if (PAGE === "backups") renderBackups();
  });

  /* 路由页 */
  $("#openAddBtn")?.addEventListener("click", () => openDrawer(null));
  $("#closeDrawer")?.addEventListener("click", closeDrawer);
  $("#drawerScrim")?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); closeModal(); } });

  /* 登录 / 退出 */
  $("#loginForm")?.addEventListener("submit", (e) => { e.preventDefault(); submitLogin(); });
  document.addEventListener("click", (e) => {
    if (e.target.closest("#logoutBtn")) { setToken(""); location.reload(); }
  });

  /* 结果弹窗 */
  $("#modalClose")?.addEventListener("click", closeModal);
  $("#modalOk")?.addEventListener("click", closeModal);
  $("#modalScrim")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  $("#modalCopy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(modalCopyText); toast("结果已复制", "ok"); } catch { toast("复制失败", "err"); }
  });

  const f = $("#serviceForm");
  if (f) {
    const onEdit = () => { resetPreview(); };
    f.subdomain.addEventListener("input", () => { updateDomainHint(); onEdit(); });
    f.proto.addEventListener("change", () => { if (f.proto.value === "https") f.insecureTls.checked = true; updateUpstreamHint(); onEdit(); });
    f.backendIp.addEventListener("input", () => { updateUpstreamHint(); onEdit(); });
    f.backendPort.addEventListener("input", () => { updateUpstreamHint(); onEdit(); });
    f.insecureTls.addEventListener("change", onEdit);
    f.note.addEventListener("input", onEdit);
    $("#probeBtn").addEventListener("click", onProbe);
    $("#resetButton").addEventListener("click", () => { f.reset(); f.subdomain.disabled = false; f.hostname.value = ""; resetPreview(); updateDomainHint(); updateUpstreamHint(); f.subdomain.focus(); });
    f.addEventListener("submit", onSubmit);
  }

  $("#searchInput")?.addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderServices(); });
  $("#filterRail")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]"); if (!btn) return;
    state.filter = btn.dataset.filter;
    $("#filterRail").querySelectorAll(".seg-item").forEach((i) => i.classList.toggle("active", i === btn));
    renderServices();
  });
  $("#serviceList")?.addEventListener("click", onRowAction);

  /* 总览：健康巡检 + 一键对齐 */
  $("#healthBtn")?.addEventListener("click", onHealthcheck);
  $("#alertBar")?.addEventListener("click", (e) => { if (e.target.closest("[data-sync]")) onSync(); });

  /* 备份页：清理 */
  $("#pruneBtn")?.addEventListener("click", onPrune);

  /* 备份页 */
  $("#backupNodeSeg")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bn]"); if (!btn) return;
    state.backupNode = btn.dataset.bn;
    $("#backupNodeSeg").querySelectorAll(".seg-item").forEach((i) => i.classList.toggle("active", i === btn));
    renderBackups();
  });
  $("#backupList")?.addEventListener("click", onBackupAction);

  /* 日志页 */
  $("#logFilter")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lf]"); if (!btn) return;
    state.logFilter = btn.dataset.lf;
    $("#logFilter").querySelectorAll(".seg-item").forEach((i) => i.classList.toggle("active", i === btn));
    renderOpLogs();
  });
  $("#clearLog")?.addEventListener("click", async () => {
    if (!confirm("确认清空全部操作日志？")) return;
    try { await api("/api/oplog", { method: "DELETE" }); renderOpLogs(); toast("日志已清空", "ok"); } catch (e) { toast(`清空失败：${e.message}`, "err"); }
  });
  $("#copyLog")?.addEventListener("click", async () => {
    try {
      const ops = (await api("/api/oplog")).ops || [];
      const text = ops.map((o) => `[${fmtTime(o.t)}] ${o.action} ${o.ok ? "成功" : "失败"}\n${o.message}`).join("\n\n");
      await navigator.clipboard.writeText(text || "（空）");
      toast("日志已复制", "ok");
    } catch (e) { toast(`复制失败：${e.message}`, "err"); }
  });
}

async function onProbe() {
  const f = $("#serviceForm");
  const ip = f.backendIp.value.trim();
  const port = Number(f.backendPort.value.trim()) || (f.proto.value === "https" ? 443 : 80);
  const hint = $("#upstreamHint");
  if (!ip) { toast("请先填写后端 IP", "err"); return; }
  const btn = $("#probeBtn");
  btn.disabled = true; const old = btn.textContent; btn.textContent = "探测中";
  try {
    const r = await api("/api/probe", { method: "POST", body: JSON.stringify({ host: ip, port }) });
    if (r.reachable) { hint.innerHTML = `<span style="color:var(--good)">● 后端可达 ${escapeHtml(ip)}:${port}（${r.ms}ms）</span>`; }
    else { hint.innerHTML = `<span style="color:var(--bad)">● 后端不可达 ${escapeHtml(ip)}:${port}（${escapeHtml(r.error || "失败")}）</span>`; }
  } catch (e) { toast(`探测失败：${e.message}`, "err"); }
  finally { btn.disabled = false; btn.textContent = old; }
}

async function onSubmit(e) {
  e.preventDefault();
  const f = $("#serviceForm");
  const sub = cleanSubdomain(f.subdomain.value);
  if (!sub) { toast("请填写子域名", "err"); return; }
  const ip = f.backendIp.value.trim();
  if (!ip) { toast("请填写后端 IP", "err"); return; }
  if (!/^[a-zA-Z0-9.:-]+$/.test(ip)) { toast("后端 IP / 主机名格式不正确", "err"); return; }
  const port = f.backendPort.value.trim();
  if (port && !(Number(port) >= 1 && Number(port) <= 65535)) { toast("端口需在 1–65535", "err"); return; }

  const payload = currentPayload();
  const key = JSON.stringify(payload);
  const btn = $("#submitBtn");

  // 第一步：预览
  if (!state.preview.done || state.preview.payloadKey !== key) {
    btn.disabled = true; btn.textContent = "预览中…";
    try {
      const pv = await api("/api/services/preview", { method: "POST", body: JSON.stringify(payload) });
      const box = $("#drawerPreview");
      box.hidden = false;
      box.innerHTML = `
        <div class="preview-head">${pv.mode === "update" ? "将更新已有面板配置" : "将新增面板配置"} · <span class="mono">${escapeHtml(pv.hostname)}</span></div>
        <div class="preview-block"><pre>${escapeHtml(pv.block)}</pre></div>
        <div class="preview-diff-title">写入两台 Caddyfile 的差异（已脱敏）</div>
        ${renderHunks(pv.diff)}`;
      state.preview = { done: true, payloadKey: key };
      btn.textContent = "确认部署";
    } catch (err) {
      toast(`预览失败：${err.message}`, "err");
      btn.textContent = "预览变更";
    } finally {
      btn.disabled = false;
    }
    return;
  }

  // 第二步：部署
  btn.disabled = true; btn.textContent = "部署中…";
  try {
    await api("/api/services", { method: "POST", body: JSON.stringify(payload) });
    toast(`${payload.hostname} 已部署`, "ok");
    closeDrawer();
    await loadAll();
  } catch (err) {
    toast(`部署失败：${err.message}`, "err");
  } finally {
    btn.disabled = false; btn.textContent = "确认部署";
  }
}

async function onRowAction(e) {
  const btn = e.target.closest("button"); if (!btn) return;
  const hostname = btn.dataset.edit || btn.dataset.test || btn.dataset.delete || btn.dataset.copy || btn.dataset.adopt;
  const service = state.services.find((s) => s.hostname === hostname);

  if (btn.dataset.edit && service) { openDrawer(service); return; }
  if (btn.dataset.adopt && service) { openDrawer(service, { adopt: true }); return; }

  if (btn.dataset.test) {
    btn.disabled = true;
    openModal(`TLS 证书测试 · ${hostname}`, `<div class="modal-loading"><span class="spinner"></span>正在连接主备 Caddy 读取证书…</div>`);
    try {
      const res = await api("/api/test", { method: "POST", body: JSON.stringify({ hostname }) });
      const cards = (res.results || []).map((r) => {
        const c = r.cert || {};
        const ok = c.ok && c.daysLeft != null;
        const cls = !ok ? "bad" : c.daysLeft > 30 ? "good" : c.daysLeft > 14 ? "warn" : "bad";
        const colorVar = cls === "good" ? "good" : cls === "warn" ? "warn" : "bad";
        return `
          <div class="test-node">
            <div class="cert-head">
              <span class="cert-days" style="color:var(--${colorVar})">${ok ? c.daysLeft : "—"}</span>
              <div><div class="node-name">${escapeHtml(r.node)} <span class="badge ${cls}">${ok ? "证书有效" : "异常"}</span></div><div class="node-role">${escapeHtml(r.ip)} · 剩余天数</div></div>
            </div>
            <div class="cert-rows">
              <div class="node-line"><span class="k">主体 CN</span><span class="v">${escapeHtml(ok && c.subject ? (c.subject.CN || "-") : "-")}</span></div>
              <div class="node-line"><span class="k">签发者</span><span class="v">${escapeHtml(ok && c.issuer ? (c.issuer.O || c.issuer.CN || "-") : "-")}</span></div>
              <div class="node-line"><span class="k">到期</span><span class="v">${escapeHtml(ok ? c.validTo : (c.error || "未取得证书"))}</span></div>
            </div>
          </div>`;
      }).join("");
      const msg = (res.results || []).map((r) => {
        const c = r.cert || {};
        return `· ${r.node}（${r.ip}）：${c.daysLeft != null ? `剩余 ${c.daysLeft} 天，到期 ${c.validTo}` : (c.error || "未取得证书")}`;
      }).join("\n");
      openModal(`TLS 证书测试 · ${hostname}`, cards || `<div class="modal-loading">无返回结果</div>`, `主备 TLS 证书测试 · ${hostname}\n${msg}`);
    } catch (err) {
      openModal(`TLS 证书测试 · ${hostname}`, `<div class="modal-error">测试失败：${escapeHtml(err.message)}</div>`, "");
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (btn.dataset.copy) {
    const p = state.nodes.find((n) => n.role === "primary");
    const b = state.nodes.find((n) => n.role === "backup");
    const command = [
      `curl -Ik https://${hostname}/`,
      `curl -Ik --resolve ${hostname}:443:${p ? p.caddyIp : "10.0.0.20"} https://${hostname}/`,
      `curl -Ik --resolve ${hostname}:443:${b ? b.caddyIp : "10.0.0.21"} https://${hostname}/`,
    ].join("\n");
    try { await navigator.clipboard.writeText(command); toast("验证命令已复制到剪贴板", "ok"); }
    catch { toast("复制失败，命令见弹窗", "err"); }
    logClient(`复制验证命令 ${hostname}`, true, command);
    openModal(`验证命令 · ${hostname}`, `<pre class="cmd-block">${escapeHtml(command)}</pre>`, command);
    return;
  }

  if (btn.dataset.delete) {
    if (!confirm(`确认从两台 Caddy 删除面板托管的 ${hostname}？删除前会自动备份。`)) return;
    toast(`正在删除 ${hostname}…`);
    try {
      await api(`/api/services/${encodeURIComponent(hostname)}`, { method: "DELETE" });
      toast(`${hostname} 已删除`, "ok");
      await loadAll();
    } catch (err) {
      toast(`删除失败：${err.message}`, "err");
    }
  }
}

async function onSync() {
  if (!confirm("确认以「主 NAS」为准，把面板托管配置同步到备 NAS？\n会先备份备机，再 validate + reload，失败自动回滚。")) return;
  toast("正在对齐主备…");
  try {
    const res = await api("/api/sync", { method: "POST", body: JSON.stringify({ source: "primary" }) });
    const changed = (res.results || []).filter((r) => r.changed).length;
    toast(changed ? "已对齐主备" : "主备本就一致，无需变更", "ok");
    await loadAll();
  } catch (err) {
    toast(`对齐失败：${err.message}`, "err");
  }
}

async function onPrune() {
  const nodeName = state.backupNode === "primary" ? "主 NAS" : "备 NAS";
  const input = window.prompt(`保留 ${nodeName} 最近多少个备份？更早的将被删除（当前共 ${state.backupCount} 个）。`, "20");
  if (input === null) return;
  const keep = Math.max(1, Math.min(200, Number(input) || 20));
  toast("正在清理备份…");
  try {
    const res = await api("/api/backups/prune", { method: "POST", body: JSON.stringify({ node: state.backupNode, keep }) });
    toast(`已保留 ${res.kept} 个，删除 ${res.deleted} 个`, "ok");
    renderBackups();
  } catch (err) {
    toast(`清理失败：${err.message}`, "err");
  }
}

async function onHealthcheck() {
  const btn = $("#healthBtn");
  btn.disabled = true;
  openModal("健康巡检", `<div class="modal-loading"><span class="spinner"></span>正在并发测试所有服务在主备的 TLS 证书…</div>`);
  try {
    const res = await api("/api/healthcheck");
    const rows = res.rows.map((r) => {
      const cells = r.nodes.map((n) => {
        const cls = !n.ok ? "bad" : n.daysLeft > 30 ? "good" : n.daysLeft > 14 ? "warn" : "bad";
        const txt = n.ok ? `${n.daysLeft} 天` : (n.error || "失败");
        return `<td><span class="badge ${cls}">${escapeHtml(txt)}</span></td>`;
      }).join("");
      return `<tr><td><div class="mono truncate" title="${escapeHtml(r.hostname)}">${escapeHtml(r.hostname)}</div></td>${cells}</tr>`;
    }).join("");
    const head = `<tr><th>域名</th>${res.rows[0] ? res.rows[0].nodes.map((n) => `<th>${escapeHtml(n.node)}</th>`).join("") : "<th>主</th><th>备</th>"}</tr>`;
    openModal(
      `健康巡检 · ${res.okCount}/${res.total} 全部正常`,
      `<table class="hc-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`,
      "",
    );
  } catch (e) {
    openModal("健康巡检", `<div class="modal-error">巡检失败：${escapeHtml(e.message)}</div>`, "");
  } finally {
    btn.disabled = false;
  }
}

async function onBackupAction(e) {
  const btn = e.target.closest("button"); if (!btn) return;
  const file = btn.dataset.diff || btn.dataset.restore;
  if (!file) return;

  if (btn.dataset.diff) {
    openModal(`备份差异 · ${file}`, `<div class="modal-loading"><span class="spinner"></span>正在比对…</div>`);
    try {
      const d = await api(`/api/backups/diff?node=${state.backupNode}&file=${encodeURIComponent(file)}`);
      const summary = `<div class="preview-head">回滚到此备份后：新增 <span style="color:var(--good)">${d.added}</span> 行，移除 <span style="color:var(--bad)">${d.removed}</span> 行（已脱敏）</div>`;
      openModal(`备份差异 · ${file}`, summary + (d.hunks.length ? renderHunks(d.hunks) : `<div class="diff-empty">与当前配置一致</div>`), "");
    } catch (err) {
      openModal(`备份差异 · ${file}`, `<div class="modal-error">读取失败：${escapeHtml(err.message)}</div>`, "");
    }
    return;
  }

  if (btn.dataset.restore) {
    const nodeName = state.backupNode === "primary" ? "主 NAS" : "备 NAS";
    if (!confirm(`确认将 ${nodeName} 的 Caddyfile 回滚到 ${file}？\n回滚前会自动安全备份当前配置，并执行 validate + reload，失败自动还原。`)) return;
    toast("正在回滚…");
    try {
      await api("/api/backups/restore", { method: "POST", body: JSON.stringify({ node: state.backupNode, file }) });
      toast(`${nodeName} 已回滚到 ${file}`, "ok");
      await loadAll();
      renderBackups();
    } catch (err) {
      toast(`回滚失败：${err.message}`, "err");
    }
  }
}

/* ============ 自动刷新 ============ */
function startAutoRefresh() {
  // 每 5 秒更新"更新于 X"相对时间
  setInterval(renderUpdatedAt, 5000);
  // 每 45 秒后台刷新状态与服务（仅在标签页可见时）
  setInterval(() => {
    if (document.hidden) return;
    loadStatus();
    loadServices();
    if (PAGE === "logs") renderOpLogs();
  }, 45000);
  // 切回标签页且数据已陈旧（>30s）时立即刷新
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - state.lastUpdated > 30000) { loadStatus(); loadServices(); }
  });
}

/* ============ 启动 ============ */
renderShell();
bindEvents();
if (PAGE === "logs") renderOpLogs();
if (PAGE === "backups") renderBackups();
if (PAGE === "routes" && location.hash === "#add") openDrawer(null);
loadAll();
startAutoRefresh();
