require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  port: Number(process.env.PORT || 8787),
  bindHost: process.env.BIND_HOST || "127.0.0.1",
  token: process.env.PANEL_TOKEN || "",
  suffix: required("LAN_DOMAIN_SUFFIX"),
  caddyDir: process.env.CADDY_DIR || "/volume1/docker/caddy-ha",
  container: process.env.CADDY_CONTAINER || "caddy-ha",
  // 监控与通知
  certWarnDays: Number(process.env.CERT_WARN_DAYS || 14),
  watchIntervalMs: Math.max(15, Number(process.env.WATCH_INTERVAL_SEC || 60)) * 1000,
  alertmanagerUrl: process.env.ALERTMANAGER_URL || "",
  webhookUrl: process.env.WEBHOOK_URL || "",
  panelInstance: process.env.PANEL_INSTANCE || "caddy-panel",
  nodes: [
    {
      role: "primary",
      name: process.env.PRIMARY_NAME || "primary",
      host: required("PRIMARY_HOST"),
      username: required("PRIMARY_USER"),
      password: required("PRIMARY_PASSWORD"),
      caddyIp: required("PRIMARY_CADDY_IP"),
    },
    {
      role: "backup",
      name: process.env.BACKUP_NAME || "backup",
      host: required("BACKUP_HOST"),
      username: required("BACKUP_USER"),
      password: required("BACKUP_PASSWORD"),
      caddyIp: required("BACKUP_CADDY_IP"),
    },
  ],
};

module.exports = { config };
