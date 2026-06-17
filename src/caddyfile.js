function marker(hostname) {
  return {
    start: `# caddy-panel:start ${hostname}`,
    end: `# caddy-panel:end ${hostname}`,
  };
}

function normalizeHostname(hostname) {
  return hostname.trim().toLowerCase();
}

function buildBlock(service) {
  const hostname = normalizeHostname(service.hostname);
  const { start, end } = marker(hostname);
  const matcher = matcherName(hostname);
  const lines = [
    start,
    `    @${matcher} host ${hostname}`,
    `    handle @${matcher} {`,
    `        reverse_proxy ${service.upstream}${service.insecureTls ? " {" : ""}`,
  ];

  if (service.insecureTls) {
    lines.push("            transport http {");
    lines.push("                tls_insecure_skip_verify");
    lines.push("            }");
    lines.push("        }");
  }

  lines.push("    }");
  lines.push(end);
  return lines.join("\n");
}

function upsertBlock(caddyfile, service, suffix) {
  const hostname = normalizeHostname(service.hostname);
  const block = buildBlock({ ...service, hostname });
  const { start, end } = marker(hostname);
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "m");

  if (pattern.test(caddyfile)) {
    return caddyfile.replace(pattern, `${block}\n`);
  }

  const fallbackHandle = /\n\s+handle\s+\{\s*\n\s+respond\s+"unknown internal host"\s+404\s*\n\s+\}\s*\n\}/m;
  if (suffix && caddyfile.includes(`*.${suffix} {`) && fallbackHandle.test(caddyfile)) {
    return caddyfile.replace(fallbackHandle, `\n\n${block}\n$&`);
  }

  const trimmed = caddyfile.replace(/\s+$/g, "");
  return `${trimmed}\n\n${hostname} {\n    reverse_proxy ${service.upstream}\n}\n`;
}

function removeBlock(caddyfile, hostname) {
  const { start, end } = marker(normalizeHostname(hostname));
  const pattern = new RegExp(`\\n?${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "m");
  return caddyfile.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n");
}

function parseManagedServices(caddyfile) {
  const regex = /# caddy-panel:start ([^\n]+)\n([\s\S]*?)# caddy-panel:end \1/g;
  const services = [];
  let match;
  while ((match = regex.exec(caddyfile))) {
    const hostname = match[1].trim();
    const body = match[2];
    const upstream = body.match(/reverse_proxy\s+([^\s{]+)/)?.[1] || "";
    services.push({
      hostname,
      upstream,
      insecureTls: body.includes("tls_insecure_skip_verify"),
      managed: true,
    });
  }
  return services;
}

function parseDiscoveredServices(caddyfile) {
  const matcherRegex = /^\s+@([A-Za-z0-9_-]+)\s+host\s+(.+)$/gm;
  const services = [];
  let match;
  while ((match = matcherRegex.exec(caddyfile))) {
    const matcher = match[1];
    if (matcher.startsWith("panel_")) continue;
    const hostnames = match[2].trim().split(/\s+/);
    const start = matcherRegex.lastIndex;
    const next = caddyfile.slice(start).search(/\n\s+@[A-Za-z0-9_-]+\s+host\s+|\n\s+handle\s+\{\s*\n\s+respond/m);
    const segment = caddyfile.slice(start, next >= 0 ? start + next : undefined);
    if (!segment.includes(`handle @${matcher}`)) continue;
    const upstream = segment.match(/reverse_proxy\s+([^\s{]+)/)?.[1] || "";
    if (!upstream) continue;
    for (const hostname of hostnames) {
      services.push({
        hostname: normalizeHostname(hostname),
        upstream,
        insecureTls: segment.includes("tls_insecure_skip_verify"),
        managed: false,
      });
    }
  }
  return services;
}

function matcherName(hostname) {
  return `panel_${hostname.replace(/[^a-z0-9]/g, "_")}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { buildBlock, upsertBlock, removeBlock, parseManagedServices, parseDiscoveredServices };
