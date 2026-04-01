const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TEST_DATA_DIR = path.join(ROOT, "tmp", "regression-data");
process.env.CODEX_CONTROL_DATA_DIR = TEST_DATA_DIR;
const { startServer, stopServer } = require("../src/server");
const { SCHEMA_VERSION } = require("../src/lib/constants");
const { createGitFixtureRepo, writeWorkingTreeChange } = require("./test-helpers/git-fixture");
const REGISTRY_FILE = path.join(TEST_DATA_DIR, "project-registry.json");
const WORKBENCH_FILE = path.join(TEST_DATA_DIR, "intake-workbench.json");
const CACHE_DIR = path.join(TEST_DATA_DIR, "cache");
const FIXTURE_ROOT = path.join(ROOT, "tmp", "regression-fixtures");
const TEST_PORT = 4315;
let serverUrl = `http://localhost:${TEST_PORT}`;

async function main() {
  assert.equal(process.platform, "win32", "该回归脚本只支持在 Windows 本机执行。");

  const createdProjectIds = new Set();
  try {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    await fs.writeFile(REGISTRY_FILE, '{\n  "schemaVersion": "1.0.0",\n  "projects": []\n}\n', "utf8");
    const server = await startServer(TEST_PORT);
    serverUrl = `http://localhost:${server.address().port}`;

    await testValidWindowsGitRepo(createdProjectIds);
    await testMissingPathFailure();
    await testNonGitDirectoryFailure();
    await testRefreshDoesNotWriteRepo(createdProjectIds);
    await testSuperpowersWritebackDrift(createdProjectIds);
    await testLegacyModuleBlueprintSchema(createdProjectIds);
    await testWorkbenchFlows(createdProjectIds);
    await testRemoveProjectCleansControlFiles();

    console.log("PASS regression.windows.js");
  } finally {
    await stopServer();

    for (const projectId of createdProjectIds) {
      await fs.rm(path.join(CACHE_DIR, projectId), { recursive: true, force: true });
    }

    await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });

  }
}

async function testValidWindowsGitRepo(createdProjectIds) {
  const repoPath = path.join(FIXTURE_ROOT, "valid-git-repo");
  await createGitFixtureRepo(repoPath);

  const payload = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: `  ${repoPath}  `,
      name: "Regression Valid Repo"
    }),
    expectStatus: 201
  });

  assert.equal(payload.ok, true, "合法 Windows git repo 应接入成功。");
  assert.equal(payload.diagnostic.success, true, "成功接入时诊断应通过。");
  assert.equal(payload.diagnostic.trimmedInput, repoPath);
  assert.equal(payload.diagnostic.normalizedPath, repoPath);
  assert.equal(payload.diagnostic.isWindowsNative, true);
  assert.equal(payload.project.rootPath, repoPath);
  const gitignoreText = await safeReadText(path.join(repoPath, ".gitignore"));
  assert.ok(gitignoreText?.includes(".codex-control/"), "attached project should ignore .codex-control in .gitignore");
  assert.ok(gitignoreText?.includes(".agents/skills/codex-project-handoff/"), "attached project should ignore repo-local handoff skill");
  assert.ok(gitignoreText?.includes(".agents/skills/codex-task-closeout-writeback/"), "attached project should ignore repo-local closeout skill");
  assert.ok(gitignoreText?.includes(".agents/skills/codex-project-recovery-scan/"), "attached project should ignore repo-local recovery skill");
  assert.ok(gitignoreText?.includes("CODEX-CONTROL-IGNORE"), "gitignore block should be marker-based for cleanup");
  assert.ok(await exists(path.join(repoPath, ".agents", "skills", "codex-project-handoff", "SKILL.md")), "handoff skill should be scaffolded");
  assert.ok(await exists(path.join(repoPath, ".agents", "skills", "codex-task-closeout-writeback", "SKILL.md")), "closeout skill should be scaffolded");
  assert.ok(await exists(path.join(repoPath, ".agents", "skills", "codex-project-recovery-scan", "SKILL.md")), "recovery skill should be scaffolded");
  createdProjectIds.add(payload.project.id);
}

async function testMissingPathFailure() {
  const missingPath = path.join(FIXTURE_ROOT, "missing-repo");

  const failure = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: missingPath
    }),
    expectStatus: 400
  });

  assert.equal(failure.ok, false, "不存在的路径必须失败。");
  assert.equal(failure.diagnostic.success, false);
  assert.equal(failure.diagnostic.failureReason, "路径不存在。");
  assert.ok(failure.message, "失败时必须返回前端可见 message。");
  assert.ok(Array.isArray(failure.diagnostic.checks), "失败时必须返回诊断链路。");
}

async function testNonGitDirectoryFailure() {
  const repoPath = path.join(FIXTURE_ROOT, "non-git-directory");
  await fs.mkdir(repoPath, { recursive: true });

  const failure = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath
    }),
    expectStatus: 400
  });

  assert.equal(failure.ok, false, "非 git 目录必须失败。");
  assert.equal(failure.diagnostic.success, false);
  assert.equal(failure.diagnostic.failureReason, "目标目录不是 git repo。");
  assert.ok(failure.message, "失败时必须返回前端可见 message。");
}

async function testRefreshDoesNotWriteRepo(createdProjectIds) {
  const repoPath = path.join(FIXTURE_ROOT, "readonly-refresh-repo");
  await createGitFixtureRepo(repoPath);

  const created = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath,
      name: "Regression Refresh Repo"
    }),
    expectStatus: 201
  });

  createdProjectIds.add(created.project.id);

  const repoFiles = {
    agents: path.join(repoPath, "AGENTS.md"),
    projectState: path.join(repoPath, ".codex-control", "project_state.json"),
    projectBrief: path.join(repoPath, ".codex-control", "project_brief.json"),
    moduleMap: path.join(repoPath, ".codex-control", "module_map.json"),
    techStack: path.join(repoPath, ".codex-control", "tech_stack.json"),
    versionState: path.join(repoPath, ".codex-control", "version_state.json"),
    decisionLog: path.join(repoPath, ".codex-control", "decision_log.json"),
    projectConfig: path.join(repoPath, ".codex-control", "meta", "project_config.json"),
    watchManifest: path.join(repoPath, ".codex-control", "meta", "watch_manifest.json")
  };

  const before = await collectStats(repoFiles);
  await delay(1100);

  const refreshed = await requestJson(`/api/projects/${created.project.id}/refresh`, {
    method: "POST"
  });

  const after = await collectStats(repoFiles);
  Object.keys(repoFiles).forEach((key) => {
    assert.equal(before[key], after[key], `日常聚合不应改写项目 repo 文件: ${key}`);
  });

  assert.ok(refreshed.cache.currentStateJsonPath.endsWith("current_state.json"));
  assert.ok(refreshed.cache.currentStateMarkdownPath.endsWith("current_state.md"));
  assert.ok(await exists(refreshed.cache.currentStateJsonPath), "派生缓存 JSON 应存在。");
  assert.ok(await exists(refreshed.cache.currentStateMarkdownPath), "派生缓存 Markdown 应存在。");
  assert.ok(refreshed.detail.visualizations, "current_state 派生层应包含 visualizations。");
  assert.ok(refreshed.detail.visualizations.byId.project_panorama, "应生成项目全景图。");
  assert.ok(refreshed.detail.visualizations.byId.module_structure, "应生成模块结构图。");
  assert.ok(refreshed.detail.visualizations.byId.version_roadmap, "应生成版本路线图。");
  assert.ok(refreshed.detail.visualizations.byId.current_slice_position, "应生成当前切片位置图。");
  assert.ok(Array.isArray(refreshed.summary.currentActionReasons), "current_action_state 应附带状态原因。");
  assert.ok(Array.isArray(refreshed.summary.secondaryConditions), "summary 应附带 secondaryConditions。");
  assert.ok(refreshed.detail.visualizations.byId.project_panorama.coverageLevel, "图应附带 coverageLevel。");
  assert.ok(refreshed.detail.visualizations.byId.project_panorama.freshness, "图应附带 freshness。");
  assert.ok(refreshed.detail.visualizations.byId.project_panorama.sourceMix, "图应附带 sourceMix。");
  assert.ok(refreshed.detail.repoFacts.repoChangeFallback, "refresh snapshot should include repo change fallback facts");
  assert.equal(typeof refreshed.detail.repoFacts.repoChangeFallback.workingTreeDirty, "boolean", "repo change fallback should expose dirtiness as a boolean");
  assert.ok(Array.isArray(refreshed.detail.repoFacts.repoChangeFallback.changedFiles), "repo change fallback should expose changed file summaries");
  assert.ok(refreshed.detail.repoFacts.repoChangeFallback.latestCommitSummary, "refresh snapshot should include latest commit summary");
  assert.ok(refreshed.detail.entityRefs.decisions, "decision_log 联动字段应存在。");
}

async function testSuperpowersWritebackDrift(createdProjectIds) {
  const repoPath = path.join(FIXTURE_ROOT, "superpowers-drift-repo");
  await createGitFixtureRepo(repoPath, {
    "README.md": "# Superpowers Drift Repo\n",
    "src/index.js": "module.exports = { version: 1 };\n"
  });
  await fs.mkdir(path.join(repoPath, "docs", "superpowers", "specs"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "docs", "superpowers", "plans"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "docs", "superpowers", "specs", "2026-04-01-feature.md"), "# Feature Spec\n\nSpec summary.\n", "utf8");
  await fs.writeFile(path.join(repoPath, "docs", "superpowers", "plans", "2026-04-01-feature.md"), "# Feature Plan\n\nPlan summary.\n", "utf8");

  const created = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath,
      name: "Superpowers Drift Repo",
      useSuperpowers: true
    }),
    expectStatus: 201
  });
  createdProjectIds.add(created.project.id);

  const controlDir = path.join(repoPath, ".codex-control");
  const runPath = path.join(controlDir, "runs", "2026-04-01-closeout.json");
  await fs.writeFile(runPath, JSON.stringify({
    id: "run-1",
    type: "run",
    title: "Formal closeout",
    summary: "Completed the baseline slice"
  }, null, 2), "utf8");

  const projectStatePath = path.join(controlDir, "project_state.json");
  const projectState = JSON.parse(await fs.readFile(projectStatePath, "utf8"));
  projectState.status.lastUpdatedAt = "2026-04-01T10:00:00.000Z";
  projectState.evidence.history = [
    {
      id: "run-1",
      type: "run",
      title: "Formal closeout",
      summary: "Completed the baseline slice",
      createdAt: "2026-04-01T10:00:00.000Z",
      file: "2026-04-01-closeout.json"
    }
  ];
  await fs.writeFile(projectStatePath, JSON.stringify(projectState, null, 2), "utf8");

  await writeWorkingTreeChange(repoPath, "src/index.js", "module.exports = { version: 2 };\n");

  const refreshed = await requestJson(`/api/projects/${created.project.id}/refresh`, {
    method: "POST"
  });

  assert.equal(refreshed.summary.superpowersWorkflowState, "repo_changed_without_closeout");
  assert.equal(refreshed.summary.latestExecutionEvidenceSource, "repo_fallback");
  assert.equal(refreshed.summary.hasUnwrittenRepoChanges, true);
  assert.equal(refreshed.summary.writebackDrift, "repo_ahead_of_writeback");
  assert.equal(refreshed.summary.linkedSpecTitle, "Feature Spec");
  assert.equal(refreshed.summary.linkedPlanTitle, "Feature Plan");
  assert.ok(
    refreshed.detail.pendingReview.items.some((item) => item.id === "superpowers-writeback-drift"),
    "pending review should flag missing closeout writeback"
  );
  assert.equal(refreshed.detail.views.instructionCenter.primaryType, "同步文档");
  assert.equal(refreshed.detail.views.recentChanges.entries[0].type, "repo_change_inferred");
}

async function testWorkbenchFlows(createdProjectIds) {
  const repoPath = path.join(FIXTURE_ROOT, "workbench-repo");
  await createGitFixtureRepo(repoPath);

  const draftSaved = await requestJson("/api/workbench/new-project/draft", {
    method: "POST",
    body: JSON.stringify({
      projectPath: repoPath,
      projectName: "Workbench Draft Repo",
      oneLineDefinition: "A workbench draft",
      finalGoal: "Validate the intake flow",
      currentVersionTarget: "Create the first documented baseline",
      currentVersionNonScope: "No business implementation yet",
      projectType: "tool",
      targetUsers: "internal team",
      targetExperience: "fast setup",
      techPreferences: "Node.js",
      techConstraints: "Keep static frontend"
    })
  });
  assert.ok(draftSaved.prompts.newProject.gptDraftPrompt, "new project draft should generate GPT prompt");

  const preview = await requestJson("/api/workbench/new-project/writeback/preview", {
    method: "POST",
    body: JSON.stringify({
      projectPath: repoPath,
      projectName: "Workbench Draft Repo",
      oneLineDefinition: "A workbench draft",
      finalGoal: "Validate the intake flow",
      currentVersionTarget: "Create the first documented baseline",
      currentVersionNonScope: "No business implementation yet",
      projectType: "tool",
      targetUsers: "internal team",
      targetExperience: "fast setup",
      techPreferences: "Node.js",
      techConstraints: "Keep static frontend"
    })
  });
  assert.equal(preview.preview.actionBoundary, "explicit_maintenance_write");
  assert.ok(Array.isArray(preview.preview.files), "new project preview should include file list");

  const applied = await requestJson("/api/workbench/new-project/writeback/apply", {
    method: "POST",
    body: JSON.stringify({
      projectPath: repoPath,
      projectName: "Workbench Draft Repo",
      oneLineDefinition: "A workbench draft",
      finalGoal: "Validate the intake flow",
      currentVersionTarget: "Create the first documented baseline",
      currentVersionNonScope: "No business implementation yet",
      projectType: "tool",
      targetUsers: "internal team",
      targetExperience: "fast setup",
      techPreferences: "Node.js",
      techConstraints: "Keep static frontend"
    })
  });
  createdProjectIds.add(applied.project.id);
  assert.ok(Array.isArray(applied.scan.updatedFiles), "new project apply should return updated files");
  assert.equal(applied.scan.workflowState, "pending_codex_scan");

  const recovery = await requestJson("/api/workbench/recovery/attach", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath,
      name: "Workbench Draft Repo",
      coarseJudgment: "Existing structure is present but modules are incomplete",
      keyQuestions: ["What is the real current slice?", "Which gaps need GPT clarification?"]
    })
  });
  assert.ok(recovery.recovery.prompts.codexScanPrompt, "recovery attach should return Codex prompt");
  assert.ok(Array.isArray(recovery.recovery.provisionalSummary.unresolved), "recovery attach should expose unresolved items");
}

async function testLegacyModuleBlueprintSchema(createdProjectIds) {
  const repoPath = path.join(FIXTURE_ROOT, "legacy-module-blueprint-repo");
  await createGitFixtureRepo(repoPath);

  const created = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath,
      name: "Legacy Module Blueprint Repo"
    }),
    expectStatus: 201
  });
  createdProjectIds.add(created.project.id);

  const controlDir = path.join(repoPath, ".codex-control");
  await fs.writeFile(path.join(controlDir, "module_map.json"), JSON.stringify({
    schemaVersion: "1.2.0",
    kind: "module_map",
    modules: [
      {
        moduleId: "module-app-shell",
        moduleName: "App Shell",
        summary: "Host runtime shell",
        implementationStatus: "not_started",
        source: "derived_from_confirmed_intake",
        source_ref: "current_version_target",
        confidence: "medium",
        last_updated_at: "2026-03-29T01:54:08.054Z"
      },
      {
        moduleId: "module-gameplay-core",
        moduleName: "Gameplay Core",
        responsibilities: ["drive loop", "update rules"],
        implementationStatus: "not_started",
        source: "derived_from_confirmed_intake",
        source_ref: "current_version_target",
        confidence: "high",
        last_updated_at: "2026-03-29T01:54:08.054Z"
      }
    ],
    relations: [
      {
        from: "module-app-shell",
        to: "module-gameplay-core",
        type: "hosts"
      }
    ],
    currentWorkPackageModule: {
      moduleId: "module-gameplay-core",
      moduleName: "Gameplay Core",
      relation: "current work package belongs here",
      source: "derived_from_confirmed_intake",
      confidence: "medium",
      last_updated_at: "2026-03-29T01:54:08.054Z",
      sourceKind: "derived"
    },
    knownFacts: [],
    declaredItems: [],
    supplementalItems: [],
    needsConfirmation: []
  }, null, 2), "utf8");

  await fs.writeFile(path.join(controlDir, "version_state.json"), JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    kind: "version_state",
    version_id: "v0-core",
    work_package_id: "wp-core",
    versionTarget: {
      value: "Build the first playable core loop",
      source: "manual",
      sourceKind: "declared"
    },
    versionNonScope: [],
    definitionOfDone: [],
    keyRisks: [],
    blockers: [],
    verificationSummary: {
      value: "Initial verification summary",
      source: "manual",
      sourceKind: "declared"
    },
    verificationMatrix: [],
    goNoGoStatus: {
      value: "not_ready",
      source: "manual",
      sourceKind: "declared"
    },
    currentStage: {
      value: "planning",
      source: "manual",
      sourceKind: "declared"
    },
    currentWorkPackage: {
      value: "classic loop slice",
      source: "manual",
      sourceKind: "declared"
    },
    currentSliceModule: {
      moduleId: "module-gameplay-core",
      moduleName: "Gameplay Core",
      relation: "mapped from blueprint",
      source: "manual",
      sourceKind: "derived"
    },
    knownFacts: [],
    declaredItems: [],
    supplementalItems: [],
    needsConfirmation: []
  }, null, 2), "utf8");

  const refreshed = await requestJson(`/api/projects/${created.project.id}/refresh`, {
    method: "POST"
  });

  assert.equal(refreshed.summary.moduleCount, 2, "legacy module blueprint schema should still hydrate modules");
  assert.deepEqual(
    refreshed.summary.moduleNames,
    ["App Shell", "Gameplay Core"],
    "module names should come from moduleName fields"
  );
  assert.equal(refreshed.detail.views.modules.modules[0].name, "App Shell");
  assert.equal(refreshed.detail.views.modules.modules[1].responsibility, "drive loop / update rules");
  assert.ok(
    refreshed.detail.visualizations.byId.module_structure.nodes.some((node) => node.label === "Gameplay Core"),
    "module structure diagram should use hydrated module nodes instead of unknown fallback"
  );
}

async function testRemoveProjectCleansControlFiles() {
  const repoPath = path.join(FIXTURE_ROOT, "remove-project-repo");
  await createGitFixtureRepo(repoPath);
  const preservedAgentsText = [
    "# Existing Rules",
    "",
    "Keep this section."
  ].join("\n");
  await fs.writeFile(path.join(repoPath, "AGENTS.md"), `${preservedAgentsText}\n`, "utf8");

  const created = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath,
      name: "Regression Remove Repo"
    }),
    expectStatus: 201
  });

  const controlDir = path.join(repoPath, ".codex-control");
  const skillsDir = path.join(repoPath, ".agents", "skills");
  const agentsPath = path.join(repoPath, "AGENTS.md");
  const gitignorePath = path.join(repoPath, ".gitignore");
  const cacheDir = path.join(CACHE_DIR, created.project.id);

  assert.ok(await exists(controlDir), ".codex-control should exist after attach");
  assert.ok(await exists(skillsDir), ".agents/skills should exist after attach");
  assert.ok((await safeReadText(agentsPath)).includes("CODEX-CONTROL-RULES"), "AGENTS block should be present before removal");
  assert.ok((await safeReadText(gitignorePath)).includes("CODEX-CONTROL-IGNORE"), "gitignore control block should exist before removal");
  assert.ok(await exists(cacheDir), "cache dir should exist before removal");

  const removed = await requestJson(`/api/projects/${created.project.id}`, {
    method: "DELETE"
  });

  assert.equal(removed.ok, true, "remove project should succeed");
  assert.equal(removed.actionBoundary, "explicit_maintenance_write");
  assert.equal(await exists(controlDir), false, ".codex-control should be deleted");
  assert.equal(await exists(skillsDir), false, ".agents/skills should be deleted when only dashboard-managed skills existed");
  assert.equal(await exists(cacheDir), false, "local cache dir should be deleted");
  assert.ok(
    !removed.projectsPayload.projects.some((item) => item.id === created.project.id),
    "removed project should disappear from registry payload"
  );

  const agentsAfter = await safeReadText(agentsPath);
  assert.ok(agentsAfter, "AGENTS.md should still exist when non-control content remains");
  assert.ok(agentsAfter.includes("Keep this section."), "non-control AGENTS content should be preserved");
  assert.ok(!agentsAfter.includes("CODEX-CONTROL-RULES"), "control rules block should be removed from AGENTS");
  const gitignoreAfter = await safeReadText(gitignorePath);
  assert.ok(gitignoreAfter === null || !gitignoreAfter.includes("CODEX-CONTROL-IGNORE"), "gitignore control block should be removed");
  assert.ok(
    removed.removed.removedRepoArtifacts.some((item) => item.action === "control_dir_deleted"),
    "response should report control dir cleanup"
  );
}

async function requestJson(route, options = {}) {
  const expectStatus = options.expectStatus || 200;
  const response = await fetch(`${serverUrl}${route}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json"
    },
    body: options.body
  });

  const payload = await response.json();
  assert.equal(response.status, expectStatus, `Unexpected status for ${route}`);
  return payload;
}

async function collectStats(fileMap) {
  const result = {};
  for (const [key, filePath] of Object.entries(fileMap)) {
    result[key] = await statIso(filePath);
  }
  return result;
}

async function statIso(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
