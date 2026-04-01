# Dashboard Superpowers Workflow

This workflow applies to `project_management_dashboard` itself.

It does not authorize changes to monitored project business code.
It does not change the dashboard steady-state read-only aggregation boundary or the dashboard steady-state source-of-truth / read-write boundary.

For repo context, read `docs/superpowers/repo-mechanism-map.md`.

## Main Path

Use the main path for concrete boundary-changing work, including:

- data structures or state models
- API contracts
- monitored-project integration protocol
- scaffold injection behavior, including repo-local `AGENTS.md` rules or repo-local skill generation
- steady-state source-of-truth / read-write boundary
- intake, recovery, refresh, maintenance, watcher, or snapshot-generation semantics
- cross-module or core control-plane capabilities

Main-path work follows `spec -> plan -> implementation`.
If a task may cross one of these boundaries, treat it as main-path work.

## Fast Path

Use the fast path only for low-risk work that does not change:

- data shape
- API shape
- monitored-project integration protocol
- steady-state source-of-truth / read-write boundary

Allowed fast-path examples include:

- copy and documentation edits
- presentation-only UI adjustments
- local interaction fixes in existing UI flows without data/API changes
- logging, guard-clause, and low-risk maintenance refactors

Fast-path work goes directly to implementation.

## Default Rule

If there is any ambiguity, default to the main path.

## Working Sequence

1. Read `AGENTS.md`.
2. Read this file.
3. Classify the task.
4. If main-path, write a spec under `docs/superpowers/specs/`, get approval, then write a plan under `docs/superpowers/plans/`, then implement.
5. If fast-path, implement directly and explain in the closeout why the task qualified for the fast path.
