# Dashboard Superpowers Workflow Design

**Date:** 2026-04-01

## Summary

This design switches the `project_management_dashboard` repo itself onto a Superpowers-compatible workflow in mixed mode.

The repo will use two paths:

- Main path: boundary-changing work must go through `docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md` before implementation.
- Fast path: small changes that do not alter data structures, API contracts, monitored-project integration protocols, or steady-state boundaries may be implemented directly.

This change applies only to the dashboard repo itself. It does not change monitored project business code, and it does not change the dashboard's steady-state source-of-truth boundary.

## Goals

- Make `project_management_dashboard` itself follow a stable Superpowers workflow.
- Keep the workflow aligned with the dashboard's existing treatment of monitored repos that use Superpowers.
- Preserve a lightweight path for low-risk maintenance work.
- Make the decision boundary explicit in repo-level documentation so future collaborators do not rely on chat memory.

## Non-Goals

- Do not modify monitored project business code as part of this workflow switch.
- Do not change steady-state behavior that only reads repo-side source state and writes derived cache locally.
- Do not add UI prompts, product affordances, or automated enforcement in this phase.
- Do not redesign current dashboard backend or frontend behavior in this phase.

## Current Repo Facts

- The repo already models Superpowers as a first-class concept for monitored projects.
- The repo already reads `docs/superpowers/specs/**` and `docs/superpowers/plans/**` as supplemental sources for monitored projects.
- The repo already watches Superpowers spec and plan directories in monitored repos.
- The repo already injects repo-local workflow skills for monitored repos.
- The dashboard repo itself does not yet have its own documented Superpowers workflow entrypoint.

## Proposed Architecture

### 1. Repo-Level Stable Rules

`AGENTS.md` remains the source for long-lived repo rules.

It will be extended to state that this repo uses a mixed-mode Superpowers workflow:

- boundary-changing work must start with a spec
- approved spec work must produce a plan before implementation
- low-risk local changes may use the fast path when they stay within the allowed boundaries
- when a change is ambiguous, default to the spec/plan path

`AGENTS.md` will not store temporary project plans, one-off tasks, or current work-package context.

### 2. Workflow Documentation Root

`docs/superpowers/` will become the workflow documentation root for this repo.

It will contain:

- `README.md` as the workflow entrypoint
- `specs/` for approved design documents
- `plans/` for implementation plans

This keeps stable repo rules in `AGENTS.md` and keeps workflow artifacts under `docs/superpowers/`.

### 3. Mixed-Mode Decision Boundary

The repo uses two explicit change classes.

Changes that must go through spec then plan:

- changes to dashboard data structures or state models
- changes to API contracts
- changes to monitored-project integration protocol
- changes to repo scaffold injection behavior, including `AGENTS.md` injection or repo-local skill generation rules
- changes to steady-state read/write boundaries
- changes to intake, recovery, refresh, maintenance, watcher, or snapshot-generation semantics
- new product capabilities that span multiple modules or change core control-plane behavior

Changes allowed on the fast path:

- copy, wording, comments, and documentation tweaks
- styling and presentation-only adjustments
- local interaction fixes that do not change API or data shape
- low-risk maintenance changes such as logging improvements, guard clauses, or small refactors with unchanged external behavior
- test and script maintenance that does not alter integration protocol or core workflow boundary

When a contributor is unsure whether a task affects data shape, API, monitored-project protocol, or steady-state boundary, the task must use the spec/plan path.

### 4. Operating Workflow

Contributors working in this repo should follow this sequence:

1. Read `AGENTS.md`.
2. Read `docs/superpowers/README.md`.
3. Classify the task as boundary-changing or fast-path.
4. If boundary-changing, write a spec under `docs/superpowers/specs/`, get approval, then write a plan under `docs/superpowers/plans/`, then implement.
5. If fast-path, implement directly and explain in the closeout why the task qualified for the fast path.
6. If unsure, use the spec/plan path.

## File Responsibilities

### `AGENTS.md`

- Stores stable repo-level workflow rules.
- Defines the mixed-mode boundary in durable language.
- States that ambiguous changes default to spec/plan.

### `docs/superpowers/README.md`

- Explains how to choose between the main path and fast path.
- Points contributors to `specs/` and `plans/`.
- Clarifies that this workflow currently governs the dashboard repo itself.

### `docs/superpowers/specs/*.md`

- Stores approved design decisions for boundary-changing work.
- Captures rationale, scope, non-scope, architecture, and acceptance targets before planning.

### `docs/superpowers/plans/*.md`

- Stores implementation plans derived from approved specs.
- Breaks approved work into executable tasks before coding begins.

## Data Flow and Decision Flow

This phase changes workflow guidance, not runtime data flow.

The only flow being added is a contributor decision flow:

1. Task enters repo workflow.
2. Contributor checks repo rules and workflow entry docs.
3. Contributor classifies the task.
4. Boundary-changing work produces spec then plan before code.
5. Fast-path work may proceed directly with explicit closeout reasoning.

No monitored repo runtime contract changes in this phase.

## Error Handling and Edge Cases

- If repo facts conflict with chat instructions, repo facts remain authoritative and the conflict must be surfaced.
- If a task appears small but touches API shape, state shape, or monitored-project protocol, it is not fast-path.
- If a change begins as fast-path but expands into boundary-changing work during implementation, work should pause and move back to spec/plan.
- If future automation or UI enforcement is added, that should be treated as a separate boundary-changing feature with its own spec.

## Testing and Validation

This phase is documentation and workflow setup only.

Acceptance criteria for the implementation phase:

- the repo has a documented `docs/superpowers/` entrypoint
- `AGENTS.md` clearly states the mixed-mode workflow boundary
- the boundary examples are specific enough that future collaborators can classify ordinary tasks without guessing
- the documentation clearly says this rollout applies to the dashboard repo itself and does not change monitored project business code

## Risks

- The fast path could become too broad if the boundary language is vague.
- Contributors may confuse this repo-self workflow with monitored-project onboarding rules.
- Without UI or automation, the workflow depends on clear written guidance and disciplined usage.

## Recommendation

Implement the workflow switch as a documentation-first, rules-first change for the dashboard repo.

This keeps the current control-plane runtime unchanged while aligning the repo's internal collaboration process with the Superpowers concepts it already applies to monitored projects.
