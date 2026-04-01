const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSuperpowersWorkflowState
} = require("./superpowers-workflow-state");
const {
  readOverviewSources
} = require("./project-overview");

function makeSuperpowers(overrides = {}) {
  return {
    status: "detected",
    hasDirectory: true,
    hasSpecs: true,
    hasPlans: true,
    latestUpdatedAt: "2026-04-01T09:00:00.000Z",
    evidence: {
      specs: [{ file: "2026-04-01-feature-spec.md", title: "Feature Spec", summary: "Spec summary", updatedAt: "2026-04-01T08:00:00.000Z" }],
      plans: [{ file: "2026-04-01-feature-plan.md", title: "Feature Plan", summary: "Plan summary", updatedAt: "2026-04-01T09:00:00.000Z" }]
    },
    derived: {
      projectBrief: {},
      moduleMap: { modules: [] },
      techStack: {},
      gameDesign: {},
      versionState: {}
    },
    ...overrides
  };
}

function makeProjectState(overrides = {}) {
  return {
    status: {
      versionTarget: { value: "v-next", source: "project_state.json" },
      currentStage: { value: "implementation", source: "project_state.json" },
      currentWorkPackage: { value: "Current slice", source: "project_state.json" },
      consistency: { summary: "Consistent with current scope." }
    },
    evidence: {
      history: []
    },
    ...overrides
  };
}

function makeRepoFacts(overrides = {}) {
  return {
    repoLocalSkills: {
      handoff: { name: "codex-project-handoff", path: "/repo/.agents/skills/codex-project-handoff", exists: true, files: [] },
      closeout: { name: "codex-task-closeout-writeback", path: "/repo/.agents/skills/codex-task-closeout-writeback", exists: true, files: [] },
      recovery: { name: "codex-project-recovery-scan", path: "/repo/.agents/skills/codex-project-recovery-scan", exists: true, files: [] }
    },
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
    ...overrides
  };
}

async function createTempRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "superpowers-workflow-state-"));
  await fs.mkdir(path.join(root, "docs", "superpowers", "specs"), { recursive: true });
  await fs.mkdir(path.join(root, "docs", "superpowers", "plans"), { recursive: true });
  await fs.writeFile(path.join(root, "docs", "superpowers", "specs", "spec-one.md"), "# Spec One\n\nSpec summary.\n");
  await fs.writeFile(path.join(root, "docs", "superpowers", "plans", "plan-one.md"), "# Plan One\n\nPlan summary.\n");
  await fs.writeFile(path.join(root, "README.md"), "# Fixture\n");
  return root;
}

test("buildSuperpowersWorkflowState returns planned_not_executed when specs and plans exist without runs", () => {
  const result = buildSuperpowersWorkflowState({
    superpowers: makeSuperpowers(),
    repoFacts: makeRepoFacts(),
    projectState: makeProjectState()
  });

  assert.equal(result.workflowState, "planned_not_executed");
  assert.equal(result.latestExecutionEvidenceSource, "none");
  assert.equal(result.latestExecutionEvidenceLabel, "Specs and plans are present, but no formal run was found.");
  assert.equal(result.hasUnwrittenRepoChanges, false);
  assert.equal(result.writebackDrift, "insufficient_evidence");
  assert.equal(result.linkedSpecTitle, "Feature Spec");
  assert.equal(result.linkedPlanTitle, "Feature Plan");
});

test("buildSuperpowersWorkflowState returns docs_only when only a spec exists", () => {
  const result = buildSuperpowersWorkflowState({
    superpowers: makeSuperpowers({
      hasPlans: false,
      evidence: {
        specs: [{ file: "2026-04-01-feature-spec.md", title: "Feature Spec", summary: "Spec summary", updatedAt: "2026-04-01T08:00:00.000Z" }],
        plans: []
      }
    }),
    repoFacts: makeRepoFacts(),
    projectState: makeProjectState()
  });

  assert.equal(result.workflowState, "docs_only");
  assert.equal(result.latestExecutionEvidenceSource, "none");
  assert.equal(result.writebackDrift, "insufficient_evidence");
  assert.equal(result.linkedSpecTitle, "Feature Spec");
  assert.equal(result.linkedPlanTitle, null);
});

test("buildSuperpowersWorkflowState returns executed_and_written_back when a formal run exists", () => {
  const result = buildSuperpowersWorkflowState({
    superpowers: makeSuperpowers(),
    repoFacts: makeRepoFacts({
      repoChangeFallback: {
        latestCommitHash: "abc123",
        latestCommitSummary: "feat: seed fixture",
        latestCommitTimestamp: "2026-04-01T10:00:00.000Z",
        latestRepoVisibleUpdateAt: "2026-04-01T10:00:00.000Z",
        hasRepoVisibleChanges: true,
        workingTreeDirty: false,
        changedFiles: [],
        fallbackRepoChangeSummary: "Latest commit \"feat: seed fixture\" with clean working tree."
      }
    }),
    projectState: makeProjectState({
      evidence: {
        history: [
          {
            id: "run-1",
            type: "run",
            title: "Formal closeout",
            summary: "Completed the current slice",
            createdAt: "2026-04-01T10:30:00.000Z",
            file: ".codex-control/runs/run-1.json"
          }
        ]
      }
    })
  });

  assert.equal(result.workflowState, "executed_and_written_back");
  assert.equal(result.latestExecutionEvidenceSource, "formal_run");
  assert.equal(result.latestExecutionEvidenceLabel, "Formal closeout");
  assert.equal(result.hasUnwrittenRepoChanges, false);
  assert.equal(result.writebackDrift, "aligned");
  assert.equal(result.latestFormalRun.id, "run-1");
  assert.equal(result.repoLocalSkills.closeout.exists, true);
});

test("buildSuperpowersWorkflowState returns repo_changed_without_closeout when repo drift is newer than the latest formal run", () => {
  const result = buildSuperpowersWorkflowState({
    superpowers: makeSuperpowers(),
    repoFacts: makeRepoFacts({
      repoChangeFallback: {
        latestCommitHash: "abc123",
        latestCommitSummary: "feat: continue current slice",
        latestCommitTimestamp: "2026-04-01T11:00:00.000Z",
        latestRepoVisibleUpdateAt: "2026-04-01T11:00:00.000Z",
        hasRepoVisibleChanges: true,
        workingTreeDirty: true,
        changedFiles: [{ path: "src/index.js", status: "M", updatedAt: "2026-04-01T11:00:00.000Z" }],
        fallbackRepoChangeSummary: "Working tree has 1 repo-visible change(s) after the last formal writeback."
      }
    }),
    projectState: makeProjectState({
      evidence: {
        history: [
          {
            id: "run-1",
            type: "run",
            title: "Formal closeout",
            summary: "Completed the current slice",
            createdAt: "2026-04-01T10:00:00.000Z",
            file: ".codex-control/runs/run-1.json"
          }
        ]
      }
    })
  });

  assert.equal(result.workflowState, "repo_changed_without_closeout");
  assert.equal(result.latestExecutionEvidenceSource, "repo_fallback");
  assert.equal(result.latestExecutionEvidenceLabel, "Repo-visible changes after the latest formal run.");
  assert.equal(result.writebackDrift, "repo_ahead_of_writeback");
  assert.equal(result.hasUnwrittenRepoChanges, true);
  assert.equal(result.fallbackRepoChangeSummary, "Working tree has 1 repo-visible change(s) after the last formal writeback.");
});

test("buildSuperpowersWorkflowState returns repo_changed_without_closeout when repo changes exist but no formal run was written back", () => {
  const result = buildSuperpowersWorkflowState({
    superpowers: makeSuperpowers(),
    repoFacts: makeRepoFacts({
      repoChangeFallback: {
        latestCommitHash: "abc123",
        latestCommitSummary: "feat: continue current slice",
        latestCommitTimestamp: "2026-04-01T11:00:00.000Z",
        latestRepoVisibleUpdateAt: "2026-04-01T11:00:00.000Z",
        hasRepoVisibleChanges: true,
        workingTreeDirty: true,
        changedFiles: [{ path: "src/index.js", status: "M", updatedAt: "2026-04-01T11:00:00.000Z" }],
        fallbackRepoChangeSummary: "Working tree has 1 repo-visible change(s) without formal writeback."
      }
    }),
    projectState: makeProjectState()
  });

  assert.equal(result.workflowState, "repo_changed_without_closeout");
  assert.equal(result.latestExecutionEvidenceSource, "repo_fallback");
  assert.equal(result.writebackDrift, "missing_formal_writeback");
  assert.equal(result.hasUnwrittenRepoChanges, true);
});

test("buildSuperpowersWorkflowState returns not_used when there is no superpowers evidence", () => {
  const result = buildSuperpowersWorkflowState({
    superpowers: makeSuperpowers({
      status: "not_used",
      hasDirectory: false,
      hasSpecs: false,
      hasPlans: false,
      evidence: {
        specs: [],
        plans: []
      }
    }),
    repoFacts: makeRepoFacts({
      repoLocalSkills: {
        handoff: { exists: false },
        closeout: { exists: false },
        recovery: { exists: false }
      }
    }),
    projectState: makeProjectState()
  });

  assert.equal(result.workflowState, "not_used");
  assert.equal(result.latestExecutionEvidenceSource, "none");
  assert.equal(result.latestExecutionEvidenceLabel, "Superpowers workflow is not used in this repo.");
  assert.equal(result.hasUnwrittenRepoChanges, false);
  assert.equal(result.writebackDrift, "not_applicable");
});

test("buildSuperpowersWorkflowState returns insufficient_evidence when only the directory exists", () => {
  const result = buildSuperpowersWorkflowState({
    superpowers: makeSuperpowers({
      status: "connected_but_insufficient",
      hasDirectory: true,
      hasSpecs: false,
      hasPlans: false,
      evidence: {
        specs: [],
        plans: []
      }
    }),
    repoFacts: makeRepoFacts(),
    projectState: makeProjectState()
  });

  assert.equal(result.workflowState, "insufficient_evidence");
  assert.equal(result.latestExecutionEvidenceSource, "none");
  assert.equal(result.writebackDrift, "insufficient_evidence");
});

test("readOverviewSources attaches workflow state and writeback drift conflict", async () => {
  const root = await createTempRepo();

  try {
    const projectRecord = {
      rootPath: root,
      name: "fixture-repo"
    };
    const result = await readOverviewSources(
      projectRecord,
      makeProjectState({
        evidence: {
          history: [
            {
              id: "run-1",
              type: "run",
              title: "Formal closeout",
              summary: "Completed the current slice",
              createdAt: "2026-04-01T10:00:00.000Z",
              file: ".codex-control/runs/run-1.json"
            }
          ]
        }
      }),
      makeRepoFacts({
        repoChangeFallback: {
          latestCommitHash: "abc123",
          latestCommitSummary: "feat: continue current slice",
          latestCommitTimestamp: "2026-04-01T11:00:00.000Z",
          latestRepoVisibleUpdateAt: "2026-04-01T11:00:00.000Z",
          hasRepoVisibleChanges: true,
          workingTreeDirty: true,
          changedFiles: [{ path: "src/index.js", status: "M", updatedAt: "2026-04-01T11:00:00.000Z" }],
          fallbackRepoChangeSummary: "Working tree has 1 repo-visible change(s) after the last formal writeback."
        }
      })
    );

    assert.equal(result.superpowers.workflow.workflowState, "repo_changed_without_closeout");
    assert.equal(result.superpowers.workflow.latestExecutionEvidenceSource, "repo_fallback");
    assert.equal(result.superpowers.workflow.writebackDrift, "repo_ahead_of_writeback");
    assert.ok(result.conflicts.some((item) => item.type === "superpowers_writeback_drift"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
