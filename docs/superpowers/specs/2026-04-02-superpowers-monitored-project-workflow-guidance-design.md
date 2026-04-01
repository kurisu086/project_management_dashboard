# Superpowers Monitored Project Workflow Guidance Design

## Goal

Let the dashboard translate existing monitored-project state into a clear workflow recommendation so an operator can answer:

- what should happen next
- why that action is preferred
- what must be fixed before implementation can continue
- which workflow stage the monitored repo is currently in

This design focuses on workflow guidance for monitored repos that already participate in the dashboard control-plane and may also use Superpowers docs and repo-local skills.

## Repo Facts

The repo already contains three important pieces of infrastructure:

1. Aggregation already derives Superpowers evidence and writeback drift:
   - `src/lib/superpowers-workflow-state.js`
   - `src/lib/state-generator-superpowers.js`
   - `public/app-views-superpowers.js`
2. Existing control-state guidance already exists in the main summary/detail model:
   - `src/lib/state-generator.js` builds `instructionCenter`, `pendingReview`, `onboarding`, and `currentActionState`
3. Workbench and onboarding paths already persist a stable Superpowers onboarding mode:
   - `src/lib/intake-workbench.js`
   - `src/lib/server-workbench.js`
   - `src/lib/superpowers-onboarding.js`

Today the dashboard can often explain what state a monitored repo is in, but it does not yet consistently translate that state into a single recommended next workflow action.

## Problem

The current UX is still too interpretation-heavy:

- `superpowersWorkflowState` tells the operator what evidence was found, but not the next best action
- `pendingReview` can flag problems such as writeback drift, but does not anchor those problems into a stable workflow stage
- `instructionCenter` can suggest documentation sync in some cases, but not through a general workflow model
- the onboarding and overview surfaces still require the operator to mentally combine baseline gaps, docs gaps, handoff readiness, and writeback drift

This makes it harder to use the dashboard as a control-plane guide for attach, recovery, handoff, closeout, and implementation readiness.

## Desired Outcome

For monitored repos, especially Superpowers repos, the dashboard should produce one stable workflow interpretation:

- current workflow stage
- recommended next action
- recommended next repo-local skill when one exists
- short rationale for that recommendation
- short statement of what should happen after that action completes

The dashboard should not just report evidence. It should translate evidence into a recommended next move.

## Non-Goals

This change does not:

- add one-click execution of repo-local skills from the dashboard
- auto-run recovery, handoff, or closeout inside monitored repos
- replace the existing source-state protocol or truth ordering
- introduce a large new workbench page or a full workflow editor
- redesign monitored-project onboarding

This is a workflow explanation layer, not a workflow automation layer.

## Core Model

### Workflow Stages

The dashboard should derive one of these stages for each monitored repo:

- `blocked`
- `closeout_needed`
- `recovery_needed`
- `docs_decision_needed`
- `handoff_needed`
- `ready_for_implementation`

These stages are intentionally small and ordered by operator priority rather than by every possible repo nuance.

### Stage Priority

When multiple conditions are true, the dashboard should choose the highest-priority stage:

1. `blocked`
2. `closeout_needed`
3. `recovery_needed`
4. `docs_decision_needed`
5. `handoff_needed`
6. `ready_for_implementation`

This preserves the most important workflow rule:
if the repo has already changed without proper closeout, the operator should fix that before treating the repo as ready for more implementation.

## Stage Semantics

### `blocked`

Use when high-severity conflicts or incompatible signals make the next step unsafe.

Examples:

- repo facts conflict with declared control files in a way that changes workflow direction
- high-priority pending review items indicate the operator should not continue blindly
- future repo facts and confirmed Superpowers decisions clearly diverge and the mismatch needs human resolution first

Recommended output:

- action: resolve conflict / request human confirmation
- skill: none
- after: re-evaluate workflow stage

### `closeout_needed`

Use when repo-visible implementation changes exist but formal writeback is missing or stale.

Primary signals:

- `superpowersWorkflowState === "repo_changed_without_closeout"`
- `hasUnwrittenRepoChanges === true`
- `writebackDrift !== "not_applicable"`

Recommended output:

- action: run `codex-task-closeout-writeback`
- skill: `codex-task-closeout-writeback`
- after: re-evaluate for handoff or implementation readiness

### `recovery_needed`

Use when baseline/version/control-state understanding is too incomplete to safely guide implementation.

Primary signals:

- the current control-state analysis already shows baseline or version-definition gaps
- current action analysis is effectively pre-handoff because project understanding is too weak
- missing source-state files or major unknowns would make handoff premature

Recommended output:

- action: run `codex-project-recovery-scan`
- skill: `codex-project-recovery-scan`
- after: rebuild source-state, then re-evaluate docs or handoff

### `docs_decision_needed`

Use when Superpowers workflow-defining documentation is insufficient for the intended next work.

Primary signals:

- Superpowers mode is active and workflow-defining work is implied
- docs evidence is present but incomplete for a next implementation step
- a repo can be read, but specs/plans are not yet sufficient to move toward implementation safely

This stage should not fire for every repo missing docs. It should be used when the guidance layer believes docs are the missing constraint, not when the repo first needs recovery.

Recommended output:

- action: add or confirm `docs/superpowers/specs/*.md` and/or `docs/superpowers/plans/*.md`
- skill: none
- after: run `codex-project-handoff`

### `handoff_needed`

Use when repo understanding and docs are sufficient enough that the next correct action is a readiness judgment.

Primary signals:

- no writeback drift requiring closeout
- no large baseline/version gaps requiring recovery
- no docs-decision gap blocking the next step
- repo-local handoff skill is available and the repo should now be judged for implementation readiness

Recommended output:

- action: run `codex-project-handoff`
- skill: `codex-project-handoff`
- after: either enter implementation or return to the surfaced gap

### `ready_for_implementation`

Use when the dashboard has no higher-priority workflow blockers and the next move is actual implementation.

Recommended output:

- action: enter implementation
- skill: none
- after: complete the task and then run closeout/writeback

## Output Shape

The new workflow guidance layer should derive a compact structure, conceptually similar to:

```json
{
  "workflowStage": "handoff_needed",
  "recommendedNextAction": "run_handoff",
  "recommendedNextSkill": "codex-project-handoff",
  "recommendedNextReason": "Control-state and docs are present, but implementation readiness still needs a handoff judgment.",
  "recommendedNextAfter": "If handoff returns ready_for_implementation, begin implementation and close out afterward.",
  "workflowBlockingItems": [
    "Current repo should be judged for implementation readiness before more coding guidance."
  ]
}
```

Exact field names may vary during implementation, but the model must carry:

- stage
- action
- optional skill name
- reason
- follow-up
- blocking items

## Data Sources

The workflow guidance layer should be derived from existing state, not from new repo writes.

Primary inputs:

- current action analysis already produced in `state-generator.js`
- `instructionCenter`
- `pendingReview`
- Superpowers workflow evidence from `overviewSources.superpowers.workflow`
- current baseline/version gaps and conflicts
- onboarding mode / repo-local skill availability when relevant

Truth ordering does not change:

1. repo-side control files and runs
2. Superpowers specs and plans as workflow context
3. repo-visible fallback evidence

The new layer interprets this data. It does not replace it.

## UI Surfaces

### Instruction Center

This is the primary user-visible surface for the new workflow layer.

It should show:

- current workflow stage
- primary next action
- optional recommended skill
- short why-now explanation
- short what-happens-next explanation

If the current stage is `closeout_needed`, the instruction center should clearly prefer closeout over more implementation guidance.

### Overview / Onboarding Summary

The overview and onboarding surfaces should show a compact workflow summary:

- stage badge
- primary action label
- optional skill tag

This gives the operator immediate orientation without opening a deeper panel first.

### Pending Review

Pending review should stay focused on blocking items, but those items should now align with workflow stage.

Example:

- instead of only saying that writeback drift exists, the dashboard should make clear that the repo is now in `closeout_needed`

## Recommended Action Mapping

The workflow stage should map to a stable recommendation table:

- `blocked` -> resolve conflict / human confirmation
- `closeout_needed` -> `codex-task-closeout-writeback`
- `recovery_needed` -> `codex-project-recovery-scan`
- `docs_decision_needed` -> update/confirm specs or plans
- `handoff_needed` -> `codex-project-handoff`
- `ready_for_implementation` -> implementation

The dashboard should expose the recommendation as guidance only. It should not claim that the step was executed.

## Implementation Shape

To keep the codebase within the existing modular direction:

- derive workflow guidance in a focused backend helper instead of expanding `state-generator.js` with another large conditional block
- adapt existing instruction-center and onboarding/overview view models rather than creating a separate competing system
- add small frontend rendering helpers for the workflow guidance cardlets rather than growing `public/app-views-core.js` with a monolithic section

This keeps the new behavior additive and consistent with the recent extraction of Superpowers-specific helpers.

## Risks

### Risk: Stage logic conflicts with current action analysis

Mitigation:

- treat the workflow guidance layer as a thin interpretation layer over existing control-state analysis
- do not fork an entirely separate readiness system
- prefer using current pending-review/conflict signals as blockers rather than inventing unrelated logic

### Risk: `docs_decision_needed` fires too aggressively

Mitigation:

- only use this stage when the repo is already past recovery-grade uncertainty
- do not treat the mere absence of Superpowers docs as a universal blocker for every monitored repo

### Risk: UI becomes noisy

Mitigation:

- keep the new workflow summary compact
- show one primary action, not a checklist explosion
- let pending review carry detail while overview/instruction center carry direction

## Acceptance Criteria

This design is successful when:

1. the dashboard derives one stable workflow stage for a monitored repo
2. the stage resolves priority conflicts predictably
3. instruction center clearly tells the operator what to do next and why
4. overview/onboarding surfaces expose a compact next-step summary
5. pending review items align with the chosen workflow stage
6. Superpowers writeback drift causes `closeout_needed` instead of vague generic guidance
7. repos that are sufficiently documented but not yet judged enter `handoff_needed`
8. repos with unresolved baseline/version understanding enter `recovery_needed`

## Test Strategy

Implementation should cover at least:

- backend unit coverage for stage derivation priority
- cases for `blocked`, `closeout_needed`, `recovery_needed`, `docs_decision_needed`, `handoff_needed`, and `ready_for_implementation`
- state-generator integration coverage so summary/detail views receive the new workflow guidance fields
- frontend smoke/regression coverage so instruction-center and overview rendering show the recommended next action without breaking existing views
