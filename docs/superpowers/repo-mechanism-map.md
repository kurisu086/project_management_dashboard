# Dashboard Repo Mechanism Map

This note summarizes how `project_management_dashboard` currently works so future development starts from repo facts instead of guesswork.

## Runtime Shape

- `src/server.js` boots the HTTP server and serves the static frontend from `public/`.
- Runtime data defaults to `data/`, or to `CODEX_CONTROL_DATA_DIR` when tests or callers override the dashboard data root.
- Active dashboard-local server state includes the project registry, diagnostic history, workbench draft and session state, and per-project derived cache.
- The operation log is dashboard-local append-only persistence rather than active runtime state.

## Write Boundary Model

- `steady_state_readonly` covers normal reads, refreshes, and cache regeneration that do not write back into repo-side source-state files.
- `initialization_write` covers first-time project attach and scaffold creation.
- `explicit_maintenance_write` covers previewed and confirmed repo-side maintenance actions such as writeback, cleanup, and repair.
- Some flows also use `dashboard_local_only` when actions only change dashboard-local state and do not write repo-side source-state files.
- These modes govern when repo-side writes are allowed and keep the dashboard's steady-state aggregation boundary explicit.

## Backend Responsibility Map

### `src/server.js`

- Boots the server.
- Loads registry, diagnostics, and workbench state.
- Attaches watchers for registered projects.
- Exposes project APIs, workbench APIs, maintenance APIs, and static asset serving.

### `src/lib/project-reader.js`

- Scaffolds repo-side control files for attached projects.
- Injects repo-local skills and `AGENTS.md` / `.gitignore` control blocks.
- Reads project snapshots from repo-side source state.
- Produces project config and watch manifest files.
- Collects repo-local skill facts plus git-backed repo-change fallback evidence for monitored repos.

### `src/lib/project-overview.js`

- Scans repo-visible signals.
- Merges repo-side declared state, repo-derived facts, and optional Superpowers supplemental docs.
- Normalizes baseline, version, game, and decision views.
- Derives structured Superpowers workflow state and flags writeback drift conflicts when repo-visible changes outpace formal closeout records.

### `src/lib/state-generator.js`

- Normalizes `project_state.json`.
- Builds summary and detail payloads used by the UI.
- Writes dashboard-local `current_state.json` and `current_state.md` cache files.
- Assembles navigation, view models, pending review prompts, and visualization payloads.
- Delegates Superpowers-specific summary/detail/view wiring to focused helper modules.

### `src/lib/repo-change-fallback.js`

- Reads real git commit and working-tree facts for monitored repos.
- Produces inferred fallback evidence only when formal writeback is missing or stale.

### `src/lib/superpowers-workflow-state.js`

- Converts specs, plans, formal runs, repo-local skills, and repo fallback facts into a stable workflow-state model.
- Distinguishes `formal_run` evidence from `repo_fallback` inference so downstream views can explain confidence clearly.

### `src/lib/state-generator-superpowers.js`

- Adapts workflow-state output into summary fields, recent-change entries, pending-review items, instruction guidance, and markdown sections.
- Keeps Superpowers-specific branching out of the main state-generator control flow.

### `src/lib/server-workbench.js`

- Handles workbench HTTP and API orchestration.
- Drives preview and apply flows for new-project writeback.
- Orchestrates recovery attach flows.
- Bridges registry state, `addProject()`, and `refreshProject()` into workbench actions.

### `src/lib/intake-workbench.js`

- Normalizes and persists draft and recovery session state.
- Computes workflow states for new-project and recovery flows.
- Builds workbench payloads and prompt bundles with support helpers.

## Project Lifecycle

1. A repo is attached through `/api/projects` or a workbench flow.
2. The dashboard validates the runtime gate: Windows-native execution, absolute Windows path, directory existence, git-repo checks, and writeability checks before attach proceeds.
3. `ensureProjectScaffold()` creates repo-side control assets and local skills.
4. `readProjectSnapshot()` reads repo-side source state plus supplemental docs.
5. `state-generator.js` derives dashboard summary and detail data, then writes local cache artifacts.
6. `WatchManager` watches source files and refreshes derived cache on change.

## Frontend Responsibility Map

### `public/app-main.js`

- Owns app boot, event wiring, API calls, and view switching.

### `public/app-api.js`

- Handles HTTP transport for dashboard API calls.

### `public/app-config.js`

- Resolves view IDs, fallback navigation, and diagram-view classification.

### `public/app-workflow-config.js`

- Centralizes workflow IDs, labels, and options used across the browser modules.

### `public/app-session.js`

- Manages session state such as dismissed pending-review overlays and query-based form prefilling.

### `public/app-diagrams.js`

- Handles diagram rendering and viewport interaction for the diagram overlays and collections.

### `public/app-utils.js`

- Provides shared rendering, field, conflict-pill, formatting, and copy helpers used across views, shell, diagrams, and workbench code.

### `public/app-shell.js`

- Renders the top-level shell, project list, overview strip, header, nav, and pending-review overlay content.

### `public/app-workbench.js`

- Renders the new-project filing, recovery, and GPT-assist workflow views.

### `public/app-views-core.js`

- Renders most project detail views such as overview, modules, tech, risks, verification, and onboarding.

### `public/app-views-superpowers.js`

- Renders compact workflow, drift, and evidence-source callouts for overview, instruction-center, recent-changes, and status-sources views.
- Keeps Superpowers-specific UI fragments separate from the main view renderer.

## Superpowers Monitored Project Aggregation Path

When a monitored repo uses Superpowers, the dashboard now resolves execution evidence in this order:

1. `/.codex-control/project_state.json` and `/.codex-control/runs/*.json` are the primary execution truth.
2. `docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md` provide workflow context and linked design titles.
3. Real git/repo-visible changes are used only as inferred fallback evidence when formal writeback is missing or stale.

This distinction is surfaced through:

- summary fields such as `superpowersWorkflowState`, `latestExecutionEvidenceSource`, `hasUnwrittenRepoChanges`, and `writebackDrift`
- pending-review items when repo changes exist without a newer closeout run
- instruction-center guidance that switches to a sync-document flow before more implementation guidance
- recent-changes and status-sources views that visibly separate formal run evidence from inferred repo drift

## Tests

- `scripts/regression.windows.js` verifies attach, refresh, workbench, cleanup, and cache behavior with isolated temp data.
- `scripts/frontend.smoke.js` verifies frontend shells, prompt exposure, and basic workflow endpoints with isolated temp data.

## Current Hotspots

The repo currently has several oversized `.js` files relative to the 700-line rule in `AGENTS.md`:

- `src/lib/state-generator.js` (2009)
- `src/lib/project-overview.js` (1836)

Future feature work that touches these files should split by responsibility before adding more logic, consistent with the AGENTS rule.

## Safe Mental Model For Future Changes

- Treat `src/server.js` as the transport and lifecycle layer.
- Treat `project-reader.js` plus `project-overview.js` plus `state-generator.js` as the source-state aggregation pipeline, with `repo-change-fallback.js`, `superpowers-workflow-state.js`, and `state-generator-superpowers.js` handling the new Superpowers-specific slices.
- Treat `server-workbench.js` plus `intake-workbench.js` as the intake and recovery workflow engine.
- Treat `app-main.js` as the browser orchestrator; `app-api.js`, `app-config.js`, `app-session.js`, and `app-diagrams.js` handle transport, config, session, and diagram coordination; `app-shell.js`, `app-workbench.js`, `app-views-core.js`, and `app-views-superpowers.js` render the shell and views.
