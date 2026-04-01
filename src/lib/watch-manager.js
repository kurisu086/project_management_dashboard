const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  AGENTS_FILE_NAME,
  CONTROL_DIR_NAME,
  CURRENT_STATE_FILE_NAME,
  CURRENT_STATE_MD_FILE_NAME,
  DECISION_LOG_FILE_NAME,
  DOCS_DIR_NAME,
  GAME_DESIGN_FILE_NAME,
  MODULE_MAP_FILE_NAME,
  POLL_INTERVAL_MS,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  RUNS_DIR_NAME,
  SUPERPOWERS_DIR_NAME,
  SUPERPOWERS_PLANS_DIR_NAME,
  SUPERPOWERS_SPECS_DIR_NAME,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME,
  WATCH_SETTLE_MS
} = require("./constants");
const {
  safeStat
} = require("./fs-utils");

class WatchManager {
  constructor(refreshProject) {
    this.refreshProject = refreshProject;
    this.entries = new Map();
  }

  async attach(projectRecord) {
    this.detach(projectRecord.id);

    const entry = {
      projectRecord,
      pollTimer: null,
      timers: {
        refresh: null,
        reattach: null
      },
      watchers: [],
      lastPollSignature: null,
      refreshInFlight: Promise.resolve()
    };

    this.entries.set(projectRecord.id, entry);
    this.startWatchers(entry);
    entry.pollTimer = setInterval(() => {
      this.pollProject(projectRecord.id).catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  detach(projectId) {
    const entry = this.entries.get(projectId);
    if (!entry) {
      return;
    }

    entry.watchers.forEach((watcher) => watcher.close());
    clearInterval(entry.pollTimer);
    clearTimeout(entry.timers.refresh);
    clearTimeout(entry.timers.reattach);
    this.entries.delete(projectId);
  }

  async pollProject(projectId) {
    const entry = this.entries.get(projectId);
    if (!entry) {
      return;
    }

    const signature = await buildPollSignature(entry.projectRecord.rootPath);
    if (!signature) {
      return;
    }

    if (entry.lastPollSignature && entry.lastPollSignature !== signature) {
      this.scheduleRefresh(projectId, "poll-detected-change");
    }

    entry.lastPollSignature = signature;
  }

  startWatchers(entry) {
    const { rootPath } = entry.projectRecord;
    const controlDir = path.join(rootPath, CONTROL_DIR_NAME);
    const superpowersRoot = path.join(rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME);
    const specsDir = path.join(superpowersRoot, SUPERPOWERS_SPECS_DIR_NAME);
    const plansDir = path.join(superpowersRoot, SUPERPOWERS_PLANS_DIR_NAME);

    this.tryAttachWatcher(entry, controlDir, { recursive: true }, "control");
    this.tryAttachWatcher(entry, rootPath, { recursive: false }, "root");
    this.tryAttachWatcher(entry, superpowersRoot, { recursive: true }, "superpowers");
    this.tryAttachWatcher(entry, specsDir, { recursive: true }, "superpowers");
    this.tryAttachWatcher(entry, plansDir, { recursive: true }, "superpowers");
  }

  tryAttachWatcher(entry, targetPath, options, scope) {
    try {
      const watcher = fs.watch(targetPath, options, (eventType, fileName) => {
        const relativeName = String(fileName || "");
        if (scope === "root" && relativeName && relativeName !== AGENTS_FILE_NAME) {
          return;
        }
        if (scope === "control" && shouldIgnoreControlEvent(relativeName)) {
          return;
        }
        if (scope === "superpowers" && shouldIgnoreSuperpowersEvent(relativeName)) {
          return;
        }

        this.scheduleRefresh(entry.projectRecord.id, `${scope}:${eventType}:${relativeName}`);
      });

      watcher.on("error", () => {
        this.recoverWatchers(entry.projectRecord.id);
      });

      entry.watchers.push(watcher);
    } catch {
      if (scope === "superpowers") {
        return;
      }
      this.recoverWatchers(entry.projectRecord.id);
    }
  }

  recoverWatchers(projectId) {
    const entry = this.entries.get(projectId);
    if (!entry) {
      return;
    }

    entry.watchers.forEach((watcher) => watcher.close());
    entry.watchers = [];
    clearTimeout(entry.timers.reattach);
    entry.timers.reattach = setTimeout(() => {
      const current = this.entries.get(projectId);
      if (!current) {
        return;
      }
      this.startWatchers(current);
      this.scheduleRefresh(projectId, "watch-reattach");
    }, 1000);
  }

  scheduleRefresh(projectId, reason) {
    const entry = this.entries.get(projectId);
    if (!entry) {
      return;
    }

    clearTimeout(entry.timers.refresh);
    entry.timers.refresh = setTimeout(() => {
      entry.refreshInFlight = entry.refreshInFlight
        .catch(() => {})
        .then(() => this.refreshProject(projectId, reason));
    }, WATCH_SETTLE_MS);
  }
}

async function buildPollSignature(projectRoot) {
  const files = [
    path.join(projectRoot, AGENTS_FILE_NAME),
    path.join(projectRoot, CONTROL_DIR_NAME, PROJECT_STATE_FILE_NAME),
    path.join(projectRoot, CONTROL_DIR_NAME, PROJECT_BRIEF_FILE_NAME),
    path.join(projectRoot, CONTROL_DIR_NAME, MODULE_MAP_FILE_NAME),
    path.join(projectRoot, CONTROL_DIR_NAME, TECH_STACK_FILE_NAME),
    path.join(projectRoot, CONTROL_DIR_NAME, GAME_DESIGN_FILE_NAME),
    path.join(projectRoot, CONTROL_DIR_NAME, VERSION_STATE_FILE_NAME),
    path.join(projectRoot, CONTROL_DIR_NAME, DECISION_LOG_FILE_NAME)
  ];

  const parts = [];
  for (const filePath of files) {
    const stat = await safeStat(filePath);
    parts.push(`${filePath}:${stat ? stat.mtimeMs : "missing"}`);
  }

  await appendDirectorySignature(parts, path.join(projectRoot, CONTROL_DIR_NAME, RUNS_DIR_NAME));
  await appendDirectorySignature(parts, path.join(projectRoot, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_SPECS_DIR_NAME));
  await appendDirectorySignature(parts, path.join(projectRoot, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_PLANS_DIR_NAME));

  return parts.join("|");
}

async function appendDirectorySignature(parts, dirPath) {
  const dirStat = await safeStat(dirPath);
  parts.push(`${dirPath}:${dirStat ? dirStat.mtimeMs : "missing"}`);
  if (!dirStat || !dirStat.isDirectory()) {
    return;
  }

  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const stat = await safeStat(absolutePath);
    parts.push(`${absolutePath}:${stat ? stat.mtimeMs : "missing"}`);

    if (entry.isDirectory()) {
      await appendDirectorySignature(parts, absolutePath);
    }
  }
}

function shouldIgnoreControlEvent(relativeName) {
  const normalized = relativeName.replaceAll("/", "\\");
  return (
    normalized === CURRENT_STATE_FILE_NAME ||
    normalized === CURRENT_STATE_MD_FILE_NAME ||
    normalized.startsWith("meta\\")
  );
}

function shouldIgnoreSuperpowersEvent(relativeName) {
  return !relativeName || relativeName.includes(".tmp");
}

module.exports = {
  WatchManager
};
