# Superpowers Monitored Project Aggregation Design

**Date:** 2026-04-01

## Summary

This design extends the dashboard aggregation layer so monitored projects that use Superpowers are understood more accurately by the control plane.

The dashboard should treat Superpowers projects as more than "repos that happen to contain `docs/superpowers/`". It should connect three evidence layers:

- repo-side source-state writeback under `/.codex-control/project_state.json` and `/.codex-control/runs/*.json`
- workflow context under `docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md`
- controlled repo-visible fallback signals such as recent git/repo changes when formal closeout writeback is missing

The key rule is that formal writeback remains the primary source of truth. Git and repo-visible fallback signals are secondary and must be labeled as inferred rather than formal execution evidence.

## Goals

- Let the dashboard answer "what changed in this Superpowers monitored project" more reliably.
- Distinguish between formally written-back execution evidence and inferred repo-change evidence.
- Connect recent execution evidence to the surrounding Superpowers workflow context.
- Improve current-action and pending-review reasoning for monitored projects that use Superpowers.

## Non-Goals

- Do not modify monitored project business code.
- Do not require the dashboard to auto-write closeout runs into monitored repos.
- Do not build a full git diff visualizer in this phase.
- Do not treat git fallback evidence as equal to `/.codex-control/runs/*.json`.

## Current Repo Facts

- The dashboard already scaffolds repo-local workflow skills into monitored repos, including `codex-project-handoff`, `codex-task-closeout-writeback`, and `codex-project-recovery-scan`.
- The dashboard already watches `docs/superpowers/specs/**` and `docs/superpowers/plans/**` in monitored repos.
- The dashboard already reads Superpowers docs as supplemental sources during aggregation.
- The dashboard already reads repo-side source-state files and recent run records.
- The dashboard does not yet connect recent run evidence, Superpowers workflow state, and repo-visible fallback change signals into one coherent monitored-project summary.

## Source Priority

The dashboard should evaluate monitored Superpowers projects with this priority order:

1. Formal repo-side source-state writeback:
   - `/.codex-control/project_state.json`
   - `/.codex-control/runs/*.json`
2. Superpowers workflow documents:
   - `docs/superpowers/specs/*.md`
   - `docs/superpowers/plans/*.md`
3. Repo-visible fallback evidence:
   - recent commit metadata
   - working tree dirtiness
   - recent source file modification signals
   - lightweight changed-file summaries when available

Priority rules:

- Formal run writeback is the primary execution truth.
- Superpowers docs provide workflow context, not proof that implementation is complete.
- Git/repo fallback only fills visibility gaps when formal writeback is missing or stale.
- Fallback evidence must be marked as inferred, not formal.

## Proposed Architecture

### 1. Repo Change Fallback Collection

`src/lib/project-reader.js` should collect a compact set of repo-visible fallback change signals for each monitored project.

This collection should stay lightweight and bounded. The goal is not to inspect business code deeply, but to answer whether there was likely a recent repo change that has not yet been reflected in formal writeback.

Suggested fields:

- latest commit hash
- latest commit summary
- latest commit timestamp
- working tree dirty flag
- candidate changed-file summary
- latest repo-visible source update timestamp

This data must be safe to compute during aggregation and must not require changing monitored repos.

### 2. Superpowers Workflow State Derivation

`src/lib/project-overview.js` should derive a structured Superpowers workflow state instead of only exposing supplemental doc presence.

The derived state should answer:

- whether specs exist
- whether plans exist
- whether repo-local workflow skills appear to be present
- whether recent formal run evidence exists
- whether recent formal run evidence is newer than surrounding workflow docs
- whether repo-visible changes exist without a corresponding recent formal run
- whether the project appears to be:
  - docs_only
  - planned_not_executed
  - executed_and_written_back
  - repo_changed_without_closeout
  - insufficient_evidence

This derived state should be separate from the raw `superpowers.status` badge so the dashboard can reason with it.

### 3. Linked Evidence Model

The aggregation layer should link recent execution evidence to Superpowers context when possible.

For the latest relevant change window, the dashboard should try to surface:

- latest formal run record title/summary/time
- linked spec title
- linked plan title
- whether the latest repo-visible changes appear unwritten
- whether the latest writeback is stale relative to repo changes

This is not a strict provenance graph. It is a practical linkage model for operator comprehension.

### 4. Dashboard Summary and Detail Fields

`src/lib/state-generator.js` should expose explicit fields for Superpowers monitored-project aggregation, for example:

- `superpowersWorkflowState`
- `latestExecutionEvidenceSource`
- `latestExecutionEvidenceLabel`
- `hasUnwrittenRepoChanges`
- `writebackDrift`
- `linkedSpecTitle`
- `linkedPlanTitle`
- `fallbackRepoChangeSummary`

These fields should be consumed by existing dashboard views rather than forcing a new dedicated product surface in this phase.

## UI/Presentation Direction

This phase should reuse the existing overview-oriented views.

Preferred presentation changes:

- overview: show whether the latest change is formally written back or only inferred
- recent changes: distinguish formal runs from repo fallback signals
- instruction center: tell the operator whether the project likely needs closeout/writeback before further implementation guidance
- pending review: surface "repo changed without closeout run" as a workflow-quality issue when evidence supports it

The UI must clearly distinguish:

- formal writeback evidence
- supplemental workflow context
- inferred repo-change fallback

## Error Handling and Ambiguity Rules

- If formal run evidence exists, do not overwrite it with git fallback interpretations.
- If repo fallback suggests recent changes but repo-side writeback is missing, expose that as drift instead of silently pretending the repo is up to date.
- If Superpowers docs exist but are too weak to infer current workflow state, keep the workflow state conservative.
- If repo-visible evidence is incomplete, prefer `insufficient_evidence` over overconfident classification.

## Testing

This feature should be tested without writing into the real `data/` directory.

Implementation validation should include:

- projects with formal `runs/*.json` closeout and matching Superpowers docs
- projects with specs/plans but no recent run writeback
- projects with repo-visible changes but stale or missing closeout runs
- projects that do not use Superpowers, to confirm no regression in baseline aggregation

## Risks

- Git fallback may be over-trusted if the UI does not clearly label it as inferred.
- Workflow-state derivation could become noisy if it relies on weak heuristics.
- Connecting run/spec/plan context too aggressively could imply causality where only loose temporal association exists.

## Recommendation

Implement a "formal writeback first, inferred repo-change fallback second" aggregation model for Superpowers monitored projects.

This gives the dashboard the ability to notice when a monitored repo has changed without proper closeout while preserving the source-state protocol as the primary truth model.
