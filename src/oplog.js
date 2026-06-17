const fs = require("fs/promises");
const path = require("path");

const logPath = path.join(process.cwd(), "data", "oplog.json");
const MAX = 500;

async function readOps() {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    return [];
  }
}

async function appendOp({ action, ok, message }) {
  const ops = await readOps();
  ops.unshift({
    t: new Date().toISOString(),
    action: String(action || "操作"),
    ok: Boolean(ok),
    message: String(message ?? ""),
  });
  const next = ops.slice(0, MAX);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, JSON.stringify(next, null, 2));
  return next;
}

async function clearOps() {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, "[]");
  return [];
}

module.exports = { readOps, appendOp, clearOps };
