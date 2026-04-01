const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  const raw = await readTextIfExists(filePath);
  if (raw === null) {
    return null;
  }
  return JSON.parse(raw);
}

async function writeTextAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function writeJsonAtomic(filePath, payload) {
  await writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function safeStat(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeProjectPath(inputPath) {
  return path.resolve(inputPath.trim());
}

function projectIdFromPath(projectPath) {
  return crypto.createHash("sha1").update(projectPath.toLowerCase()).digest("hex").slice(0, 12);
}

function formatTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  ensureDir,
  fileExists,
  formatTimestamp,
  normalizeProjectPath,
  projectIdFromPath,
  readJsonIfExists,
  readTextIfExists,
  safeStat,
  sleep,
  writeJsonAtomic,
  writeTextAtomic
};
