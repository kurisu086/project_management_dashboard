const os = require("node:os");
const {
  OPERATION_LOG_FILE
} = require("./constants");
const {
  ensureDir
} = require("./fs-utils");
const fs = require("node:fs/promises");
const path = require("node:path");

async function recordOperationLog(entry) {
  const payload = {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    pid: process.pid,
    ...entry
  };
  await ensureDir(path.dirname(OPERATION_LOG_FILE));
  await fs.appendFile(OPERATION_LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

module.exports = {
  OPERATION_LOG_FILE,
  recordOperationLog
};
