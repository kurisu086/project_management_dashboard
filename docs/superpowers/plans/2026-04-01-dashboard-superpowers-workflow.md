# Dashboard Superpowers Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the `project_management_dashboard` repo itself onto the approved mixed-mode Superpowers workflow and document the repo's current mechanism for future development.

**Architecture:** This is a documentation-first change. We will keep runtime behavior unchanged while adding a repo-level workflow entrypoint, a developer-facing mechanism map, and stable `AGENTS.md` rules that define when this repo must use spec/plan versus the fast path. The mechanism documentation must reflect the actual codebase: `src/server.js` owns HTTP and project lifecycle, `src/lib/server-workbench.js` and `src/lib/intake-workbench.js` own intake/recovery flows, `src/lib/project-reader.js` + `src/lib/project-overview.js` + `src/lib/state-generator.js` build dashboard state, and the frontend is assembled from `public/app-main.js`, `public/app-shell.js`, `public/app-workbench.js`, and `public/app-views-core.js`.

**Tech Stack:** Node.js built-in HTTP server, CommonJS backend modules, vanilla ES module frontend, JSON control-state files, Windows-native regression scripts.

---

## File Structure

- Create: `docs/superpowers/README.md`
  Responsibility: repo-local Superpowers workflow entrypoint for this dashboard repo.
- Create: `docs/superpowers/repo-mechanism-map.md`
  Responsibility: future-developer mechanism guide summarizing backend flow, state aggregation, frontend composition, test harnesses, and current file hotspots.
- Modify: `AGENTS.md`
  Responsibility: stable repo rules for mixed-mode Superpowers usage in this repo.
- Reference only: `docs/superpowers/specs/2026-04-01-dashboard-superpowers-workflow-design.md`
  Responsibility: approved design source for this plan.

## Repo Mechanism Notes To Preserve In Docs

- The server entrypoint is `src/server.js`; it boots the HTTP server, loads registry/workbench state, attaches watchers, and exposes `/api/projects`, `/api/workbench`, refresh, maintenance, and client-log endpoints.
- Project attach flow runs through `addProject()` in `src/server.js`, which calls `ensureProjectScaffold()` in `src/lib/project-reader.js`, refreshes a snapshot, and attaches `WatchManager`.
- Intake and recovery flows live in `src/lib/server-workbench.js` and `src/lib/intake-workbench.js`; they persist dashboard-local draft/session state under `data/intake-workbench.json`.
- Repo-side source-state scanning and merge logic is concentrated in `src/lib/project-reader.js` and `src/lib/project-overview.js`.
- Derived dashboard-local cache generation is concentrated in `src/lib/state-generator.js`.
- Frontend orchestration lives in `public/app-main.js`; shell chrome is in `public/app-shell.js`; intake/recovery UI lives in `public/app-workbench.js`; most detail view rendering lives in `public/app-views-core.js`.
- Regression coverage currently comes from `scripts/regression.windows.js` and `scripts/frontend.smoke.js`, both of which use isolated temp data roots and must remain isolated.
- Current repo rule drift already exists: `src/lib/state-generator.js`, `src/lib/project-overview.js`, `public/app-views-core.js`, and `src/server.js` are over the 700-line `.js` limit declared in `AGENTS.md`. The implementation should document this drift and tighten the rule for future touches without trying to refactor those files as part of this workflow-only change.

### Task 1: Add The Superpowers Entry README

**Files:**
- Create: `docs/superpowers/README.md`
- Reference: `docs/superpowers/specs/2026-04-01-dashboard-superpowers-workflow-design.md`

- [ ] **Step 1: Draft the workflow entrypoint content**

```md
# Dashboard Superpowers Workflow

This directory defines how `project_management_dashboard` itself uses the Superpowers workflow.

## Scope

This workflow currently governs this dashboard repo itself.

- It does apply to changes inside `project_management_dashboard`.
- It does not directly authorize changes to monitored project business code.
- It does not change the dashboard's steady-state read-only aggregation boundary.

## Two Paths

### Main Path: spec -> plan -> implementation

Use the main path when work changes any of the following:

- dashboard data structures or state models
- API contracts
- monitored-project integration protocol
- scaffold injection behavior, including repo-side `AGENTS.md` rules or repo-local skill generation
- steady-state read/write boundaries
- intake, recovery, refresh, maintenance, watcher, or snapshot-generation semantics
- cross-module or core control-plane capabilities

### Fast Path: direct implementation

Direct implementation is allowed only for low-risk work that does not change:

- data shape
- API shape
- monitored-project integration protocol
- steady-state source-of-truth boundaries

Typical fast-path examples:

- copy and documentation edits
- presentation-only UI adjustments
- local interaction fixes without data/API contract changes
- logging, guard clauses, and low-risk maintenance refactors with unchanged external behavior

## Default Rule

If there is any doubt about whether a task changes data shape, API shape, monitored-project protocol, or steady-state boundaries, use the main path.

## Working Sequence

1. Read `AGENTS.md`.
2. Read this file.
3. Classify the task as main-path or fast-path.
4. If main-path, write a spec under `docs/superpowers/specs/`, get approval, then write a plan under `docs/superpowers/plans/`.
5. If fast-path, implement directly and explain in the closeout why the task qualified for the fast path.

## Repo Context

For the current mechanism map of this dashboard, read `docs/superpowers/repo-mechanism-map.md`.
```

- [ ] **Step 2: Create the README with the approved content**

Use `apply_patch` to create `docs/superpowers/README.md` with the content from Step 1.

- [ ] **Step 3: Verify the README covers the required boundary language**

Run: `Get-Content docs\superpowers\README.md`
Expected:
- The file explicitly says this workflow applies to `project_management_dashboard`.
- The file contains both the main path and fast path.
- The file says ambiguity defaults to the main path.

- [ ] **Step 4: Commit the README**

```bash
git add docs/superpowers/README.md
git commit -m "docs: add dashboard superpowers workflow entrypoint"
```

### Task 2: Write The Repo Mechanism Map

**Files:**
- Create: `docs/superpowers/repo-mechanism-map.md`
- Reference: `src/server.js`
- Reference: `src/lib/server-workbench.js`
- Reference: `src/lib/intake-workbench.js`
- Reference: `src/lib/project-reader.js`
- Reference: `src/lib/project-overview.js`
- Reference: `src/lib/state-generator.js`
- Reference: `public/app-main.js`
- Reference: `public/app-shell.js`
- Reference: `public/app-workbench.js`
- Reference: `public/app-views-core.js`
- Reference: `scripts/regression.windows.js`
- Reference: `scripts/frontend.smoke.js`

- [ ] **Step 1: Draft the mechanism guide from current repo facts**

```md
# Dashboard Repo Mechanism Map

This note summarizes how `project_management_dashboard` currently works so future development can start from repo facts instead of guesswork.

## Runtime Shape

- `src/server.js` boots the HTTP server on the configured port and serves the static frontend from `public/`.
- Runtime data lives under `data/` by default, or under `CODEX_CONTROL_DATA_DIR` when tests override it.
- Dashboard-local state includes the project registry, workbench draft state, operation log, and per-project derived cache.

## Backend Responsibility Map

### `src/server.js`

- boots the server
- loads registry, diagnostic history, and workbench state
- attaches watchers for registered projects
- exposes project APIs, workbench APIs, maintenance APIs, and static asset serving

### `src/lib/project-reader.js`

- scaffolds repo-side control files for attached projects
- injects repo-local skills and `AGENTS.md` / `.gitignore` control blocks
- reads project snapshots from repo-side source state
- produces project config and watch manifest files

### `src/lib/project-overview.js`

- scans repo-visible signals
- merges repo-side declared state, repo-derived facts, and optional Superpowers supplemental docs
- normalizes baseline, version, game, and decision views

### `src/lib/state-generator.js`

- normalizes `project_state.json`
- builds summary/detail payloads used by the UI
- writes dashboard-local `current_state.json` and `current_state.md` cache files
- assembles navigation, view models, pending review prompts, and visualization payloads

### `src/lib/server-workbench.js` and `src/lib/intake-workbench.js`

- manage new-project filing and recovery session state
- generate GPT and Codex prompt bundles
- preview and apply explicit writeback into repo-side source-state files

## Project Lifecycle

1. A repo is attached through `/api/projects` or a workbench flow.
2. The dashboard validates the path and confirms it is a Windows-native git repo.
3. `ensureProjectScaffold()` creates repo-side control assets and local skills.
4. `readProjectSnapshot()` reads repo-side source state plus supplemental docs.
5. `state-generator.js` derives dashboard summary/detail and local cache artifacts.
6. `WatchManager` watches source files and refreshes derived cache on change.

## Frontend Responsibility Map

### `public/app-main.js`

- owns app state, boot, event wiring, API calls, and view switching

### `public/app-shell.js`

- renders the top-level shell, project list, overview strip, header, nav, and pending-review overlay content

### `public/app-workbench.js`

- renders the new-project filing, recovery, and GPT-assist workflow views

### `public/app-views-core.js`

- renders most project detail views such as overview, modules, tech, risks, verification, and onboarding

## Tests

- `scripts/regression.windows.js` verifies attach, refresh, workbench, cleanup, and cache behavior with isolated temp data.
- `scripts/frontend.smoke.js` verifies frontend shells, prompt exposure, and basic workflow endpoints with isolated temp data.

## Current Hotspots

The repo currently has several oversized `.js` files relative to the 700-line rule in `AGENTS.md`:

- `src/lib/state-generator.js`
- `src/lib/project-overview.js`
- `public/app-views-core.js`
- `src/server.js`

Future feature work that touches these files should split by responsibility before adding substantial new logic.

## Safe Mental Model For Future Changes

- treat `src/server.js` as the transport and lifecycle layer
- treat `project-reader.js` + `project-overview.js` + `state-generator.js` as the source-state aggregation pipeline
- treat `server-workbench.js` + `intake-workbench.js` as the intake/recovery workflow engine
- treat `app-main.js` as the browser orchestrator and the rest of `public/` as render helpers
```

- [ ] **Step 2: Create the mechanism guide**

Use `apply_patch` to create `docs/superpowers/repo-mechanism-map.md` with the content from Step 1.

- [ ] **Step 3: Verify the mechanism guide reflects current repo facts**

Run: `Get-Content docs\superpowers\repo-mechanism-map.md`
Expected:
- The file names the actual backend and frontend hotspots listed above.
- The file explicitly documents the attach -> scaffold -> snapshot -> cache -> watch flow.
- The file explicitly documents current oversized-file drift instead of hiding it.

- [ ] **Step 4: Commit the mechanism guide**

```bash
git add docs/superpowers/repo-mechanism-map.md
git commit -m "docs: add dashboard mechanism map"
```

### Task 3: Update Stable Repo Rules In AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Extend AGENTS.md with stable mixed-mode Superpowers rules**

Insert the following stable rules after the existing rule list:

```md
8. This repo uses a mixed-mode Superpowers workflow for changes inside `project_management_dashboard` itself.
9. Changes that affect data structures, API contracts, monitored-project integration protocol, scaffold injection rules, steady-state read/write boundaries, or core intake/recovery/refresh/watch semantics must go through `docs/superpowers/specs/` and `docs/superpowers/plans/` before implementation.
10. Low-risk changes that do not affect those boundaries may use the fast path, but the closeout must state why the task qualified.
11. If it is unclear whether a task changes those boundaries, default to the spec/plan path.
12. Read `docs/superpowers/README.md` before classifying work in this repo.
13. When touching an already-oversized `.js` file, split by responsibility before adding substantial new logic.
```

- [ ] **Step 2: Apply the AGENTS.md edit without adding temporary context**

Use `apply_patch` to append the new stable rules while preserving the existing rule style and keeping `AGENTS.md` free of one-off task state.

- [ ] **Step 3: Verify AGENTS.md still contains only durable rules**

Run: `Get-Content AGENTS.md`
Expected:
- The file contains the mixed-mode Superpowers rules.
- The file does not contain current-task implementation notes.
- The file states the default-to-spec/plan rule for ambiguity.

- [ ] **Step 4: Commit the AGENTS.md update**

```bash
git add AGENTS.md
git commit -m "docs: add dashboard superpowers workflow rules"
```

### Task 4: Verify The Documentation-Only Rollout

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/superpowers/README.md`
- Create: `docs/superpowers/repo-mechanism-map.md`

- [ ] **Step 1: Run whitespace and patch sanity checks**

Run: `git diff --check`
Expected: no whitespace or merge-marker errors

- [ ] **Step 2: Run the frontend smoke script**

Run: `node scripts/frontend.smoke.js`
Expected: `PASS frontend.smoke.js`

- [ ] **Step 3: Run the Windows regression script**

Run: `node scripts/regression.windows.js`
Expected: `PASS regression.windows.js`

- [ ] **Step 4: Review the final change set**

Run: `git status --short`
Expected:
- Only `AGENTS.md`, `docs/superpowers/README.md`, and `docs/superpowers/repo-mechanism-map.md` are changed for implementation work.
- The already-approved spec and this plan remain present under `docs/superpowers/specs/` and `docs/superpowers/plans/`.

- [ ] **Step 5: Commit the verified rollout**

```bash
git add AGENTS.md docs/superpowers/README.md docs/superpowers/repo-mechanism-map.md
git commit -m "docs: adopt superpowers workflow for dashboard repo"
```
