# Superpowers Monitored Project Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard understand monitored Superpowers repos through formal closeout writeback first and repo-visible fallback evidence second, then surface that distinction in existing summary/detail views.

**Architecture:** Add one lightweight backend collector for git/repo fallback signals, one workflow-state derivation helper that links runs/specs/plans/skills, and one state-to-view adapter that exposes those results without expanding the existing monolithic files further. Because `src/lib/project-overview.js`, `src/lib/state-generator.js`, and `public/app-views-core.js` are already oversized, new logic must live in focused helper modules and the existing files should only receive narrow wiring edits.

**Tech Stack:** Node.js CommonJS backend modules, built-in `child_process`/`fs`/`path`, vanilla ES module frontend, `node:test` for focused unit coverage, Windows-native regression and smoke scripts.

---

## File Structure

- Create: `scripts/test-helpers/git-fixture.js`
  Responsibility: build real temporary git repos for tests, seed tracked files, create committed changes, and create uncommitted dirty working tree changes.
- Create: `src/lib/repo-change-fallback.js`
  Responsibility: collect lightweight repo-visible fallback evidence such as latest commit, dirty working tree, changed-file summaries, and latest repo-visible update timestamps.
- Create: `src/lib/repo-change-fallback.test.js`
  Responsibility: unit-test git fallback collection on clean and dirty fixture repos.
- Modify: `src/lib/project-reader.js`
  Responsibility: include repo-local skill presence and repo-change fallback facts in `repoFacts`, then pass those facts into overview aggregation.
- Create: `src/lib/superpowers-workflow-state.js`
  Responsibility: derive the structured Superpowers workflow state from formal runs, specs/plans, repo-local skills, and fallback repo-change evidence.
- Create: `src/lib/superpowers-workflow-state.test.js`
  Responsibility: unit-test workflow-state classification for `docs_only`, `planned_not_executed`, `executed_and_written_back`, `repo_changed_without_closeout`, and conservative fallback cases.
- Create: `src/lib/state-generator-superpowers.js`
  Responsibility: convert workflow-state results into summary fields, recent-change entries, pending-review items, instruction guidance, status-source rows, and markdown-ready sections.
- Modify: `src/lib/project-overview.js`
  Responsibility: attach the workflow-state model to `overviewSources.superpowers` and emit drift conflicts without changing unrelated merge logic.
- Modify: `src/lib/state-generator.js`
  Responsibility: expose the new Superpowers aggregation fields in summary/detail/views/markdown while delegating the new logic to `state-generator-superpowers.js`.
- Create: `public/app-views-superpowers.js`
  Responsibility: render reusable UI fragments that explain formal vs inferred Superpowers evidence inside existing views.
- Modify: `public/app-views-core.js`
  Responsibility: import the new frontend helper and insert compact workflow/evidence/source callouts into the overview, instruction-center, recent-changes, and status-sources views.
- Modify: `scripts/regression.windows.js`
  Responsibility: switch fixture setup to real git repos and add an end-to-end regression for stale writeback versus repo-visible drift.
- Modify: `scripts/frontend.smoke.js`
  Responsibility: switch fixture setup to the shared real-git helper so smoke tests exercise the same repo shape as regression tests.
- Modify: `docs/superpowers/repo-mechanism-map.md`
  Responsibility: document the new monitored-project aggregation path so later work can reuse the same mental model.

## Data Contract To Introduce

The new summary fields surfaced from aggregation must use these exact names so backend, markdown, and frontend stay aligned:

- `superpowersWorkflowState`
- `latestExecutionEvidenceSource`
- `latestExecutionEvidenceLabel`
- `hasUnwrittenRepoChanges`
- `writebackDrift`
- `linkedSpecTitle`
- `linkedPlanTitle`
- `fallbackRepoChangeSummary`

The workflow helper should use these stable state values:

- `not_used`
- `docs_only`
- `planned_not_executed`
- `executed_and_written_back`
- `repo_changed_without_closeout`
- `insufficient_evidence`

The evidence source helper should use these stable source values:

- `none`
- `formal_run`
- `repo_fallback`

## Test Strategy

- Unit tests should cover the new pure helpers first:
  - `node --test src/lib/repo-change-fallback.test.js`
  - `node --test src/lib/superpowers-workflow-state.test.js`
- End-to-end regression should prove that a monitored Superpowers repo with stale formal writeback is shown as `repo_changed_without_closeout`.
- All tests must continue using isolated temp directories and must not touch the real `data/` directory.

### Task 1: Build Real Git Fixtures And Repo-Change Fallback Collection

**Files:**
- Create: `scripts/test-helpers/git-fixture.js`
- Create: `src/lib/repo-change-fallback.js`
- Create: `src/lib/repo-change-fallback.test.js`

- [ ] **Step 1: Create the shared real-git fixture helper**

```js
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || "").trim();
}

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
  }
}

async function createGitFixtureRepo(repoPath, files = { "README.md": "# Fixture Repo\n" }) {
  await fs.mkdir(repoPath, { recursive: true });
  runGit(["init"], repoPath);
  runGit(["config", "user.name", "Codex Fixture"], repoPath);
  runGit(["config", "user.email", "fixture@example.com"], repoPath);
  await writeFiles(repoPath, files);
  runGit(["add", "-A"], repoPath);
  runGit(["commit", "-m", "chore: seed fixture"], repoPath);
}

async function commitFileChange(repoPath, relativePath, content, message) {
  await writeFiles(repoPath, { [relativePath]: content });
  runGit(["add", relativePath], repoPath);
  runGit(["commit", "-m", message], repoPath);
}

async function writeWorkingTreeChange(repoPath, relativePath, content) {
  await writeFiles(repoPath, { [relativePath]: content });
}

module.exports = {
  createGitFixtureRepo,
  commitFileChange,
  writeWorkingTreeChange
};
```

- [ ] **Step 2: Write the failing unit tests for clean and dirty repo fallback evidence**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createGitFixtureRepo, writeWorkingTreeChange } = require("../../scripts/test-helpers/git-fixture");
const { collectRepoChangeFallback } = require("./repo-change-fallback");

test("collectRepoChangeFallback returns latest commit metadata for a clean repo", async (t) => {
  const repoPath = path.join(os.tmpdir(), `repo-fallback-clean-${Date.now()}`);
  t.after(() => fs.rm(repoPath, { recursive: true, force: true }));
  await createGitFixtureRepo(repoPath, {
    "README.md": "# Clean Repo\n",
    "src/index.js": "module.exports = { clean: true };\n"
  });

  const result = await collectRepoChangeFallback(repoPath);

  assert.equal(result.workingTreeDirty, false);
  assert.equal(result.hasRepoVisibleChanges, false);
  assert.match(result.latestCommitSummary, /seed fixture/i);
  assert.ok(result.latestCommitHash);
  assert.equal(result.changedFiles.length, 0);
  assert.ok(result.latestRepoVisibleUpdateAt);
});

test("collectRepoChangeFallback reports dirty tracked files as inferred repo changes", async (t) => {
  const repoPath = path.join(os.tmpdir(), `repo-fallback-dirty-${Date.now()}`);
  t.after(() => fs.rm(repoPath, { recursive: true, force: true }));
  await createGitFixtureRepo(repoPath, {
    "README.md": "# Dirty Repo\n",
    "src/index.js": "module.exports = { version: 1 };\n"
  });
  await writeWorkingTreeChange(repoPath, "src/index.js", "module.exports = { version: 2 };\n");

  const result = await collectRepoChangeFallback(repoPath);

  assert.equal(result.workingTreeDirty, true);
  assert.equal(result.hasRepoVisibleChanges, true);
  assert.deepEqual(result.changedFiles.map((item) => item.path), ["src/index.js"]);
  assert.match(result.fallbackRepoChangeSummary, /working tree/i);
  assert.ok(result.latestRepoVisibleUpdateAt);
});
```

- [ ] **Step 3: Run the new unit test to confirm it fails before implementation**

Run: `node --test src/lib/repo-change-fallback.test.js`
Expected:
- The run fails because `src/lib/repo-change-fallback.js` does not exist yet or does not export `collectRepoChangeFallback`.

- [ ] **Step 4: Implement the lightweight git fallback collector**

```js
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { safeStat } = require("./fs-utils");

const execFileAsync = promisify(execFile);
const MAX_CHANGED_FILES = 8;

async function collectRepoChangeFallback(projectRoot) {
  const gitDir = await safeStat(path.join(projectRoot, ".git"));
  if (!gitDir) {
    return buildEmptyFallback();
  }

  const [latestCommit, statusEntries] = await Promise.all([
    readLatestCommit(projectRoot),
    readStatusEntries(projectRoot)
  ]);
  const changedFiles = await hydrateChangedFiles(projectRoot, statusEntries);
  const latestRepoVisibleUpdateAt = pickLatestTimestamp([
    latestCommit?.createdAt || null,
    ...changedFiles.map((item) => item.updatedAt)
  ]);
  const hasRepoVisibleChanges = Boolean(changedFiles.length);

  return {
    latestCommitHash: latestCommit?.hash || null,
    latestCommitSummary: latestCommit?.summary || null,
    latestCommitTimestamp: latestCommit?.createdAt || null,
    workingTreeDirty: hasRepoVisibleChanges,
    changedFiles,
    latestRepoVisibleUpdateAt,
    hasRepoVisibleChanges,
    fallbackRepoChangeSummary: buildFallbackSummary(latestCommit, changedFiles)
  };
}

module.exports = {
  collectRepoChangeFallback
};
```

- [ ] **Step 5: Run the repo-change fallback unit test and confirm it passes**

Run: `node --test src/lib/repo-change-fallback.test.js`
Expected:
- `ok` for both tests
- overall result `# pass 2`
- no failures

- [ ] **Step 6: Commit the fixture helper and fallback collector**

```bash
git add scripts/test-helpers/git-fixture.js src/lib/repo-change-fallback.js src/lib/repo-change-fallback.test.js
git commit -m "feat: add repo change fallback collector"
```

### Task 2: Integrate Repo Fallback Facts Into Project Snapshots

**Files:**
- Modify: `src/lib/project-reader.js`
- Modify: `scripts/regression.windows.js`
- Modify: `scripts/frontend.smoke.js`
- Create: `scripts/test-helpers/git-fixture.js`

- [ ] **Step 1: Update the regression and smoke scripts to use real git fixtures and assert fallback facts exist**

```js
const { createGitFixtureRepo } = require("./test-helpers/git-fixture");

async function testRefreshDoesNotWriteRepo(createdProjectIds) {
  const repoPath = path.join(FIXTURE_ROOT, "readonly-refresh-repo");
  await createGitFixtureRepo(repoPath, {
    "README.md": "# Refresh Repo\n",
    "src/index.js": "module.exports = { ready: true };\n"
  });
  const created = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath,
      name: "Regression Refresh Repo"
    }),
    expectStatus: 201
  });
  createdProjectIds.add(created.project.id);
  const refreshed = await requestJson(`/api/projects/${created.project.id}/refresh`, {
    method: "POST"
  });

  assert.ok(refreshed.detail.repoFacts.repoChangeFallback, "refresh should expose repo fallback facts");
  assert.equal(refreshed.detail.repoFacts.repoChangeFallback.workingTreeDirty, false);
  assert.ok(refreshed.detail.repoFacts.repoChangeFallback.latestCommitSummary, "latest commit summary should be exposed");
}
```

```js
const { createGitFixtureRepo } = require("./test-helpers/git-fixture");

async function createFakeGitRepo(repoPath) {
  await createGitFixtureRepo(repoPath, {
    "README.md": "# Smoke Repo\n",
    "src/index.js": "module.exports = { smoke: true };\n"
  });
}
```

- [ ] **Step 2: Run the Windows regression script and confirm the new assertions fail before wiring**

Run: `npm.cmd run test:regression:windows`
Expected:
- The run fails because `refreshed.detail.repoFacts.repoChangeFallback` is still missing from the snapshot payload.

- [ ] **Step 3: Wire repo-local skill facts and repo fallback facts into `collectRepoFacts()` and pass them into overview aggregation**

```js
const {
  collectRepoChangeFallback
} = require("./repo-change-fallback");

async function collectRepoFacts(projectRoot) {
  const repoLocalSkillPaths = getRepoLocalSkillPaths(projectRoot);
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
    repoChangeFallback,
    handoffStat,
    closeoutStat,
    recoveryStat
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
    collectRepoChangeFallback(projectRoot),
    safeStat(repoLocalSkillPaths.handoff),
    safeStat(repoLocalSkillPaths.closeout),
    safeStat(repoLocalSkillPaths.recovery)
  ]);

  return {
    repoLocalSkills: {
      handoff: { path: repoLocalSkillPaths.handoff, exists: !!handoffStat },
      closeout: { path: repoLocalSkillPaths.closeout, exists: !!closeoutStat },
      recovery: { path: repoLocalSkillPaths.recovery, exists: !!recoveryStat }
    },
    repoChangeFallback,
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
    latestSourceUpdateAt
  };
}

async function readProjectSnapshot(projectRecord, options = {}) {
  const repoFacts = await collectRepoFacts(projectRoot);
  const overviewSources = await readOverviewSources(projectRecord, normalizedState, repoFacts);
  const currentState = buildCurrentState(projectRecord, normalizedState, repoFacts, conflicts, overviewSources);
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
```

- [ ] **Step 4: Re-run regression and smoke to verify the snapshot payload now includes real-git fallback evidence**

Run: `npm.cmd run test:regression:windows`
Expected:
- `PASS regression.windows.js`

Run: `npm.cmd run test:smoke:frontend`
Expected:
- `PASS frontend.smoke.js`

- [ ] **Step 5: Commit the snapshot wiring**

```bash
git add src/lib/project-reader.js scripts/regression.windows.js scripts/frontend.smoke.js
git commit -m "feat: include repo fallback facts in snapshots"
```

### Task 3: Derive Structured Superpowers Workflow State

**Files:**
- Create: `src/lib/superpowers-workflow-state.js`
- Create: `src/lib/superpowers-workflow-state.test.js`
- Modify: `src/lib/project-overview.js`

- [ ] **Step 1: Write the failing workflow-state unit tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSuperpowersWorkflowState } = require("./superpowers-workflow-state");

function createBaseInput(overrides = {}) {
  return {
    superpowers: {
      status: "detected",
      hasSpecs: true,
      hasPlans: true,
      latestUpdatedAt: "2026-04-01T09:00:00.000Z",
      evidence: {
        specs: [{ file: "2026-04-01-feature.md", title: "Feature Spec", summary: "Spec summary", updatedAt: "2026-04-01T08:00:00.000Z" }],
        plans: [{ file: "2026-04-01-feature.md", title: "Feature Plan", summary: "Plan summary", updatedAt: "2026-04-01T09:00:00.000Z" }]
      }
    },
    repoFacts: {
      runFiles: [],
      repoLocalSkills: {
        handoff: { exists: true },
        closeout: { exists: true },
        recovery: { exists: true }
      },
      repoChangeFallback: {
        latestCommitHash: null,
        latestCommitSummary: null,
        latestCommitTimestamp: null,
        workingTreeDirty: false,
        changedFiles: [],
        latestRepoVisibleUpdateAt: null,
        hasRepoVisibleChanges: false,
        fallbackRepoChangeSummary: "No repo-visible fallback evidence is available."
      }
    },
    projectState: {
      status: {
        currentWorkPackage: { value: "Current slice" },
        lastUpdatedAt: "2026-04-01T09:00:00.000Z"
      }
    },
    ...overrides
  };
}

test("buildSuperpowersWorkflowState returns planned_not_executed when specs and plans exist without runs", () => {
  const result = buildSuperpowersWorkflowState(createBaseInput());
  assert.equal(result.workflowState, "planned_not_executed");
  assert.equal(result.latestExecutionEvidenceSource, "none");
  assert.equal(result.linkedSpecTitle, "Feature Spec");
  assert.equal(result.linkedPlanTitle, "Feature Plan");
});

test("buildSuperpowersWorkflowState returns executed_and_written_back when a formal run exists", () => {
  const result = buildSuperpowersWorkflowState(createBaseInput({
    repoFacts: {
      ...createBaseInput().repoFacts,
      runFiles: [
        {
          id: "run-1",
          type: "run",
          title: "Formal closeout",
          summary: "Completed the current slice",
          createdAt: "2026-04-01T10:00:00.000Z",
          missing: false,
          protocolIssues: []
        }
      ]
    }
  }));
  assert.equal(result.workflowState, "executed_and_written_back");
  assert.equal(result.latestExecutionEvidenceSource, "formal_run");
  assert.equal(result.hasUnwrittenRepoChanges, false);
});

test("buildSuperpowersWorkflowState returns repo_changed_without_closeout when repo drift is newer than the latest formal run", () => {
  const result = buildSuperpowersWorkflowState(createBaseInput({
    repoFacts: {
      ...createBaseInput().repoFacts,
      runFiles: [
        {
          id: "run-1",
          type: "run",
          title: "Formal closeout",
          summary: "Completed the current slice",
          createdAt: "2026-04-01T10:00:00.000Z",
          missing: false,
          protocolIssues: []
        }
      ],
      repoChangeFallback: {
        latestCommitHash: "abc123",
        latestCommitSummary: "feat: continue current slice",
        latestCommitTimestamp: "2026-04-01T11:00:00.000Z",
        workingTreeDirty: true,
        changedFiles: [{ path: "src/index.js", status: "M", updatedAt: "2026-04-01T11:00:00.000Z" }],
        latestRepoVisibleUpdateAt: "2026-04-01T11:00:00.000Z",
        hasRepoVisibleChanges: true,
        fallbackRepoChangeSummary: "Working tree has 1 repo-visible change(s) after the last formal writeback."
      }
    }
  }));
  assert.equal(result.workflowState, "repo_changed_without_closeout");
  assert.equal(result.latestExecutionEvidenceSource, "repo_fallback");
  assert.equal(result.writebackDrift, "repo_ahead_of_writeback");
  assert.equal(result.hasUnwrittenRepoChanges, true);
});
```

- [ ] **Step 2: Run the workflow-state unit test and confirm it fails before implementation**

Run: `node --test src/lib/superpowers-workflow-state.test.js`
Expected:
- The run fails because `src/lib/superpowers-workflow-state.js` does not exist yet or does not export `buildSuperpowersWorkflowState`.

- [ ] **Step 3: Implement the workflow-state helper and attach it inside `readOverviewSources()`**

```js
function buildSuperpowersWorkflowState({ superpowers, repoFacts, projectState }) {
  if (!superpowers || superpowers.status === "not_used") {
    return buildEmptyWorkflowState();
  }

  const latestFormalRun = pickLatestFormalRun(repoFacts.runFiles || []);
  const latestSpec = pickLatestDoc(superpowers.evidence?.specs || []);
  const latestPlan = pickLatestDoc(superpowers.evidence?.plans || []);
  const repoFallback = repoFacts.repoChangeFallback || buildEmptyRepoFallback();
  const repoFallbackIsNewer = Boolean(
    repoFallback.hasRepoVisibleChanges
      && compareIso(repoFallback.latestRepoVisibleUpdateAt, latestFormalRun?.createdAt) > 0
  );

  let workflowState = "insufficient_evidence";
  if (superpowers.hasSpecs && !superpowers.hasPlans && !latestFormalRun) {
    workflowState = "docs_only";
  } else if (superpowers.hasPlans && !latestFormalRun && !repoFallback.hasRepoVisibleChanges) {
    workflowState = "planned_not_executed";
  } else if (repoFallbackIsNewer || (!latestFormalRun && repoFallback.hasRepoVisibleChanges)) {
    workflowState = "repo_changed_without_closeout";
  } else if (latestFormalRun) {
    workflowState = "executed_and_written_back";
  }

  return {
    workflowState,
    latestExecutionEvidenceSource: repoFallbackIsNewer || (!latestFormalRun && repoFallback.hasRepoVisibleChanges)
      ? "repo_fallback"
      : (latestFormalRun ? "formal_run" : "none"),
    latestExecutionEvidenceLabel: repoFallbackIsNewer || (!latestFormalRun && repoFallback.hasRepoVisibleChanges)
      ? (repoFallback.latestCommitSummary || repoFallback.fallbackRepoChangeSummary)
      : (latestFormalRun ? latestFormalRun.title : "No recent execution evidence"),
    hasUnwrittenRepoChanges: repoFallbackIsNewer || (!latestFormalRun && repoFallback.hasRepoVisibleChanges),
    writebackDrift: repoFallbackIsNewer
      ? "repo_ahead_of_writeback"
      : (latestFormalRun ? "aligned" : (repoFallback.hasRepoVisibleChanges ? "missing_formal_writeback" : "insufficient_evidence")),
    linkedSpecTitle: latestSpec?.title || null,
    linkedPlanTitle: latestPlan?.title || null,
    fallbackRepoChangeSummary: repoFallback.fallbackRepoChangeSummary,
    latestFormalRun,
    repoLocalSkills: repoFacts.repoLocalSkills || {}
  };
}
```

```js
const {
  buildSuperpowersWorkflowState
} = require("./superpowers-workflow-state");

async function readOverviewSources(projectRecord, projectState, repoFacts = null) {
  const [rawProjectBrief, rawModuleMap, rawTechStack, rawGameDesign, rawVersionState, rawDecisionLog, scanResult] = await Promise.all([
    readJsonIfExists(filePaths.projectBrief),
    readJsonIfExists(filePaths.moduleMap),
    readJsonIfExists(filePaths.techStack),
    readJsonIfExists(filePaths.gameDesign),
    readJsonIfExists(filePaths.versionState),
    readJsonIfExists(filePaths.decisionLog),
    scanProjectLayers(projectRecord.rootPath, projectRecord.name)
  ]);
  const superpowersRaw = scanResult.superpowers;
  const superpowers = {
    ...superpowersRaw,
    workflow: buildSuperpowersWorkflowState({
      superpowers: superpowersRaw,
      repoFacts: repoFacts || { runFiles: [], repoLocalSkills: {}, repoChangeFallback: null },
      projectState
    })
  };

  if (superpowers.workflow.hasUnwrittenRepoChanges) {
    conflicts.push({
      level: "medium",
      type: "superpowers_writeback_drift",
      message: "Repo-visible changes are newer than the latest formal Superpowers closeout run."
    });
  }

  return {
    files: await buildSourceFileFacts(filePaths),
    repoDerived,
    superpowers
  };
}
```

- [ ] **Step 4: Run the workflow-state tests and the existing regression suite**

Run: `node --test src/lib/superpowers-workflow-state.test.js`
Expected:
- `ok` for all workflow-state tests
- overall result `# fail 0`

Run: `npm.cmd run test:regression:windows`
Expected:
- `PASS regression.windows.js`

- [ ] **Step 5: Commit the workflow-state derivation**

```bash
git add src/lib/superpowers-workflow-state.js src/lib/superpowers-workflow-state.test.js src/lib/project-overview.js
git commit -m "feat: derive superpowers workflow state"
```

### Task 4: Surface Workflow State In Summary, Detail, Pending Review, Markdown, And Existing Views

**Files:**
- Create: `src/lib/state-generator-superpowers.js`
- Modify: `src/lib/state-generator.js`
- Create: `public/app-views-superpowers.js`
- Modify: `public/app-views-core.js`
- Modify: `scripts/regression.windows.js`

- [ ] **Step 1: Add a failing end-to-end regression for stale writeback drift**

```js
const { createGitFixtureRepo, writeWorkingTreeChange } = require("./test-helpers/git-fixture");

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
```

- [ ] **Step 2: Run regression and confirm the new Superpowers drift assertions fail before state-generator wiring**

Run: `npm.cmd run test:regression:windows`
Expected:
- The run fails because the new summary/detail/view fields are not exposed yet.

- [ ] **Step 3: Implement the state adapter helper and wire it into summary/detail/views/markdown**

```js
function buildSuperpowersSummaryFields(overviewSources) {
  const workflow = overviewSources.superpowers?.workflow || {};
  return {
    superpowersWorkflowState: workflow.workflowState || "not_used",
    latestExecutionEvidenceSource: workflow.latestExecutionEvidenceSource || "none",
    latestExecutionEvidenceLabel: workflow.latestExecutionEvidenceLabel || "No recent execution evidence",
    hasUnwrittenRepoChanges: Boolean(workflow.hasUnwrittenRepoChanges),
    writebackDrift: workflow.writebackDrift || "not_applicable",
    linkedSpecTitle: workflow.linkedSpecTitle || null,
    linkedPlanTitle: workflow.linkedPlanTitle || null,
    fallbackRepoChangeSummary: workflow.fallbackRepoChangeSummary || null
  };
}

function buildSuperpowersRecentEntries(overviewSources, recentChangeSummaries) {
  const workflow = overviewSources.superpowers?.workflow || {};
  if (workflow.latestExecutionEvidenceSource === "repo_fallback") {
    return [
      {
        id: "repo-fallback",
        type: "repo_change_inferred",
        title: workflow.latestExecutionEvidenceLabel,
        summary: workflow.fallbackRepoChangeSummary,
        createdAt: overviewSources.superpowers?.latestUpdatedAt,
        evidenceSource: "repo_fallback",
        gitDiff: false
      },
      ...recentChangeSummaries
    ].slice(0, 2);
  }
  return recentChangeSummaries;
}

function buildSuperpowersPendingReviewItems(overviewSources) {
  const workflow = overviewSources.superpowers?.workflow || {};
  if (!workflow.hasUnwrittenRepoChanges) {
    return [];
  }
  return [
    {
      id: "superpowers-writeback-drift",
      label: "Repo changed without a newer Superpowers closeout run",
      detail: "Write back project_state.json and append a new runs/*.json record before treating the latest repo change as formally closed out.",
      viewId: "instruction-center",
      severity: "high"
    }
  ];
}

function buildSuperpowersInstructionGuidance(overviewSources) {
  const workflow = overviewSources.superpowers?.workflow || {};
  if (!workflow.hasUnwrittenRepoChanges) {
    return null;
  }
  return {
    overridePrimaryType: "同步文档",
    extraReasons: [
      "Repo-visible changes are newer than the latest formal Superpowers closeout run."
    ],
    extraRequiredContext: [
      "latest changed files",
      "actual commands run",
      "actual tests run",
      "closeout summary"
    ],
    firstActionHint: "Write back project_state.json and a new runs record before continuing implementation guidance."
  };
}

function appendSuperpowersMarkdownSection(lines, currentState) {
  lines.push("", "## Superpowers Workflow", "");
  lines.push(`- workflow state: ${currentState.summary.superpowersWorkflowState}`);
  lines.push(`- evidence source: ${currentState.summary.latestExecutionEvidenceSource}`);
  lines.push(`- evidence label: ${currentState.summary.latestExecutionEvidenceLabel}`);
  lines.push(`- writeback drift: ${currentState.summary.writebackDrift}`);
  if (currentState.summary.linkedSpecTitle) {
    lines.push(`- linked spec: ${currentState.summary.linkedSpecTitle}`);
  }
  if (currentState.summary.linkedPlanTitle) {
    lines.push(`- linked plan: ${currentState.summary.linkedPlanTitle}`);
  }
}

module.exports = {
  appendSuperpowersMarkdownSection,
  buildSuperpowersSummaryFields,
  buildSuperpowersRecentEntries,
  buildSuperpowersPendingReviewItems,
  buildSuperpowersInstructionGuidance
};
```

```js
const {
  buildSuperpowersInstructionGuidance,
  buildSuperpowersPendingReviewItems,
  buildSuperpowersRecentEntries,
  buildSuperpowersSummaryFields
} = require("./state-generator-superpowers");

function buildSummary(projectState, repoFacts, conflicts, overviewSources, recentChangeSummaries) {
  const superpowersFields = buildSuperpowersSummaryFields(overviewSources);
  return {
    oneLineDefinition: overviewSources.projectBrief.oneLineDefinition.value,
    currentStage: overviewSources.versionState.currentStage.value || projectState.status.currentStage.value,
    currentWorkPackage: overviewSources.versionState.currentWorkPackage.value || projectState.status.currentWorkPackage.value,
    superpowersStatus: overviewSources.superpowers.status,
    ...superpowersFields
  };
}

function buildDetail(projectRecord, projectState, repoFacts, conflicts, overviewSources, recentChangeSummaries, cachePaths, summary) {
  return {
    baseline: {
      projectBrief: overviewSources.projectBrief,
      moduleMap: overviewSources.moduleMap,
      techStack: overviewSources.techStack
    },
    executionEvidence: {
      fixedDeliverables: projectState.status.fixedDeliverables,
      recentSummaryTitle: determineRecentSummaryTitle(recentChangeSummaries),
      recentChangeSummaries: buildSuperpowersRecentEntries(overviewSources, recentChangeSummaries)
    },
    superpowers: overviewSources.superpowers
  };
}

function buildInstructionCenter(projectState, overviewSources, conflicts, summary = null) {
  const guidance = buildSuperpowersInstructionGuidance(overviewSources);
  const currentAction = summary
    ? {
        state: summary.currentActionState,
        reasons: summary.currentActionReasons || [],
        secondaryConditions: summary.secondaryConditions || []
      }
    : deriveCurrentActionAnalysis(projectState, overviewSources, conflicts);
  let primaryType = "琛ラ」鐩熀绾?";
  if (guidance?.overridePrimaryType) {
    primaryType = guidance.overridePrimaryType;
    currentAction.reasons = [...currentAction.reasons, ...guidance.extraReasons];
  }
  const firstActionHint = guidance?.firstActionHint
    || "When baseline or version information is incomplete, prefer a state-completion instruction before direct implementation.";
  return {
    title: "鎸囦护涓績",
    currentActionState: currentAction.state,
    currentActionReasons: currentAction.reasons,
    secondaryConditions: currentAction.secondaryConditions,
    primaryType,
    requiredContext: uniqueStrings([
      "current work package goal",
      "target module name",
      "acceptance / verification scope",
      ...(guidance?.extraRequiredContext || [])
    ]),
    firstActionHint
  };
}

function buildPendingReviewModel(projectState, overviewSources, conflicts) {
  const userItems = [];
  const cleanupItems = [];
  const conflictItems = [];
  const auditItems = [];
  buildSuperpowersPendingReviewItems(overviewSources).forEach((item) => {
    addItem(auditItems, item.id, item.label, item.detail, item.viewId, item.severity);
  });
  return {
    count: [...userItems, ...cleanupItems, ...conflictItems, ...auditItems].length,
    items: [...userItems, ...cleanupItems, ...conflictItems, ...auditItems],
    userItems,
    cleanupItems,
    conflictItems,
    auditItems
  };
}

function renderCurrentStateMarkdown(currentState) {
  const lines = [
    "# 椤圭洰鏁翠綋鎯呭喌涓績 + 褰撳墠鐘舵€佷腑蹇?",
    "",
    `- 椤圭洰: ${currentState.project.name}`,
    `- 褰撳墠闃舵: ${currentState.summary.currentStage}`,
    `- 褰撳墠宸ヤ綔鍖?: ${currentState.summary.currentWorkPackage}`
  ];
  appendSuperpowersMarkdownSection(lines, currentState);
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Split the oversized frontend render file before adding new Superpowers UI explanations**

```js
import { escapeHtml, renderStatusPill, renderTag } from "./app-utils.js";

export function renderSuperpowersWorkflowSummary(summary) {
  if (!summary?.superpowersWorkflowState || summary.superpowersWorkflowState === "not_used") {
    return "";
  }
  return `
    <div class="data-row">
      <div>
        <strong>Superpowers Workflow</strong>
        <small>${escapeHtml(summary.latestExecutionEvidenceLabel || "No recent execution evidence")}</small>
      </div>
      <div class="pill-list">
        ${renderStatusPill(summary.superpowersWorkflowState)}
        ${renderTag(summary.latestExecutionEvidenceSource || "none", summary.latestExecutionEvidenceSource === "formal_run" ? "source-verified" : "source-pending")}
      </div>
    </div>
  `;
}

export function renderSuperpowersDriftHint(summary) {
  if (!summary?.hasUnwrittenRepoChanges) {
    return "";
  }
  return `
    <div class="data-row">
      <div>
        <strong>Writeback Drift</strong>
        <small>${escapeHtml(summary.fallbackRepoChangeSummary || "Repo-visible changes are newer than the latest formal closeout run.")}</small>
      </div>
      <div class="pill-list">${renderTag(summary.writebackDrift || "repo_ahead_of_writeback", "risk-medium")}</div>
    </div>
  `;
}

export function renderSuperpowersEvidenceMeta(summary) {
  if (!summary?.superpowersWorkflowState || summary.superpowersWorkflowState === "not_used") {
    return "";
  }
  return `
    <div class="data-row">
      <div>
        <strong>Evidence Source</strong>
        <small>${escapeHtml(summary.latestExecutionEvidenceLabel || "No recent execution evidence")}</small>
      </div>
      <div class="pill-list">${renderTag(summary.latestExecutionEvidenceSource || "none", "source-neutral")}</div>
    </div>
  `;
}
```

```js
import {
  renderSuperpowersEvidenceMeta,
  renderSuperpowersDriftHint,
  renderSuperpowersWorkflowSummary
} from "./app-views-superpowers.js";

function renderOverviewView(ctx, view) {
  const snapshot = ctx.state.activeSnapshot;
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>${escapeHtml(view.title || "椤圭洰鎬昏")}</h3>
        ${renderKeyValueRows([
          simpleRow("椤圭洰鍚嶇О", view.projectName || snapshot.project.name),
          fieldRow("涓€鍙ヨ瘽瀹氫箟", view.oneLineDefinition, { multiline: true }),
          fieldRow("褰撳墠闃舵", view.currentStage),
          fieldRow("褰撳墠宸ヤ綔鍖?", view.currentWorkPackage, { multiline: true })
        ])}
      </section>
      <section class="content-card">
        <h3>当前控制摘要</h3>
        <div class="data-list">
          ${renderSuperpowersWorkflowSummary(snapshot.summary)}
          ${renderSuperpowersDriftHint(snapshot.summary)}
        </div>
        ${renderKeyValueRows([
          simpleRow("Primary State", snapshot.summary.currentActionState, [renderStatusPill(snapshot.summary.currentActionState)]),
          simpleHtmlRow("鐘舵€佸師鍥?", listToText(snapshot.summary.currentActionReasons)),
          simpleHtmlRow("娆＄骇鏉′欢", listToText(snapshot.summary.secondaryConditions))
        ])}
      </section>
    </div>
  `;
}

function renderInstructionCenterView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>指令中心</h3>
        <div class="data-list">
          ${renderSuperpowersDriftHint(ctx.state.activeSnapshot.summary)}
        </div>
        ${renderKeyValueRows([
          simpleRow("褰撳墠鏈€閫傚悎鐨勬寚浠ょ被鍨?", view.primaryType, [renderStatusPill(view.currentActionState)]),
          simpleHtmlRow("鐘舵€佸師鍥?", listToText(view.currentActionReasons)),
          simpleHtmlRow("鍙戞寚浠ゅ墠搴旇ˉ鍏呯殑涓婁笅鏂?", listToText(view.requiredContext))
        ])}
      </section>
      <section class="content-card">
        <h3>鍙洿鎺ュ鍒剁殑鎸囦护妯℃澘</h3>
        <div class="data-list">${(view.availableTypes || []).map((item) => `<div class="data-row"><div><strong>${escapeHtml(item.type || "template")}</strong><small>${escapeHtml(item.label || "")}</small></div></div>`).join("")}</div>
      </section>
    </div>
  `;
}

function renderRecentChangesView(ctx, view) {
  return `
    <div class="content-grid single-col">
      <section class="content-card">
        <h3>${escapeHtml(view.title || "鏈€杩戜袱娆″彉鏇存憳瑕?")}</h3>
        <div class="data-list">
          ${renderSuperpowersEvidenceMeta(ctx.state.activeSnapshot.summary)}
          ${renderSuperpowersDriftHint(ctx.state.activeSnapshot.summary)}
        </div>
        ${renderRecentEntries(view.entries || [])}
      </section>
    </div>
  `;
}

function renderStatusSourcesView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>鐘舵€佹潵婧愯鏄?</h3>
        <div class="data-list">
          ${renderSuperpowersWorkflowSummary(ctx.state.activeSnapshot.summary)}
          ${renderSuperpowersEvidenceMeta(ctx.state.activeSnapshot.summary)}
        </div>
      </section>
      <section class="content-card">
        <h3>鍔ㄤ綔杈圭晫</h3>
        <div class="data-list">${(view.actionBoundaries || []).map((item) => `<div class="data-row"><div><strong>${escapeHtml(item.label || "boundary")}</strong><small>${escapeHtml(item.scope || "")}</small></div></div>`).join("")}</div>
      </section>
    </div>
  `;
}
```

- [ ] **Step 5: Re-run focused unit tests, Windows regression, and frontend smoke**

Run: `node --test src/lib/repo-change-fallback.test.js src/lib/superpowers-workflow-state.test.js`
Expected:
- both helper test files pass

Run: `npm.cmd run test:regression:windows`
Expected:
- `PASS regression.windows.js`

Run: `npm.cmd run test:smoke:frontend`
Expected:
- `PASS frontend.smoke.js`

- [ ] **Step 6: Commit the surfaced workflow model**

```bash
git add src/lib/state-generator-superpowers.js src/lib/state-generator.js public/app-views-superpowers.js public/app-views-core.js scripts/regression.windows.js
git commit -m "feat: surface superpowers workflow evidence"
```

### Task 5: Update Mechanism Docs And Run Final Verification

**Files:**
- Modify: `docs/superpowers/repo-mechanism-map.md`
- Modify: `src/lib/project-reader.js`
- Modify: `src/lib/project-overview.js`
- Modify: `src/lib/state-generator.js`
- Modify: `public/app-views-core.js`
- Create: `src/lib/repo-change-fallback.js`
- Create: `src/lib/superpowers-workflow-state.js`
- Create: `src/lib/state-generator-superpowers.js`
- Create: `public/app-views-superpowers.js`

- [ ] **Step 1: Add the new monitored-project aggregation path to the mechanism map**

```md
## Monitored Superpowers Aggregation Path

For monitored repos that use Superpowers, latest-change visibility now follows this order:

1. `/.codex-control/project_state.json` and `/.codex-control/runs/*.json` are the primary execution truth.
2. `docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md` provide workflow context.
3. Real git/repo-visible changes are used only as inferred fallback evidence when formal writeback is missing or stale.

This distinction is surfaced in dashboard summary/detail views as:

- formal run evidence
- linked spec/plan titles
- repo-changed-without-closeout drift
```

- [ ] **Step 2: Run whitespace and merge-marker checks**

Run: `git diff --check`
Expected:
- no whitespace errors
- no leftover conflict markers

- [ ] **Step 3: Run the full verification suite**

Run: `node --test src/lib/repo-change-fallback.test.js src/lib/superpowers-workflow-state.test.js`
Expected:
- all helper tests pass

Run: `npm.cmd run test:smoke:frontend`
Expected:
- `PASS frontend.smoke.js`

Run: `npm.cmd run test:regression:windows`
Expected:
- `PASS regression.windows.js`

- [ ] **Step 4: Review the final diff footprint**

Run: `git status --short`
Expected:
- only the planned backend helpers, frontend helper, regression/smoke updates, and `docs/superpowers/repo-mechanism-map.md` are modified
- no edits touch monitored-project business code outside the test fixtures

- [ ] **Step 5: Commit the finished rollout**

```bash
git add docs/superpowers/repo-mechanism-map.md src/lib/project-reader.js src/lib/project-overview.js src/lib/state-generator.js src/lib/repo-change-fallback.js src/lib/repo-change-fallback.test.js src/lib/superpowers-workflow-state.js src/lib/superpowers-workflow-state.test.js src/lib/state-generator-superpowers.js public/app-views-core.js public/app-views-superpowers.js scripts/regression.windows.js scripts/frontend.smoke.js scripts/test-helpers/git-fixture.js
git commit -m "feat: support superpowers monitored project aggregation"
```
