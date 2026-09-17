// Tiny JSON-file persistence layer. Good enough for a single-user dashboard;
// avoids pulling in a database for a handful of small config objects.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(name, fallback) {
  ensureDataDir();
  const file = filePath(name);
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[store] Failed to read ${file}:`, err.message);
    return fallback;
  }
}

function writeJson(name, data) {
  ensureDataDir();
  const file = filePath(name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return data;
}

module.exports = { readJson, writeJson, DATA_DIR };
