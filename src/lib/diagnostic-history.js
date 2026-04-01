const path = require("node:path");
const {
  DIAGNOSTIC_HISTORY_FILE,
  SCHEMA_VERSION
} = require("./constants");
const {
  ensureDir,
  readJsonIfExists,
  writeJsonAtomic
} = require("./fs-utils");

const MAX_HISTORY = 20;

async function loadDiagnosticHistory() {
  const payload = await readJsonIfExists(DIAGNOSTIC_HISTORY_FILE);
  if (!payload || !Array.isArray(payload.entries)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      entries: []
    };
  }

  return payload;
}

async function saveDiagnosticHistory(history) {
  await ensureDir(path.dirname(DIAGNOSTIC_HISTORY_FILE));
  await writeJsonAtomic(DIAGNOSTIC_HISTORY_FILE, history);
}

function recordDiagnosticEntry(history, entry) {
  history.entries.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry
  });

  history.entries = history.entries.slice(0, MAX_HISTORY);
}

function getRecentDiagnostics(history, limit = 5, projectRecord = null) {
  const entries = projectRecord
    ? history.entries.filter((entry) => {
        return (
          entry.projectId === projectRecord.id ||
          (entry.normalizedPath && entry.normalizedPath.toLowerCase() === projectRecord.rootPath.toLowerCase())
        );
      })
    : history.entries;

  return entries.slice(0, limit);
}

module.exports = {
  getRecentDiagnostics,
  loadDiagnosticHistory,
  recordDiagnosticEntry,
  saveDiagnosticHistory
};
