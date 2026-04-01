const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveProjectWorkflowGuidance
} = require("./project-workflow-guidance");

function assertWorkflowGuidance(guidance, expected) {
  assert.equal(guidance.workflowStage, expected.workflowStage);
  assert.equal(guidance.recommendedNextAction, expected.recommendedNextAction);
  assert.equal(guidance.recommendedNextSkill, expected.recommendedNextSkill);
  assert.equal(typeof guidance.recommendedNextReason, "string");
  assert.notEqual(guidance.recommendedNextReason.length, 0);
  assert.equal(typeof guidance.recommendedNextAfter, "string");
  assert.notEqual(guidance.recommendedNextAfter.length, 0);
  assert.ok(Array.isArray(guidance.workflowBlockingItems));
  assert.notEqual(guidance.workflowBlockingItems.length, 0);
}

test("workflow guidance prefers blocked when high-priority conflicts are present", () => {
  const guidance = deriveProjectWorkflowGuidance({
    currentAction: {
      state: "ready_for_implementation",
      reasons: ["Waiting on a human repo decision."]
    },
    conflicts: [
      {
        level: "high",
        message: "Repo facts conflict with declared workflow direction."
      }
    ]
  });

  assertWorkflowGuidance(guidance, {
    workflowStage: "blocked",
    recommendedNextAction: "resolve the blocking issue",
    recommendedNextSkill: null
  });
  assert.deepEqual(guidance.workflowBlockingItems, [
    "Repo facts conflict with declared workflow direction.",
    "Waiting on a human repo decision."
  ]);
});

test("workflow guidance prefers closeout_needed over recovery_needed when repo drift is newer than the latest closeout", () => {
  const guidance = deriveProjectWorkflowGuidance({
    currentAction: {
      state: "recovery"
    },
    onboardingMode: "superpowers",
    superpowersWorkflow: {
      workflowState: "repo_changed_without_closeout",
      hasUnwrittenRepoChanges: true,
      writebackDrift: "repo_ahead_of_writeback"
    }
  });

  assertWorkflowGuidance(guidance, {
    workflowStage: "closeout_needed",
    recommendedNextAction: "write back closeout state",
    recommendedNextSkill: "codex-task-closeout-writeback"
  });
});

test("workflow guidance returns recovery_needed when the repo needs recovery instead of a closeout", () => {
  const guidance = deriveProjectWorkflowGuidance({
    currentAction: {
      state: "recovery"
    }
  });

  assertWorkflowGuidance(guidance, {
    workflowStage: "recovery_needed",
    recommendedNextAction: "run the recovery scan",
    recommendedNextSkill: "codex-project-recovery-scan"
  });
});

test("workflow guidance returns docs_decision_needed when superpowers docs are still incomplete", () => {
  const guidance = deriveProjectWorkflowGuidance({
    onboardingMode: "superpowers",
    currentAction: {
      state: "ready_for_implementation"
    },
    superpowersWorkflow: {
      workflowState: "docs_only"
    }
  });

  assertWorkflowGuidance(guidance, {
    workflowStage: "docs_decision_needed",
    recommendedNextAction: "decide the docs and planning path",
    recommendedNextSkill: "codex-project-handoff"
  });
});

test("workflow guidance returns handoff_needed when superpowers docs are ready without drift", () => {
  const guidance = deriveProjectWorkflowGuidance({
    onboardingMode: "superpowers",
    currentAction: {
      state: "ready_for_implementation"
    },
    superpowersWorkflow: {
      workflowState: "executed_and_written_back"
    }
  });

  assertWorkflowGuidance(guidance, {
    workflowStage: "handoff_needed",
    recommendedNextAction: "prepare the handoff prompt",
    recommendedNextSkill: "codex-project-handoff"
  });
});

test("workflow guidance returns ready_for_implementation for standard repos without higher-priority blockers", () => {
  const guidance = deriveProjectWorkflowGuidance({
    onboardingMode: "standard",
    currentAction: {
      state: "ready_for_implementation"
    }
  });

  assertWorkflowGuidance(guidance, {
    workflowStage: "ready_for_implementation",
    recommendedNextAction: "start implementation",
    recommendedNextSkill: null
  });
});
