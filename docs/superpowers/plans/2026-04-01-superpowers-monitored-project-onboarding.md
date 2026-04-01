# Superpowers Monitored Project Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `useSuperpowers=true` a dashboard-declared onboarding mode that changes prompt generation, injected repo control assets, and removal cleanup for monitored repos.

**Architecture:** Introduce a focused onboarding helper for Superpowers-specific scaffold ownership and mode metadata, then thread that mode through attach, recovery, prompt bundles, repo-local skills, and removal cleanup. Keep dashboard-managed Superpowers assets explicitly owned so cleanup removes only those assets and never user-owned docs or business code.

**Tech Stack:** Node.js, existing dashboard backend modules, repo-local skill templates, Windows regression suite

---

## File Structure

- Create: `src/lib/superpowers-onboarding.js`
  Responsibility: centralize onboarding mode normalization, dashboard-owned `docs/superpowers/` scaffold creation, and ownership metadata helpers.
- Create: `src/lib/superpowers-onboarding.test.js`
  Responsibility: pure helper coverage for onboarding mode resolution and safe docs-ownership cleanup decisions.
- Create: `src/lib/project-removal.js`
  Responsibility: move monitored-project cleanup logic out of `src/server.js` before adding more removal rules; remove dashboard-managed Superpowers assets safely.
- Modify: `src/lib/project-reader.js`
  Responsibility: pass onboarding mode into scaffold generation, persist ownership metadata in project config, and call the new Superpowers onboarding helper.
- Modify: `src/lib/repo-skill-templates.js`
  Responsibility: generate stronger Superpowers-aware repo-local skills when onboarding mode is `superpowers`.
- Modify: `src/lib/agents-rules.js`
  Responsibility: strengthen the dashboard-managed `AGENTS.md` block for Superpowers repos.
- Modify: `src/lib/intake-workbench-support.js`
  Responsibility: upgrade new-project and recovery prompt bundles from weak Superpowers hints to mode-aware instructions.
- Modify: `src/lib/intake-workbench.js`
  Responsibility: persist `onboardingMode` alongside `useSuperpowers` in draft and recovery session state.
- Modify: `src/lib/server-workbench.js`
  Responsibility: return stable onboarding mode in preview/apply/recovery payloads and keep workbench state aligned.
- Modify: `src/server.js`
  Responsibility: persist onboarding mode on attach and delegate removal cleanup to `project-removal.js`.
- Modify: `scripts/regression.windows.js`
  Responsibility: add end-to-end regression coverage for Superpowers attach, recovery prompt mode, ownership metadata, and safe cleanup.
- Modify: `docs/superpowers/repo-mechanism-map.md`
  Responsibility: document the new onboarding-mode and owned-scaffold cleanup path.

## Task 1: Add Failing Onboarding Tests

**Files:**
- Create: `src/lib/superpowers-onboarding.test.js`
- Modify: `scripts/regression.windows.js`

- [ ] **Step 1: Write the failing helper test for onboarding mode and owned scaffold metadata**

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  determineOnboardingMode,
  buildSuperpowersScaffoldOwnership,
  collectDashboardOwnedSuperpowersPaths
} = require("./superpowers-onboarding");

test("determineOnboardingMode returns superpowers when dashboard enables useSuperpowers", () => {
  assert.equal(
    determineOnboardingMode({ useSuperpowers: true }),
    "superpowers"
  );
  assert.equal(
    determineOnboardingMode({ useSuperpowers: false }),
    "standard"
  );
});

test("buildSuperpowersScaffoldOwnership marks dashboard-created docs paths", () => {
  const result = buildSuperpowersScaffoldOwnership({
    docsReadmeCreated: true,
    specsPlaceholderCreated: true,
    plansPlaceholderCreated: false
  });

  assert.equal(result.docsReadmeCreated, true);
  assert.equal(result.specsPlaceholderCreated, true);
  assert.equal(result.plansPlaceholderCreated, false);
});

test("collectDashboardOwnedSuperpowersPaths returns only owned docs files", () => {
  const result = collectDashboardOwnedSuperpowersPaths("D:\\repo\\demo", {
    docsReadmeCreated: true,
    specsPlaceholderCreated: true,
    plansPlaceholderCreated: false
  });

  assert.deepEqual(result, [
    "D:\\repo\\demo\\docs\\superpowers\\README.md",
    "D:\\repo\\demo\\docs\\superpowers\\specs\\.gitkeep"
  ]);
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run: `node --test src/lib/superpowers-onboarding.test.js`
Expected: FAIL because `src/lib/superpowers-onboarding.js` does not exist yet.

- [ ] **Step 3: Add a failing Windows regression for Superpowers attach + removal**

```js
async function testSuperpowersOnboardingLifecycle(createdProjectIds) {
  const repoPath = path.join(FIXTURE_ROOT, "superpowers-onboarding-repo");
  await createGitFixtureRepo(repoPath);

  const created = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      path: repoPath,
      name: "Superpowers Onboarding Repo",
      useSuperpowers: true
    }),
    expectStatus: 200
  });
  createdProjectIds.add(created.project.id);

  assert.equal(created.project.onboardingMode, "superpowers");
  assert.ok((await safeReadText(path.join(repoPath, "AGENTS.md"))).includes("Superpowers mode is enabled"));
  assert.ok(await exists(path.join(repoPath, ".agents", "skills", "codex-project-handoff", "SKILL.md")));
  assert.ok(await exists(path.join(repoPath, "docs", "superpowers", "README.md")));

  const projectConfig = JSON.parse(await fs.readFile(path.join(repoPath, ".codex-control", "meta", "project_config.json"), "utf8"));
  assert.equal(projectConfig.workflow.onboardingMode, "superpowers");
  assert.equal(projectConfig.dashboardOwnedSuperpowers.docsReadmeCreated, true);

  const removed = await requestJson(`/api/projects/${created.project.id}`, {
    method: "DELETE"
  });

  assert.equal(await exists(path.join(repoPath, ".codex-control")), false);
  assert.equal(await exists(path.join(repoPath, "docs", "superpowers", "README.md")), false);
  assert.equal(await exists(path.join(repoPath, "docs", "superpowers")), false);
  assert.ok(!(await safeReadText(path.join(repoPath, "AGENTS.md")))?.includes("Superpowers mode is enabled"));
  assert.ok(
    removed.removed.removedRepoArtifacts.some((item) => item.action === "dashboard_owned_superpowers_file_deleted"),
    "cleanup should report owned Superpowers file deletion"
  );
}
```

- [ ] **Step 4: Run regression and verify it fails before implementation**

Run: `npm.cmd run test:regression:windows`
Expected: FAIL because attach does not yet expose `onboardingMode`, does not create owned `docs/superpowers/` scaffold metadata, and cleanup does not remove dashboard-owned Superpowers docs.

- [ ] **Step 5: Commit the red tests**

```bash
git add src/lib/superpowers-onboarding.test.js scripts/regression.windows.js
git commit -m "test: cover superpowers onboarding lifecycle"
```

## Task 2: Implement Onboarding Mode And Prompt Persistence

**Files:**
- Create: `src/lib/superpowers-onboarding.js`
- Modify: `src/lib/intake-workbench.js`
- Modify: `src/lib/intake-workbench-support.js`
- Modify: `src/lib/server-workbench.js`
- Modify: `src/server.js`

- [ ] **Step 1: Write the minimal onboarding helper implementation**

```js
const path = require("node:path");

function determineOnboardingMode(input = {}) {
  return input.useSuperpowers ? "superpowers" : "standard";
}

function buildSuperpowersScaffoldOwnership(flags = {}) {
  return {
    docsReadmeCreated: Boolean(flags.docsReadmeCreated),
    specsPlaceholderCreated: Boolean(flags.specsPlaceholderCreated),
    plansPlaceholderCreated: Boolean(flags.plansPlaceholderCreated)
  };
}

function collectDashboardOwnedSuperpowersPaths(projectRoot, ownership = {}) {
  const results = [];
  if (ownership.docsReadmeCreated) {
    results.push(path.join(projectRoot, "docs", "superpowers", "README.md"));
  }
  if (ownership.specsPlaceholderCreated) {
    results.push(path.join(projectRoot, "docs", "superpowers", "specs", ".gitkeep"));
  }
  if (ownership.plansPlaceholderCreated) {
    results.push(path.join(projectRoot, "docs", "superpowers", "plans", ".gitkeep"));
  }
  return results;
}

module.exports = {
  determineOnboardingMode,
  buildSuperpowersScaffoldOwnership,
  collectDashboardOwnedSuperpowersPaths
};
```

- [ ] **Step 2: Run helper test and verify it passes**

Run: `node --test src/lib/superpowers-onboarding.test.js`
Expected: PASS

- [ ] **Step 3: Persist onboarding mode in attach, drafts, and recovery sessions**

```js
const { determineOnboardingMode } = require("./superpowers-onboarding");

const projectRecord = {
  id: projectIdFromPath(rootPath),
  name,
  rootPath,
  addedAt: existingRecord ? existingRecord.addedAt : new Date().toISOString(),
  useSuperpowers: Boolean(payload?.useSuperpowers || existingRecord?.useSuperpowers),
  onboardingMode: determineOnboardingMode({
    useSuperpowers: Boolean(payload?.useSuperpowers || existingRecord?.useSuperpowers)
  })
};
```

```js
const draft = {
  ...existingDraft,
  useSuperpowers: normalizeBoolean(raw.useSuperpowers),
  onboardingMode: determineOnboardingMode({
    useSuperpowers: normalizeBoolean(raw.useSuperpowers)
  })
};
```

```js
const recoverySession = {
  ...existing,
  useSuperpowers: Boolean(payload?.useSuperpowers),
  onboardingMode: determineOnboardingMode({
    useSuperpowers: Boolean(payload?.useSuperpowers)
  })
};
```

- [ ] **Step 4: Upgrade prompt bundles to mode-aware language**

```js
const onboardingMode = session?.onboardingMode || determineOnboardingMode(session);
const superpowersLines = onboardingMode === "superpowers" ? [
  "Onboarding mode: superpowers.",
  "This repo is controlled by dashboard-declared Superpowers onboarding.",
  "When workflow-defining work appears, use docs/superpowers/specs/** -> docs/superpowers/plans/** -> implementation.",
  "Keep project_state.json, runs/*.json, and confirmed Superpowers decisions aligned."
] : [];
```

- [ ] **Step 5: Return onboarding mode from workbench and attach payloads**

```js
return {
  ok: true,
  actionBoundary: "initialization_write",
  message: "项目添加成功。",
  diagnostic,
  runtime,
  ...(registryState.snapshots.get(projectRecord.id)),
  project: {
    ...(registryState.snapshots.get(projectRecord.id)?.project || projectRecord),
    onboardingMode: projectRecord.onboardingMode
  }
};
```

- [ ] **Step 6: Run regression and inspect the next failing assertion**

Run: `npm.cmd run test:regression:windows`
Expected: FAIL later in the lifecycle because scaffold ownership and cleanup are not implemented yet.

- [ ] **Step 7: Commit onboarding mode plumbing**

```bash
git add src/lib/superpowers-onboarding.js src/lib/intake-workbench.js src/lib/intake-workbench-support.js src/lib/server-workbench.js src/server.js
git commit -m "feat: persist superpowers onboarding mode"
```

## Task 3: Inject Superpowers-Aware Scaffold And Ownership Metadata

**Files:**
- Modify: `src/lib/project-reader.js`
- Modify: `src/lib/repo-skill-templates.js`
- Modify: `src/lib/agents-rules.js`
- Modify: `src/lib/superpowers-onboarding.js`

- [ ] **Step 1: Extend the helper to create dashboard-owned `docs/superpowers/` scaffold when missing**

```js
async function ensureDashboardOwnedSuperpowersScaffold(projectRoot) {
  const docsDir = path.join(projectRoot, "docs", "superpowers");
  const specsDir = path.join(docsDir, "specs");
  const plansDir = path.join(docsDir, "plans");
  const readmePath = path.join(docsDir, "README.md");
  const specsKeepPath = path.join(specsDir, ".gitkeep");
  const plansKeepPath = path.join(plansDir, ".gitkeep");

  const ownership = buildSuperpowersScaffoldOwnership({});
  await fs.mkdir(specsDir, { recursive: true });
  await fs.mkdir(plansDir, { recursive: true });

  if (!(await fileExists(readmePath))) {
    await writeTextAtomic(readmePath, "# Dashboard-managed Superpowers Entry\n");
    ownership.docsReadmeCreated = true;
  }
  if (!(await fileExists(specsKeepPath))) {
    await writeTextAtomic(specsKeepPath, "");
    ownership.specsPlaceholderCreated = true;
  }
  if (!(await fileExists(plansKeepPath))) {
    await writeTextAtomic(plansKeepPath, "");
    ownership.plansPlaceholderCreated = true;
  }

  return ownership;
}
```

- [ ] **Step 2: Call the helper from `ensureProjectScaffold()` and persist ownership metadata**

```js
const onboardingMode = projectRecord.onboardingMode || determineOnboardingMode(projectRecord);
const docsOwnership = onboardingMode === "superpowers"
  ? await ensureDashboardOwnedSuperpowersScaffold(projectRoot)
  : buildSuperpowersScaffoldOwnership({});

await writeJsonAtomic(projectConfigPath, buildProjectConfig(projectRecord, docsOwnership));
```

```js
function buildProjectConfig(projectRecord, dashboardOwnedSuperpowers = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: projectRecord.id,
    name: projectRecord.name,
    rootPath: projectRecord.rootPath,
    workflow: {
      useSuperpowers: Boolean(projectRecord.useSuperpowers),
      onboardingMode: projectRecord.onboardingMode || determineOnboardingMode(projectRecord)
    },
    dashboardOwnedSuperpowers,
    // existing fields stay unchanged
  };
}
```

- [ ] **Step 3: Make AGENTS block and repo-local skills mode-aware**

```js
if (options.onboardingMode === "superpowers") {
  lines.push(
    "16. Dashboard-declared Superpowers onboarding is enabled for this repo.",
    "17. When specs or plans exist under docs/superpowers/**, treat them as workflow constraints before implementation.",
    "18. Recovery, handoff, and closeout must keep control files aligned with confirmed Superpowers decisions."
  );
}
```

```js
async function ensureRepoLocalSkills(projectRoot, options = {}) {
  const skillDefinitions = buildSkillDefinitions(options.onboardingMode || "standard");
  // write those definitions instead of fixed global templates
}
```

- [ ] **Step 4: Run regression and verify only cleanup is still failing**

Run: `npm.cmd run test:regression:windows`
Expected: FAIL in removal assertions because dashboard-owned Superpowers docs are created now but not yet deleted safely.

- [ ] **Step 5: Commit scaffold ownership support**

```bash
git add src/lib/project-reader.js src/lib/repo-skill-templates.js src/lib/agents-rules.js src/lib/superpowers-onboarding.js
git commit -m "feat: scaffold superpowers onboarding assets"
```

## Task 4: Implement Safe Removal Cleanup For Dashboard-Owned Superpowers Assets

**Files:**
- Create: `src/lib/project-removal.js`
- Modify: `src/server.js`
- Modify: `src/lib/superpowers-onboarding.js`
- Modify: `scripts/regression.windows.js`

- [ ] **Step 1: Extract cleanup logic from `src/server.js` into `src/lib/project-removal.js`**

```js
async function cleanupProjectControlFiles(projectRecord, options = {}) {
  const removedRepoArtifacts = [];
  const removedLocalArtifacts = [];
  const projectConfig = await readJsonIfExists(path.join(projectRecord.rootPath, ".codex-control", "meta", "project_config.json"));
  const ownedSuperpowersPaths = collectDashboardOwnedSuperpowersPaths(
    projectRecord.rootPath,
    projectConfig?.dashboardOwnedSuperpowers || {}
  );

  // existing AGENTS /.gitignore /.codex-control /.agents cleanup stays here
  // then remove ownedSuperpowersPaths one by one if present
}
```

- [ ] **Step 2: Remove owned Superpowers files and only empty parent directories**

```js
for (const ownedPath of ownedSuperpowersPaths) {
  const exists = await fs.stat(ownedPath).then(() => true).catch(() => false);
  if (!exists) {
    continue;
  }
  await fs.rm(ownedPath, { force: true });
  removedRepoArtifacts.push({
    path: ownedPath,
    action: "dashboard_owned_superpowers_file_deleted"
  });
}

await removeEmptyIfExists(path.join(projectRecord.rootPath, "docs", "superpowers", "specs"), removedRepoArtifacts, "empty_superpowers_specs_dir_deleted");
await removeEmptyIfExists(path.join(projectRecord.rootPath, "docs", "superpowers", "plans"), removedRepoArtifacts, "empty_superpowers_plans_dir_deleted");
await removeEmptyIfExists(path.join(projectRecord.rootPath, "docs", "superpowers"), removedRepoArtifacts, "empty_superpowers_dir_deleted");
await removeEmptyIfExists(path.join(projectRecord.rootPath, "docs"), removedRepoArtifacts, "empty_docs_dir_deleted");
```

- [ ] **Step 3: Delegate server removal path to the new helper**

```js
const { cleanupProjectControlFiles } = require("./lib/project-removal");

async function removeProjectById(projectId) {
  // existing lookup logic
  const cleanup = await cleanupProjectControlFiles(projectRecord, {
    cacheDir: path.join(CACHE_DIR, projectRecord.id)
  });
  // existing registry update logic
}
```

- [ ] **Step 4: Extend regression with a user-owned docs preservation case**

```js
await fs.writeFile(path.join(repoPath, "docs", "superpowers", "specs", "user-spec.md"), "# User Spec\n", "utf8");

const removed = await requestJson(`/api/projects/${created.project.id}`, {
  method: "DELETE"
});

assert.equal(await exists(path.join(repoPath, "docs", "superpowers", "specs", "user-spec.md")), true);
assert.equal(await exists(path.join(repoPath, "docs", "superpowers", "README.md")), false);
assert.ok(
  removed.removed.removedRepoArtifacts.some((item) => item.action === "dashboard_owned_superpowers_file_deleted"),
  "cleanup should report only dashboard-owned docs deletions"
);
```

- [ ] **Step 5: Run regression and verify it passes**

Run: `npm.cmd run test:regression:windows`
Expected: PASS

- [ ] **Step 6: Commit removal cleanup extraction**

```bash
git add src/lib/project-removal.js src/server.js src/lib/superpowers-onboarding.js scripts/regression.windows.js
git commit -m "feat: clean dashboard-owned superpowers assets on removal"
```

## Task 5: Update Mechanism Docs And Run Final Verification

**Files:**
- Modify: `docs/superpowers/repo-mechanism-map.md`
- Modify: `src/lib/project-reader.js`
- Modify: `src/lib/intake-workbench-support.js`
- Modify: `src/lib/repo-skill-templates.js`
- Modify: `src/lib/agents-rules.js`
- Modify: `src/lib/project-removal.js`
- Create: `src/lib/superpowers-onboarding.js`
- Create: `src/lib/superpowers-onboarding.test.js`

- [ ] **Step 1: Update the mechanism map with the onboarding-mode path**

```md
## Superpowers Onboarding Path

When a monitored project is attached with `useSuperpowers=true`, the dashboard treats that flag as the onboarding source of truth.

The mode now drives:

1. attach / recovery payloads and workbench prompt bundles
2. dashboard-managed `AGENTS.md` rules and repo-local skills
3. optional dashboard-owned `docs/superpowers/` entry scaffold
4. safe cleanup of dashboard-owned Superpowers assets on project removal
```

- [ ] **Step 2: Run whitespace and merge-marker checks**

Run: `git diff --check`
Expected:
- no whitespace errors

Run: `rg "^(<<<<<<<|=======|>>>>>>>)" -n .`
Expected:
- no leftover conflict markers

- [ ] **Step 3: Run the full verification suite**

Run: `node --test src/lib/superpowers-onboarding.test.js`
Expected:
- PASS

Run: `npm.cmd run test:smoke:frontend`
Expected:
- `PASS frontend.smoke.js`

Run: `npm.cmd run test:regression:windows`
Expected:
- `PASS regression.windows.js`

- [ ] **Step 4: Inspect final diff scope**

Run: `git status --short`
Expected:
- only the planned onboarding helpers, prompt/scaffold/removal updates, tests, and docs are modified
- no edits touch monitored-project business code outside the test fixtures

- [ ] **Step 5: Commit the finished rollout**

```bash
git add docs/superpowers/repo-mechanism-map.md src/lib/project-reader.js src/lib/repo-skill-templates.js src/lib/agents-rules.js src/lib/intake-workbench-support.js src/lib/intake-workbench.js src/lib/server-workbench.js src/lib/project-removal.js src/lib/superpowers-onboarding.js src/lib/superpowers-onboarding.test.js src/server.js scripts/regression.windows.js
git commit -m "feat: support superpowers monitored project onboarding"
```
