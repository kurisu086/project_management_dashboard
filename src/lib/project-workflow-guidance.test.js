const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildCurrentState, buildDefaultProjectState } = require("./state-generator");
const { readOverviewSources } = require("./project-overview");

async function createRepoFixture({ specs = false, plans = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-workflow-guidance-"));
  await fs.writeFile(path.join(root, "README.md"), "# Workflow Guidance Fixture\n", "utf8");

  if (specs || plans) {
    await fs.mkdir(path.join(root, "docs", "superpowers"), { recursive: true });
  }
  if (specs) {
    await fs.mkdir(path.join(root, "docs", "superpowers", "specs"), { recursive: true });
    await fs.writeFile(
      path.join(root, "docs", "superpowers", "specs", "2026-04-02-spec.md"),
      "# Spec Fixture\n\nWorkflow guidance test spec.\n",
      "utf8"
    );
  }
  if (plans) {
    await fs.mkdir(path.join(root, "docs", "superpowers", "plans"), { recursive: true });
    await fs.writeFile(
      path.join(root, "docs", "superpowers", "plans", "2026-04-02-plan.md"),
      "# Plan Fixture\n\nWorkflow guidance test plan.\n",
      "utf8"
    );
  }

  return root;
}

function makeProjectState(name, overrides = {}) {
  const projectState = buildDefaultProjectState(name);
  projectState.status.currentStage.value = overrides.currentStage || "implementation";
  projectState.status.versionTarget.value = overrides.versionTarget || "v-next";
  projectState.status.currentWorkPackage.value = overrides.currentWorkPackage || "Current slice";
  projectState.evidence.history = overrides.history || [];
  return projectState;
}

function makeRepoFacts(overrides = {}) {
  return {
    repoChangeFallback: {
      latestCommitHash: null,
      latestCommitSummary: null,
      latestCommitTimestamp: null,
      latestRepoVisibleUpdateAt: null,
      hasRepoVisibleChanges: false,
      workingTreeDirty: false,
      changedFiles: [],
      fallbackRepoChangeSummary: "No repo-visible fallback evidence is available."
    },
    recentChangeSummaries: [],
    verifiedConsistency: null,
    ...overrides
  };
}

async function buildSnapshot({ repoRoot, projectName, projectState, repoFacts }) {
  const projectRecord = {
    id: projectName.toLowerCase().replaceAll(/\s+/g, "-"),
    name: projectName,
    rootPath: repoRoot
  };
  const overviewSources = await readOverviewSources(projectRecord, projectState, repoFacts);
  return buildCurrentState(projectRecord, projectState, repoFacts, [], overviewSources);
}

function assertWorkflowGuidance(snapshot, expected) {
  assert.equal(snapshot.summary.workflowStage, expected.workflowStage);
  assert.equal(snapshot.summary.recommendedNextAction, expected.recommendedNextAction);
  assert.equal(snapshot.summary.recommendedNextSkill, expected.recommendedNextSkill);
  assert.equal(snapshot.detail.views.instructionCenter.workflowGuidance.workflowStage, expected.workflowStage);
  assert.equal(snapshot.detail.views.instructionCenter.workflowGuidance.recommendedNextAction, expected.recommendedNextAction);
  assert.equal(snapshot.detail.views.instructionCenter.workflowGuidance.recommendedNextSkill, expected.recommendedNextSkill);
  assert.equal(snapshot.detail.views.onboarding.workflowGuidance.workflowStage, expected.workflowStage);
  assert.equal(snapshot.detail.views.onboarding.workflowGuidance.recommendedNextAction, expected.recommendedNextAction);
  assert.equal(snapshot.detail.views.onboarding.workflowGuidance.recommendedNextSkill, expected.recommendedNextSkill);
}

test("workflow guidance prefers closeout_needed over recovery_needed when repo drift is newer than the latest closeout", async () => {
  const repoRoot = await createRepoFixture({ specs: true, plans: true });
  try {
    const snapshot = await buildSnapshot({
      repoRoot,
      projectName: "Closeout Priority Fixture",
      projectState: makeProjectState("Closeout Priority Fixture", {
        currentStage: "recovery",
        history: [
          {
            id: "run-1",
            type: "run",
            title: "Formal closeout",
            summary: "Latest closeout before the repo drifted",
            createdAt: "2026-04-02T08:00:00.000Z",
            file: ".codex-control/runs/run-1.json"
          }
        ]
      }),
      repoFacts: makeRepoFacts({
        repoChangeFallback: {
          latestCommitHash: "abc123",
          latestCommitSummary: "feat: continue the slice",
          latestCommitTimestamp: "2026-04-02T10:00:00.000Z",
          latestRepoVisibleUpdateAt: "2026-04-02T10:00:00.000Z",
          hasRepoVisibleChanges: true,
          workingTreeDirty: true,
          changedFiles: [{ path: "src/index.js", status: "M" }],
          fallbackRepoChangeSummary: "Working tree drift is newer than the latest formal closeout."
        }
      })
    });

    assertWorkflowGuidance(snapshot, {
      workflowStage: "closeout_needed",
      recommendedNextAction: "write back closeout state",
      recommendedNextSkill: "codex-task-closeout-writeback"
    });
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("workflow guidance returns recovery_needed when the repo needs recovery instead of a closeout", async () => {
  const repoRoot = await createRepoFixture();
  try {
    const snapshot = await buildSnapshot({
      repoRoot,
      projectName: "Recovery Fixture",
      projectState: makeProjectState("Recovery Fixture", {
        currentStage: "recovery"
      }),
      repoFacts: makeRepoFacts()
    });

    assertWorkflowGuidance(snapshot, {
      workflowStage: "recovery_needed",
      recommendedNextAction: "run the recovery scan",
      recommendedNextSkill: "codex-project-recovery-scan"
    });
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("workflow guidance returns docs_decision_needed when specs exist but the docs path is still undecided", async () => {
  const repoRoot = await createRepoFixture({ specs: true });
  try {
    const snapshot = await buildSnapshot({
      repoRoot,
      projectName: "Docs Decision Fixture",
      projectState: makeProjectState("Docs Decision Fixture", {
        currentStage: "definition"
      }),
      repoFacts: makeRepoFacts()
    });

    assertWorkflowGuidance(snapshot, {
      workflowStage: "docs_decision_needed",
      recommendedNextAction: "decide the docs and planning path",
      recommendedNextSkill: "codex-project-handoff"
    });
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("workflow guidance returns handoff_needed when specs and plans are present without drift", async () => {
  const repoRoot = await createRepoFixture({ specs: true, plans: true });
  try {
    const snapshot = await buildSnapshot({
      repoRoot,
      projectName: "Handoff Fixture",
      projectState: makeProjectState("Handoff Fixture", {
        currentStage: "implementation"
      }),
      repoFacts: makeRepoFacts()
    });

    assertWorkflowGuidance(snapshot, {
      workflowStage: "handoff_needed",
      recommendedNextAction: "prepare the handoff prompt",
      recommendedNextSkill: "codex-project-handoff"
    });
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
