const fs = require("fs/promises");
const path = require("path");

const storePath = path.join(process.cwd(), "data", "services.json");

async function readServices() {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function saveService(service) {
  const services = await readServices();
  const without = services.filter((item) => item.hostname !== service.hostname);
  const next = [...without, { ...service, updatedAt: new Date().toISOString() }].sort((a, b) =>
    a.hostname.localeCompare(b.hostname),
  );
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(next, null, 2));
  return next;
}

async function deleteService(hostname) {
  const services = await readServices();
  const next = services.filter((item) => item.hostname !== hostname);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { readServices, saveService, deleteService };
