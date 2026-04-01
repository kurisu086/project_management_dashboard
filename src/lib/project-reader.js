const fs = require("node:fs/promises");
const path = require("node:path");
const {
  AGENTS_FILE_NAME,
  CONTROL_DIR_NAME,
  CURRENT_STATE_FILE_NAME,
  CURRENT_STATE_MD_FILE_NAME,
  DECISION_LOG_FILE_NAME,
  DOCS_DIR_NAME,
  GAME_DESIGN_FILE_NAME,
  GITIGNORE_FILE_NAME,
  META_DIR_NAME,
  MODULE_MAP_FILE_NAME,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_CONFIG_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  READ_RETRY_COUNT,
  READ_RETRY_DELAY_MS,
  RUNS_DIR_NAME,
  SCHEMA_VERSION,
  SUPERPOWERS_DIR_NAME,
  SUPERPOWERS_PLANS_DIR_NAME,
  SUPERPOWERS_SPECS_DIR_NAME,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME,
  WATCH_MANIFEST_FILE_NAME
} = require("./constants");
const {
  ensureDir,
  fileExists,
  formatTimestamp,
  readJsonIfExists,
  readTextIfExists,
  safeStat,
  sleep,
  writeJsonAtomic,
  writeTextAtomic
} = require("./fs-utils");
const {
  hasControlRulesBlock,
  upsertControlRules
} = require("./agents-rules");
const {
  upsertControlGitignore
} = require("./gitignore-rules");
const {
  ensureRepoLocalSkills,
  getRepoLocalSkillPaths
} = require("./repo-skill-templates");
const {
  collectRepoChangeFallback
} = require("./repo-change-fallback");
const {
  ensureOverviewSourceFiles,
  previewOverviewSourceFiles,
  readOverviewSources,
  rebuildOverviewSourceFiles
} = require("./project-overview");
const {
  buildCachePaths,
  buildCurrentState,
  buildDefaultProjectState,
  normalizeProjectState,
  persistCacheArtifacts
} = require("./state-generator");

async function ensureProjectScaffold(projectRecord) {
  const projectRoot = projectRecord.rootPath;
  const controlDir = path.join(projectRoot, CONTROL_DIR_NAME);
  const metaDir = path.join(controlDir, META_DIR_NAME);
  const runsDir = path.join(controlDir, RUNS_DIR_NAME);
  const agentsPath = path.join(projectRoot, AGENTS_FILE_NAME);
  const gitignorePath = path.join(projectRoot, GITIGNORE_FILE_NAME);
  const projectStatePath = path.join(controlDir, PROJECT_STATE_FILE_NAME);
  const projectConfigPath = path.join(metaDir, PROJECT_CONFIG_FILE_NAME);
  const watchManifestPath = path.join(metaDir, WATCH_MANIFEST_FILE_NAME);

  await ensureDir(controlDir);
  await ensureDir(metaDir);
  await ensureDir(runsDir);
  await ensureRepoLocalSkills(projectRoot);

  const agentsText = await readTextIfExists(agentsPath);
  const nextAgentsText = upsertControlRules(agentsText || "", {
    useSuperpowers: Boolean(projectRecord.useSuperpowers)
  });
  if (nextAgentsText !== (agentsText || "")) {
    await writeTextAtomic(agentsPath, nextAgentsText);
  }

  const gitignoreText = await readTextIfExists(gitignorePath);
  const nextGitignoreText = upsertControlGitignore(gitignoreText || "");
  if (nextGitignoreText !== (gitignoreText || "")) {
    await writeTextAtomic(gitignorePath, nextGitignoreText);
  }

  if (!(await fileExists(projectStatePath))) {
    await writeJsonAtomic(projectStatePath, buildDefaultProjectState(projectRecord.name));
  }

  await ensureOverviewSourceFiles(projectRecord);

  if (!(await fileExists(projectConfigPath))) {
    await writeJsonAtomic(projectConfigPath, buildProjectConfig(projectRecord));
  }

  if (!(await fileExists(watchManifestPath))) {
    await writeJsonAtomic(watchManifestPath, buildWatchManifest(projectRecord));
  }
}

async function readProjectSnapshot(projectRecord, options = {}) {
  const projectRoot = projectRecord.rootPath;
  const projectStatePath = path.join(projectRoot, CONTROL_DIR_NAME, PROJECT_STATE_FILE_NAME);
  const repoFacts = await collectRepoFacts(projectRoot);
  const conflicts = [];

  let rawProjectState = null;
  try {
    rawProjectState = await readJsonWithRetry(projectStatePath);
  } catch (error) {
    conflicts.push({
      level: "high",
      type: "project_state_parse_error",
      message: `Unable to parse project_state.json: ${error.message}`
    });
  }

  const normalizedState = normalizeProjectState(rawProjectState || {}, projectRecord.name);
  const overviewSources = await readOverviewSources(projectRecord, normalizedState, repoFacts);
  conflicts.push(...overviewSources.conflicts);

  if (
    rawProjectState &&
    rawProjectState.status &&
    Array.isArray(rawProjectState.status.fixedDeliverables) &&
    rawProjectState.status.fixedDeliverables.length !== 10
  ) {
    conflicts.push({
      level: "medium",
      type: "deliverables_shape_drift",
      message: "project_state.json fixedDeliverables is not the stable 10-item shape."
    });
  }

  repoFacts.runFiles.forEach((item) => {
    if (item.missing) {
      conflicts.push({
        level: "medium",
        type: "missing_run_file",
        message: `Referenced run file is missing: ${item.relativePath}`
      });
    }
    if (item.protocolIssues.length) {
      conflicts.push({
        level: "medium",
        type: "run_protocol_incomplete",
        message: `Run record is missing required fields: ${item.relativePath} (${item.protocolIssues.join(", ")})`
      });
    }
  });

  if (!repoFacts.agents.hasRulesBlock) {
    conflicts.push({
      level: "high",
      type: "missing_agents_rules",
      message: "AGENTS.md is missing the Codex control rules block."
    });
  }

  addMissingFileConflict(conflicts, repoFacts.files.projectState, "missing_project_state", "/.codex-control/project_state.json", "high");
  addMissingFileConflict(conflicts, repoFacts.files.projectBrief, "missing_project_brief", "/.codex-control/project_brief.json");
  addMissingFileConflict(conflicts, repoFacts.files.moduleMap, "missing_module_map", "/.codex-control/module_map.json");
  addMissingFileConflict(conflicts, repoFacts.files.techStack, "missing_tech_stack", "/.codex-control/tech_stack.json");
  addMissingFileConflict(conflicts, repoFacts.files.versionState, "missing_version_state", "/.codex-control/version_state.json");
  addMissingFileConflict(conflicts, repoFacts.files.decisionLog, "missing_decision_log", "/.codex-control/decision_log.json");
  addMissingFileConflict(conflicts, repoFacts.files.projectConfig, "missing_project_config", "/.codex-control/meta/project_config.json");
  addMissingFileConflict(conflicts, repoFacts.files.watchManifest, "missing_watch_manifest", "/.codex-control/meta/watch_manifest.json");

  if (repoFacts.legacyDerivedFiles.currentState.exists) {
    conflicts.push({
      level: "medium",
      type: "legacy_repo_derived_state",
      message: "Legacy repo-side current_state.json still exists. Dashboard no longer writes repo-derived cache files."
    });
  }

  if (repoFacts.legacyDerivedFiles.currentStateMarkdown.exists) {
    conflicts.push({
      level: "medium",
      type: "legacy_repo_derived_markdown",
      message: "Legacy repo-side current_state.md still exists. Dashboard no longer writes repo-derived cache files."
    });
  }

  const freshnessSource = normalizedState.evidence.history.length
    ? normalizedState.evidence.history
    : repoFacts.recentChangeSummaries;

  if (freshnessSource.length > 0) {
    const latestHistoryAt = freshnessSource
      .map((item) => new Date(item.createdAt || 0).getTime())
      .filter((value) => !Number.isNaN(value))
      .sort((left, right) => right - left)[0];

    const stateUpdatedAt = new Date(normalizedState.status.lastUpdatedAt || 0).getTime();
    if (latestHistoryAt && stateUpdatedAt && latestHistoryAt > stateUpdatedAt) {
      conflicts.push({
        level: "medium",
        type: "state_stale",
        message: "Recent execution evidence is newer than project_state.json lastUpdatedAt."
      });
    }
  }

  const currentState = buildCurrentState(projectRecord, normalizedState, repoFacts, conflicts, overviewSources);
  let cachePaths = buildCachePaths(projectRecord.id);

  if (options.persist !== false) {
    cachePaths = await persistCacheArtifacts(projectRecord, currentState);
  }

  return {
    project: {
      id: projectRecord.id,
      name: projectRecord.name,
      rootPath: projectRecord.rootPath,
      addedAt: projectRecord.addedAt
    },
    summary: currentState.summary,
    detail: currentState.detail,
    cache: cachePaths,
    currentState
  };
}

async function previewRebuildProfileMaintenance(projectRecord) {
  const preview = await previewOverviewSourceFiles(projectRecord);
  return {
    ...preview,
    _internalPlan: preview._internalPlan
  };
}

async function applyRebuildProfileMaintenance(projectRecord, options = {}) {
  const scan = await rebuildOverviewSourceFiles(projectRecord);
  const snapshot = await readProjectSnapshot(projectRecord, {
    persist: options.persist !== false
  });
  return {
    scan,
    snapshot
  };
}

function addMissingFileConflict(conflicts, fileFact, type, label, level = "low") {
  if (fileFact.exists) {
    return;
  }

  conflicts.push({
    level,
    type,
    message: `Missing source file: ${label}`
  });
}

async function collectRepoFacts(projectRoot) {
  const controlDir = path.join(projectRoot, CONTROL_DIR_NAME);
  const metaDir = path.join(controlDir, META_DIR_NAME);
  const runsDir = path.join(controlDir, RUNS_DIR_NAME);
  const agentsPath = path.join(projectRoot, AGENTS_FILE_NAME);
  const projectStatePath = path.join(controlDir, PROJECT_STATE_FILE_NAME);
  const projectBriefPath = path.join(controlDir, PROJECT_BRIEF_FILE_NAME);
  const moduleMapPath = path.join(controlDir, MODULE_MAP_FILE_NAME);
  const techStackPath = path.join(controlDir, TECH_STACK_FILE_NAME);
  const gameDesignPath = path.join(controlDir, GAME_DESIGN_FILE_NAME);
  const versionStatePath = path.join(controlDir, VERSION_STATE_FILE_NAME);
  const decisionLogPath = path.join(controlDir, DECISION_LOG_FILE_NAME);
  const projectConfigPath = path.join(metaDir, PROJECT_CONFIG_FILE_NAME);
  const watchManifestPath = path.join(metaDir, WATCH_MANIFEST_FILE_NAME);
  const legacyCurrentStatePath = path.join(controlDir, CURRENT_STATE_FILE_NAME);
  const legacyCurrentStateMdPath = path.join(controlDir, CURRENT_STATE_MD_FILE_NAME);
  const superpowersRootPath = path.join(projectRoot, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME);
  const superpowersSpecsPath = path.join(superpowersRootPath, SUPERPOWERS_SPECS_DIR_NAME);
  const superpowersPlansPath = path.join(superpowersRootPath, SUPERPOWERS_PLANS_DIR_NAME);
  const repoLocalSkillPaths = buildRepoLocalSkillPathMap(projectRoot);

  const [
    agentsText,
    agentsStat,
    projectStateStat,
    projectBriefStat,
    moduleMapStat,
    techStackStat,
    gameDesignStat,
    versionStateStat,
    decisionLogStat,
    projectConfigStat,
    watchManifestStat,
    legacyCurrentStateStat,
    legacyCurrentStateMdStat,
    superpowersRootStat,
    superpowersSpecsStat,
    superpowersPlansStat,
    handoffSkillStat,
    closeoutSkillStat,
    recoverySkillStat,
    repoChangeFallback
  ] = await Promise.all([
    readTextIfExists(agentsPath),
    safeStat(agentsPath),
    safeStat(projectStatePath),
    safeStat(projectBriefPath),
    safeStat(moduleMapPath),
    safeStat(techStackPath),
    safeStat(gameDesignPath),
    safeStat(versionStatePath),
    safeStat(decisionLogPath),
    safeStat(projectConfigPath),
    safeStat(watchManifestPath),
    safeStat(legacyCurrentStatePath),
    safeStat(legacyCurrentStateMdPath),
    safeStat(superpowersRootPath),
    safeStat(superpowersSpecsPath),
    safeStat(superpowersPlansPath),
    safeStat(repoLocalSkillPaths.handoff.path),
    safeStat(repoLocalSkillPaths.closeout.path),
    safeStat(repoLocalSkillPaths.recovery.path),
    collectRepoChangeFallback(projectRoot)
  ]);

  const historyEntries = await readHistoryEntries(projectStatePath);
  const runFiles = await validateRunFiles(runsDir, historyEntries);
  const recentChangeSummaries = runFiles
    .filter((item) => !item.missing)
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
    .slice(0, 2)
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      summary: item.summary,
      createdAt: item.createdAt,
      file: item.relativePath
    }));

  const watchedTargets = [
    buildWatchTarget(agentsPath, agentsStat),
    buildWatchTarget(projectStatePath, projectStateStat),
    buildWatchTarget(projectBriefPath, projectBriefStat),
    buildWatchTarget(moduleMapPath, moduleMapStat),
    buildWatchTarget(techStackPath, techStackStat),
    buildWatchTarget(gameDesignPath, gameDesignStat),
    buildWatchTarget(versionStatePath, versionStateStat),
    buildWatchTarget(decisionLogPath, decisionLogStat),
    buildWatchTarget(projectConfigPath, projectConfigStat),
    buildWatchTarget(watchManifestPath, watchManifestStat),
    buildWatchTarget(superpowersRootPath, superpowersRootStat),
    buildWatchTarget(superpowersSpecsPath, superpowersSpecsStat),
    buildWatchTarget(superpowersPlansPath, superpowersPlansStat),
    ...runFiles.map((item) => ({
      path: item.absolutePath,
      exists: !item.missing,
      mtime: item.mtime
    }))
  ];

  const latestSourceUpdateAt = watchedTargets
    .map((item) => item.mtime)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  return {
    agents: {
      path: agentsPath,
      exists: !!agentsText || !!agentsStat,
      hasRulesBlock: hasControlRulesBlock(agentsText || "")
    },
    files: {
      projectState: buildFileFact(projectStatePath, projectStateStat),
      projectBrief: buildFileFact(projectBriefPath, projectBriefStat),
      moduleMap: buildFileFact(moduleMapPath, moduleMapStat),
      techStack: buildFileFact(techStackPath, techStackStat),
      gameDesign: buildFileFact(gameDesignPath, gameDesignStat),
      versionState: buildFileFact(versionStatePath, versionStateStat),
      decisionLog: buildFileFact(decisionLogPath, decisionLogStat),
      projectConfig: buildFileFact(projectConfigPath, projectConfigStat),
      watchManifest: buildFileFact(watchManifestPath, watchManifestStat)
    },
    supplementalSources: {
      superpowersRoot: buildFileFact(superpowersRootPath, superpowersRootStat),
      superpowersSpecs: buildFileFact(superpowersSpecsPath, superpowersSpecsStat),
      superpowersPlans: buildFileFact(superpowersPlansPath, superpowersPlansStat)
    },
    legacyDerivedFiles: {
      currentState: buildFileFact(legacyCurrentStatePath, legacyCurrentStateStat),
      currentStateMarkdown: buildFileFact(legacyCurrentStateMdPath, legacyCurrentStateMdStat)
    },
    repoLocalSkills: {
      handoff: buildRepoLocalSkillFact(repoLocalSkillPaths.handoff, handoffSkillStat),
      closeout: buildRepoLocalSkillFact(repoLocalSkillPaths.closeout, closeoutSkillStat),
      recovery: buildRepoLocalSkillFact(repoLocalSkillPaths.recovery, recoverySkillStat)
    },
    repoChangeFallback,
    verifiedConsistency: null,
    recentChangeSummaries,
    runFiles,
    watchedTargets,
    latestSourceUpdateAt
  };
}

function buildRepoLocalSkillPathMap(projectRoot) {
  const entries = getRepoLocalSkillPaths(projectRoot);
  return {
    handoff: buildRepoLocalSkillPathEntry(entries, projectRoot, "codex-project-handoff"),
    closeout: buildRepoLocalSkillPathEntry(entries, projectRoot, "codex-task-closeout-writeback"),
    recovery: buildRepoLocalSkillPathEntry(entries, projectRoot, "codex-project-recovery-scan")
  };
}

function buildRepoLocalSkillPathEntry(entries, projectRoot, skillName) {
  const match = entries.find((item) => item.name === skillName);
  return {
    name: skillName,
    path: match ? match.rootDir : path.join(projectRoot, ".agents", "skills", skillName),
    files: match ? match.files : []
  };
}

function buildRepoLocalSkillFact(entry, stat) {
  return {
    name: entry.name,
    path: entry.path,
    exists: !!stat,
    files: entry.files
  };
}

async function readJsonWithRetry(filePath) {
  let lastError = null;
  for (let attempt = 0; attempt < READ_RETRY_COUNT; attempt += 1) {
    try {
      return await readJsonIfExists(filePath);
    } catch (error) {
      lastError = error;
      await sleep(READ_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

async function readHistoryEntries(projectStatePath) {
  try {
    const payload = await readJsonIfExists(projectStatePath);
    const entries = payload && payload.evidence && Array.isArray(payload.evidence.history)
      ? payload.evidence.history
      : [];
    return entries.filter((entry) => entry && entry.file);
  } catch {
    return [];
  }
}

async function validateRunFiles(runsDir, historyEntries) {
  const results = [];
  const runsDirStat = await safeStat(runsDir);

  for (const entry of historyEntries) {
    const normalizedRelativePath = normalizeRunHistoryPath(entry.file);
    const absolutePath = path.join(runsDir, normalizedRelativePath);
    const stat = await safeStat(absolutePath);
    const preview = stat
      ? await readRunPreview(absolutePath)
      : { title: entry.title || entry.id, summary: entry.summary || "", protocolIssues: [] };

    results.push({
      id: entry.id,
      type: entry.type,
      title: entry.title || preview.title,
      summary: entry.summary || preview.summary,
      relativePath: normalizedRelativePath,
      absolutePath,
      missing: !stat,
      mtime: formatTimestamp(stat && stat.mtime),
      createdAt: entry.createdAt || formatTimestamp(stat && stat.mtime),
      protocolIssues: preview.protocolIssues || []
    });
  }

  if (!runsDirStat) {
    return results;
  }

  const existingFiles = await fs.readdir(runsDir, { withFileTypes: true });
  for (const entry of existingFiles.filter((item) => item.isFile())) {
    const absolutePath = path.join(runsDir, entry.name);
    if (results.find((item) => item.absolutePath === absolutePath)) {
      continue;
    }

    const stat = await safeStat(absolutePath);
    const preview = await readRunPreview(absolutePath);
    results.push({
      id: entry.name,
      type: preview.type,
      title: preview.title,
      summary: preview.summary,
      relativePath: entry.name,
      absolutePath,
      missing: false,
      mtime: formatTimestamp(stat && stat.mtime),
      createdAt: formatTimestamp(stat && stat.mtime),
      protocolIssues: preview.protocolIssues || []
    });
  }

  return results;
}

function normalizeRunHistoryPath(filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) {
    return "";
  }

  const normalized = raw.replace(/\//g, path.sep);
  const marker = `${CONTROL_DIR_NAME}${path.sep}${RUNS_DIR_NAME}${path.sep}`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }

  const runsMarker = `${RUNS_DIR_NAME}${path.sep}`;
  const runsIndex = normalized.lastIndexOf(runsMarker);
  if (runsIndex >= 0) {
    return normalized.slice(runsIndex + runsMarker.length);
  }

  return path.basename(normalized);
}

async function readRunPreview(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (filePath.endsWith(".json")) {
      const parsed = JSON.parse(raw);
      return {
        type: parsed.type || inferEntryType(filePath),
        title: parsed.title || path.basename(filePath),
        summary: parsed.summary || truncate(raw),
        protocolIssues: collectRunProtocolIssues(parsed)
      };
    }

    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      type: inferEntryType(filePath),
      title: lines[0] || path.basename(filePath),
      summary: truncate(lines.slice(1).join(" ") || lines[0] || ""),
      protocolIssues: []
    };
  } catch {
    return {
      type: inferEntryType(filePath),
      title: path.basename(filePath),
      summary: "Unable to read summary",
      protocolIssues: ["schemaVersion", "runId", "type", "title", "summary", "createdAt", "deliverables"]
    };
  }
}

function collectRunProtocolIssues(parsed) {
  const issues = [];
  const requiredTopLevel = ["schemaVersion", "runId", "type", "title", "summary", "createdAt", "deliverables"];
  requiredTopLevel.forEach((key) => {
    if (!(key in parsed)) {
      issues.push(key);
    }
  });

  const deliverableKeys = [
    "change_summary",
    "changed_files",
    "executed_commands",
    "test_results",
    "open_issues",
    "residual_risks",
    "impact_scope",
    "test_suggestions",
    "documentation_updates",
    "escalation_or_rollback"
  ];

  if (!parsed.deliverables || typeof parsed.deliverables !== "object") {
    deliverableKeys.forEach((key) => issues.push(`deliverables.${key}`));
    return issues;
  }

  deliverableKeys.forEach((key) => {
    if (!(key in parsed.deliverables)) {
      issues.push(`deliverables.${key}`);
    }
  });

  return issues;
}

function inferEntryType(filePath) {
  return filePath.toLowerCase().includes("diff") ? "diff" : "run";
}

function truncate(value) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function buildFileFact(filePath, stat) {
  return {
    path: filePath,
    exists: !!stat,
    mtime: formatTimestamp(stat && stat.mtime)
  };
}

function buildWatchTarget(filePath, stat) {
  return {
    path: filePath,
    exists: !!stat,
    mtime: formatTimestamp(stat && stat.mtime)
  };
}

function buildProjectConfig(projectRecord) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const localSkills = getRepoLocalSkillPaths(projectRecord.rootPath);
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: projectRecord.id,
    name: projectRecord.name,
    rootPath: projectRecord.rootPath,
    controlDir,
    layers: {
      baseline: {
        projectBrief: path.join(controlDir, PROJECT_BRIEF_FILE_NAME),
        moduleMap: path.join(controlDir, MODULE_MAP_FILE_NAME),
        techStack: path.join(controlDir, TECH_STACK_FILE_NAME),
        gameDesign: path.join(controlDir, GAME_DESIGN_FILE_NAME),
        decisionLog: path.join(controlDir, DECISION_LOG_FILE_NAME)
      },
      versionControl: {
        versionState: path.join(controlDir, VERSION_STATE_FILE_NAME)
      },
      execution: {
        projectState: path.join(controlDir, PROJECT_STATE_FILE_NAME),
        runsDir: path.join(controlDir, RUNS_DIR_NAME)
      }
    },
    supplementalSources: {
      superpowersSpecsDir: path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_SPECS_DIR_NAME),
      superpowersPlansDir: path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_PLANS_DIR_NAME)
    },
    workflow: {
      useSuperpowers: Boolean(projectRecord.useSuperpowers)
    },
    localSkills: localSkills.map((item) => ({
      name: item.name,
      rootDir: item.rootDir,
      files: item.files
    })),
    boundary: {
      repoRole: "source-state-only",
      derivedArtifacts: "dashboard-local-cache-only"
    }
  };
}

function buildWatchManifest(projectRecord) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: "repo-source-only",
    watchTargets: [
      path.join(projectRecord.rootPath, AGENTS_FILE_NAME),
      path.join(controlDir, PROJECT_STATE_FILE_NAME),
      path.join(controlDir, PROJECT_BRIEF_FILE_NAME),
      path.join(controlDir, MODULE_MAP_FILE_NAME),
      path.join(controlDir, TECH_STACK_FILE_NAME),
      path.join(controlDir, GAME_DESIGN_FILE_NAME),
      path.join(controlDir, VERSION_STATE_FILE_NAME),
      path.join(controlDir, DECISION_LOG_FILE_NAME),
      path.join(controlDir, RUNS_DIR_NAME, "*.json"),
      path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_SPECS_DIR_NAME),
      path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_PLANS_DIR_NAME)
    ],
    note: "Steady-state aggregation only reads AGENTS.md, .codex-control/**, and optional docs/superpowers/specs|plans. Repo-local skills live under .agents/skills/** but are not watched as project state. Derived current_state artifacts are generated under the dashboard local cache."
  };
}

module.exports = {
  collectRepoFacts,
  ensureProjectScaffold,
  readProjectSnapshot,
  previewRebuildProfileMaintenance,
  applyRebuildProfileMaintenance
};
