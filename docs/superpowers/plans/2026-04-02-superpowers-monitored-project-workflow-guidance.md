# Superpowers Monitored Project Workflow Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow-guidance layer that turns monitored-project state into a stable next-step recommendation across overview, instruction-center, and onboarding surfaces.

**Architecture:** Introduce a focused backend derivation helper for workflow stage and recommended next action, then adapt existing state-generator summary/detail models through a small workflow adapter instead of expanding the already-large state generator inline. On the frontend, extract workflow rendering into a dedicated browser helper so overview, instruction-center, and onboarding can share the same compact guidance UI while shrinking `public/app-views-core.js`.

**Tech Stack:** Node.js, existing dashboard backend modules, browser-side modular view renderers, Windows regression suite

---

## File Structure

- Create: `src/lib/project-workflow-guidance.js`
  Responsibility: derive `workflowStage`, `recommendedNextAction`, `recommendedNextSkill`, `recommendedNextReason`, `recommendedNextAfter`, and aligned blocking items from current dashboard state.
- Create: `src/lib/project-workflow-guidance.test.js`
  Responsibility: pure unit coverage for stage priority and recommendation mapping.
- Create: `src/lib/state-generator-workflow-guidance.js`
  Responsibility: adapt derived workflow guidance into summary fields, instruction-center view data, onboarding view data, pending-review labels, and markdown output.
- Modify: `src/lib/state-generator.js`
  Responsibility: delegate workflow guidance and move the current instruction/onboarding logic out of the monolithic file.
- Modify: `src/lib/state-generator-superpowers.js`
  Responsibility: align Superpowers-specific pending-review / drift guidance with the new workflow stage model instead of ad-hoc closeout-only overrides.
- Create: `public/app-views-workflow.js`
  Responsibility: render compact workflow-stage / next-action cards for overview, instruction-center, and onboarding.
- Modify: `public/app-views-core.js`
  Responsibility: consume the new workflow render helpers and shed inline workflow rendering to reduce file size.
- Modify: `scripts/regression.windows.js`
  Responsibility: verify workflow-stage and next-action guidance for recovery, docs decision, closeout, and user-facing view payloads.
- Modify: `scripts/frontend.smoke.js`
  Responsibility: verify the browser payload shows the next-action workflow guidance without breaking existing flows.
- Modify: `docs/superpowers/repo-mechanism-map.md`
  Responsibility: document the workflow-guidance derivation path and affected UI surfaces.

## Task 1: Add Failing Workflow Guidance Tests

**Files:**
- Create: `src/lib/project-workflow-guidance.test.js`
- Modify: `scripts/regression.windows.js`
- Modify: `scripts/frontend.smoke.js`

- [ ] **Step 1: Write failing unit tests for workflow stage priority**

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { deriveProjectWorkflowGuidance } = require("./project-workflow-guidance");

test("closeout_needed outranks recovery_needed when repo drift exists", () => {
  const result = deriveProjectWorkflowGuidance({
    onboardingMode: "superpowers",
    currentAction: {
      state: "needs_baseline",
      reasons: ["Missing baseline information: module map"]
    },
    superpowersWorkflow: {
      workflowState: "repo_changed_without_closeout",
      hasUnwrittenRepoChanges: true,
      writebackDrift: "repo_ahead_of_writeback"
    },
    conflicts: []
  });

  assert.equal(result.workflowStage, "closeout_needed");
  assert.equal(result.recommendedNextAction, "run_closeout");
  assert.equal(result.recommendedNextSkill, "codex-task-closeout-writeback");
});

test("recovery_needed is selected when baseline or version state is incomplete", () => {
  const result = deriveProjectWorkflowGuidance({
    onboardingMode: "standard",
    currentAction: {
      state: "needs_version_definition",
      reasons: ["Missing version definition: verification matrix"]
    },
    superpowersWorkflow: {
      workflowState: "not_used"
    },
    conflicts: []
  });

  assert.equal(result.workflowStage, "recovery_needed");
  assert.equal(result.recommendedNextAction, "run_recovery");
  assert.equal(result.recommendedNextSkill, "codex-project-recovery-scan");
});

test("docs_decision_needed is selected for superpowers repos with docs-only evidence", () => {
  const result = deriveProjectWorkflowGuidance({
    onboardingMode: "superpowers",
    currentAction: {
      state: "ready_for_implementation",
      reasons: ["Baseline and version boundary are present enough for the next implementation instruction."]
    },
    superpowersWorkflow: {
      workflowState: "docs_only",
      hasUnwrittenRepoChanges: false,
      linkedSpecTitle: "Combat Rewrite Spec",
      linkedPlanTitle: null
    },
    conflicts: []
  });

  assert.equal(result.workflowStage, "docs_decision_needed");
  assert.equal(result.recommendedNextAction, "confirm_docs");
  assert.equal(result.recommendedNextSkill, null);
});

test("handoff_needed is selected for superpowers repos that are otherwise ready", () => {
  const result = deriveProjectWorkflowGuidance({
    onboardingMode: "superpowers",
    currentAction: {
      state: "ready_for_implementation",
      reasons: ["Baseline and version boundary are present enough for the next implementation instruction."]
    },
    superpowersWorkflow: {
      workflowState: "planned_not_executed",
      hasUnwrittenRepoChanges: false,
      linkedSpecTitle: "Combat Rewrite Spec",
      linkedPlanTitle: "Combat Rewrite Plan"
    },
    conflicts: []
  });

  assert.equal(result.workflowStage, "handoff_needed");
  assert.equal(result.recommendedNextAction, "run_handoff");
  assert.equal(result.recommendedNextSkill, "codex-project-handoff");
});
```

- [ ] **Step 2: Run the new unit test and verify it fails**

Run: `node --test src/lib/project-workflow-guidance.test.js`
Expected: FAIL because `src/lib/project-workflow-guidance.js` does not exist yet.

- [ ] **Step 3: Add a failing regression expectation for closeout guidance**

```js
assert.equal(refreshed.summary.workflowStage, "closeout_needed");
assert.equal(refreshed.summary.recommendedNextAction, "run_closeout");
assert.equal(refreshed.summary.recommendedNextSkill, "codex-task-closeout-writeback");
assert.ok(
  refreshed.detail.views.instructionCenter.workflowGuidance?.recommendedNextReason.includes("formal"),
  "instruction center should explain why closeout is the next action"
);
assert.equal(
  refreshed.detail.views.onboarding.workflowGuidance?.workflowStage,
  "closeout_needed"
);
```

- [ ] **Step 4: Add a failing regression expectation for handoff guidance**

```js
const handoffGuided = await requestJson(`/api/projects/${created.project.id}/refresh`, {
  method: "POST"
});

assert.equal(handoffGuided.summary.workflowStage, "handoff_needed");
assert.equal(handoffGuided.summary.recommendedNextAction, "run_handoff");
assert.equal(handoffGuided.summary.recommendedNextSkill, "codex-project-handoff");
assert.ok(
  handoffGuided.detail.views.instructionCenter.workflowGuidance?.recommendedNextAfter.includes("implementation"),
  "handoff guidance should describe the next stage after handoff"
);
```

- [ ] **Step 5: Add a failing frontend smoke assertion for workflow guidance visibility**

```js
assert.ok(
  detailHtml.includes("Next Action") || detailHtml.includes("下一步动作"),
  "overview should render workflow guidance"
);
assert.ok(
  detailHtml.includes("codex-project-handoff") || detailHtml.includes("codex-task-closeout-writeback"),
  "workflow guidance should surface the recommended repo-local skill when relevant"
);
```

- [ ] **Step 6: Run regression and smoke checks to verify the new expectations fail**

Run: `npm.cmd run test:regression:windows`
Expected: FAIL because workflow guidance summary/detail fields do not exist yet.

Run: `npm.cmd run test:smoke:frontend`
Expected: FAIL because the UI does not yet render a workflow guidance card.

- [ ] **Step 7: Commit the red tests**

```bash
git add src/lib/project-workflow-guidance.test.js scripts/regression.windows.js scripts/frontend.smoke.js
git commit -m "test: cover monitored project workflow guidance"
```

## Task 2: Implement Backend Workflow Stage Derivation

**Files:**
- Create: `src/lib/project-workflow-guidance.js`
- Create: `src/lib/project-workflow-guidance.test.js`

- [ ] **Step 1: Write the minimal workflow derivation helper**

```js
const STAGE_PRIORITY = [
  "blocked",
  "closeout_needed",
  "recovery_needed",
  "docs_decision_needed",
  "handoff_needed",
  "ready_for_implementation"
];

function deriveProjectWorkflowGuidance(input = {}) {
  const onboardingMode = input.onboardingMode || "standard";
  const currentAction = input.currentAction || {};
  const superpowersWorkflow = input.superpowersWorkflow || {};
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
  const pendingDecisions = Array.isArray(input.pendingDecisions) ? input.pendingDecisions : [];

  const candidates = [];

  if (currentAction.state === "needs_human_decision" || conflicts.some((item) => item.level === "high") || pendingDecisions.length) {
    candidates.push(buildGuidance("blocked", {
      action: "resolve_blocker",
      skill: null,
      reason: "High-priority conflicts or unresolved human decisions still block the next repo action.",
      after: "Resolve the blocker, then re-evaluate workflow stage."
    }));
  }

  if (superpowersWorkflow.hasUnwrittenRepoChanges || superpowersWorkflow.workflowState === "repo_changed_without_closeout") {
    candidates.push(buildGuidance("closeout_needed", {
      action: "run_closeout",
      skill: "codex-task-closeout-writeback",
      reason: "Repo-visible changes exist without a newer formal closeout record.",
      after: "Write back project_state.json and runs/*.json, then re-check readiness."
    }));
  }

  if (["needs_baseline", "needs_version_definition"].includes(currentAction.state)) {
    candidates.push(buildGuidance("recovery_needed", {
      action: "run_recovery",
      skill: "codex-project-recovery-scan",
      reason: "Baseline or version state is still too incomplete for safe implementation guidance.",
      after: "Recover control-state first, then re-evaluate docs or handoff."
    }));
  }

  if (onboardingMode === "superpowers" && ["docs_only", "insufficient_evidence"].includes(superpowersWorkflow.workflowState) && currentAction.state === "ready_for_implementation") {
    candidates.push(buildGuidance("docs_decision_needed", {
      action: "confirm_docs",
      skill: null,
      reason: "Superpowers workflow-defining docs are still missing or incomplete for the intended next work.",
      after: "Confirm specs/plans, then run handoff."
    }));
  }

  if (onboardingMode === "superpowers" && currentAction.state === "ready_for_implementation") {
    candidates.push(buildGuidance("handoff_needed", {
      action: "run_handoff",
      skill: "codex-project-handoff",
      reason: "Control-state and workflow docs are present enough that implementation readiness should now be judged by handoff.",
      after: "If handoff confirms readiness, continue with implementation and closeout afterward."
    }));
  }

  if (currentAction.state === "ready_for_implementation" && onboardingMode !== "superpowers") {
    candidates.push(buildGuidance("ready_for_implementation", {
      action: "start_implementation",
      skill: null,
      reason: "No higher-priority workflow blockers are active.",
      after: "Implement the current slice and then close out formally."
    }));
  }

  return chooseGuidance(candidates);
}
```

- [ ] **Step 2: Add the helper utilities used by the tests**

```js
function buildGuidance(stage, config) {
  return {
    workflowStage: stage,
    recommendedNextAction: config.action,
    recommendedNextSkill: config.skill,
    recommendedNextReason: config.reason,
    recommendedNextAfter: config.after,
    workflowBlockingItems: [config.reason]
  };
}

function chooseGuidance(candidates) {
  const fallback = buildGuidance("ready_for_implementation", {
    action: "start_implementation",
    skill: null,
    reason: "No blocking workflow conditions were found.",
    after: "Continue implementation and write back formal closeout evidence afterward."
  });

  if (!candidates.length) {
    return fallback;
  }

  return [...candidates].sort(
    (left, right) => STAGE_PRIORITY.indexOf(left.workflowStage) - STAGE_PRIORITY.indexOf(right.workflowStage)
  )[0];
}

module.exports = {
  deriveProjectWorkflowGuidance
};
```

- [ ] **Step 3: Run the unit tests and verify they pass**

Run: `node --test src/lib/project-workflow-guidance.test.js`
Expected: PASS

- [ ] **Step 4: Commit the backend stage derivation helper**

```bash
git add src/lib/project-workflow-guidance.js src/lib/project-workflow-guidance.test.js
git commit -m "feat: derive monitored project workflow guidance"
```

## Task 3: Integrate Workflow Guidance Into State Generation

**Files:**
- Create: `src/lib/state-generator-workflow-guidance.js`
- Modify: `src/lib/state-generator.js`
- Modify: `src/lib/state-generator-superpowers.js`

- [ ] **Step 1: Create an adapter that converts workflow guidance into summary and view fields**

```js
const { deriveProjectWorkflowGuidance } = require("./project-workflow-guidance");

function buildWorkflowGuidanceState(projectRecord, projectState, overviewSources, conflicts, summary, baseInstructionCenter) {
  const guidance = deriveProjectWorkflowGuidance({
    onboardingMode: projectRecord.onboardingMode || (projectRecord.useSuperpowers ? "superpowers" : "standard"),
    currentAction: {
      state: summary.currentActionState,
      reasons: summary.currentActionReasons,
      secondaryConditions: summary.secondaryConditions
    },
    superpowersWorkflow: overviewSources.superpowers?.workflow || {},
    conflicts,
    pendingDecisions: baseInstructionCenter.pendingDecisions || []
  });

  return {
    guidance,
    summaryFields: {
      workflowStage: guidance.workflowStage,
      recommendedNextAction: guidance.recommendedNextAction,
      recommendedNextSkill: guidance.recommendedNextSkill,
      recommendedNextReason: guidance.recommendedNextReason
    }
  };
}
```

- [ ] **Step 2: Move instruction-center and onboarding augmentation into the new adapter**

```js
function withWorkflowGuidanceInstructionCenter(baseInstructionCenter, guidance) {
  return {
    ...baseInstructionCenter,
    workflowGuidance: guidance,
    firstActionHint: guidance.recommendedNextReason,
    primaryType: mapStageToInstructionType(guidance.workflowStage, baseInstructionCenter.primaryType)
  };
}

function buildWorkflowOnboardingView(projectRecord, baseOnboardingView, guidance) {
  return {
    ...baseOnboardingView,
    workflowGuidance: guidance,
    onboardingMode: projectRecord.onboardingMode || "standard"
  };
}
```

- [ ] **Step 3: Wire the new helper into `state-generator.js` while shrinking the monolith**

```js
const {
  buildWorkflowGuidanceState,
  buildWorkflowOnboardingView,
  withWorkflowGuidanceInstructionCenter
} = require("./state-generator-workflow-guidance");

const instructionCenter = buildInstructionCenter(projectState, overviewSources, conflicts, summary);
const workflowGuidanceState = buildWorkflowGuidanceState(
  projectRecord,
  projectState,
  overviewSources,
  conflicts,
  summary,
  instructionCenter
);

Object.assign(summary, workflowGuidanceState.summaryFields);

detail.views.instructionCenter = withWorkflowGuidanceInstructionCenter(
  instructionCenter,
  workflowGuidanceState.guidance
);
detail.views.onboarding = buildWorkflowOnboardingView(
  projectRecord,
  buildOnboardingView(projectRecord),
  workflowGuidanceState.guidance
);
```

- [ ] **Step 4: Align Superpowers pending-review/instruction signals with the new stage model**

```js
function buildSuperpowersPendingReviewItems(overviewSources, workflowGuidance = null) {
  const workflow = overviewSources.superpowers?.workflow || {};
  if (!workflow.hasUnwrittenRepoChanges) {
    return [];
  }

  return [
    {
      id: "superpowers-writeback-drift",
      label: "Repo changed without a newer Superpowers closeout run",
      detail: `Current workflow stage: ${(workflowGuidance && workflowGuidance.workflowStage) || "closeout_needed"}. Write back project_state.json and append a new runs/*.json record before continuing.`,
      viewId: "instruction-center",
      severity: "high"
    }
  ];
}
```

- [ ] **Step 5: Run unit and regression checks to verify the new summary/detail fields**

Run: `node --test src/lib/project-workflow-guidance.test.js`
Expected: PASS

Run: `npm.cmd run test:regression:windows`
Expected: still FAIL, but now on missing browser rendering rather than missing summary/detail workflow fields.

- [ ] **Step 6: Commit the state-generation integration**

```bash
git add src/lib/state-generator-workflow-guidance.js src/lib/state-generator.js src/lib/state-generator-superpowers.js
git commit -m "feat: integrate monitored project workflow guidance"
```

## Task 4: Render Workflow Guidance In Overview, Instruction Center, And Onboarding

**Files:**
- Create: `public/app-views-workflow.js`
- Modify: `public/app-views-core.js`
- Modify: `public/app-views-superpowers.js`
- Modify: `scripts/frontend.smoke.js`

- [ ] **Step 1: Create a focused browser helper for workflow cards**

```js
import { escapeHtml, renderStatusPill, renderTag } from "./app-utils.js";

export function renderWorkflowGuidanceCard(guidance) {
  if (!guidance?.workflowStage) {
    return "";
  }

  return `
    <div class="data-row">
      <div>
        <strong>Next Action</strong>
        <small>${escapeHtml(guidance.recommendedNextReason || "No workflow guidance available.")}</small>
      </div>
      <div class="pill-list">
        ${renderStatusPill(guidance.workflowStage)}
        ${guidance.recommendedNextSkill ? renderTag(guidance.recommendedNextSkill, "source-neutral") : ""}
      </div>
    </div>
  `;
}

export function renderWorkflowGuidanceDetails(guidance) {
  if (!guidance?.workflowStage) {
    return "";
  }

  return `
    <div class="data-list">
      <div class="data-row"><div><strong>Action</strong><small>${escapeHtml(guidance.recommendedNextAction || "none")}</small></div></div>
      <div class="data-row"><div><strong>After</strong><small>${escapeHtml(guidance.recommendedNextAfter || "Re-evaluate workflow state.")}</small></div></div>
    </div>
  `;
}
```

- [ ] **Step 2: Use the new helper in overview, instruction-center, and onboarding rendering**

```js
import {
  renderWorkflowGuidanceCard,
  renderWorkflowGuidanceDetails
} from "./app-views-workflow.js";

// overview summary card
<div class="data-list">
  ${renderSuperpowersWorkflowSummary(snapshot.summary)}
  ${renderWorkflowGuidanceCard(snapshot.detail?.views?.instructionCenter?.workflowGuidance)}
  ${renderSuperpowersDriftHint(snapshot.summary)}
</div>

// instruction center
${renderWorkflowGuidanceCard(view.workflowGuidance)}
${renderWorkflowGuidanceDetails(view.workflowGuidance)}

// onboarding
${renderWorkflowGuidanceCard(onboarding.workflowGuidance)}
${renderWorkflowGuidanceDetails(onboarding.workflowGuidance)}
```

- [ ] **Step 3: Keep file sizes healthy by removing inline workflow markup from `app-views-core.js`**

```js
// Remove duplicated inline rows from app-views-core.js and delegate to app-views-workflow.js.
// The result should reduce app-views-core.js back under the 700-line repo limit.
```

- [ ] **Step 4: Update frontend smoke coverage for the new guidance**

```js
assert.ok(
  detailHtml.includes("Next Action") || detailHtml.includes("下一步动作"),
  "workflow guidance title should render in the detail view"
);
assert.ok(
  detailHtml.includes("run_handoff") || detailHtml.includes("run_closeout") || detailHtml.includes("start_implementation"),
  "workflow guidance should expose a recommended next action"
);
```

- [ ] **Step 5: Run smoke and regression checks and verify they pass**

Run: `npm.cmd run test:smoke:frontend`
Expected: PASS

Run: `npm.cmd run test:regression:windows`
Expected: PASS

- [ ] **Step 6: Commit the workflow guidance UI**

```bash
git add public/app-views-workflow.js public/app-views-core.js public/app-views-superpowers.js scripts/frontend.smoke.js scripts/regression.windows.js
git commit -m "feat: render monitored project workflow guidance"
```

## Task 5: Update Docs And Run Final Verification

**Files:**
- Modify: `docs/superpowers/repo-mechanism-map.md`

- [ ] **Step 1: Update the mechanism map with the new workflow-guidance path**

```md
### `src/lib/project-workflow-guidance.js`

- Converts current action analysis, Superpowers workflow evidence, and conflict signals into a stable workflow stage and recommended next action.

### `src/lib/state-generator-workflow-guidance.js`

- Adapts workflow guidance into summary fields, instruction-center guidance, and onboarding summaries.

### `public/app-views-workflow.js`

- Renders compact workflow stage and next-action cards for overview, instruction-center, and onboarding.
```

- [ ] **Step 2: Run diff/merge-marker hygiene checks**

Run: `git diff --check`
Expected: no diff-check failures

Run: `rg "^(<<<<<<<|=======|>>>>>>>)" -n .`
Expected: no matches

- [ ] **Step 3: Run the full verification suite**

Run: `node --test src/lib/project-workflow-guidance.test.js`
Expected: PASS

Run: `npm.cmd run test:smoke:frontend`
Expected: PASS

Run: `npm.cmd run test:regression:windows`
Expected: PASS

- [ ] **Step 4: Commit the docs and verification-backed finish**

```bash
git add docs/superpowers/repo-mechanism-map.md
git commit -m "docs: document monitored project workflow guidance"
```
