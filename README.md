# Project Management Dashboard

`project_management_dashboard` is a **multi-project read-only Codex control dashboard**.

It is a local Windows-first control-plane implementation for observing multiple git repositories from one dashboard. In steady state, it reads project control files, aggregates status, and presents project structure, workflow state, risks, verification notes, and pending review signals without editing monitored project business code.

This repository is early-stage public OSS. Issues and pull requests are welcome, especially small fixes with clear reproduction steps and test evidence.

## Project Positioning

This dashboard is useful when you want to:

- monitor several local Codex-managed projects from one place
- inspect project definitions, module maps, current slices, risks, and verification status
- track Superpowers-style `spec -> plan -> implementation` workflow evidence
- compare formal writeback state with repo-visible changes
- run local intake, recovery, refresh, and pending-review control-plane flows

It is not intended to:

- modify monitored project business code during steady-state dashboard reads
- replace each project's own source-of-truth files
- act as a hosted multi-tenant SaaS dashboard
- bypass repository-local rules such as [AGENTS.md](AGENTS.md)
- infer product decisions when repo facts conflict

Repo facts override chat descriptions. If dashboard data conflicts with repository-visible facts, surface the inconsistency instead of silently overwriting it.

## Quick Start

Requirements:

- Windows 11
- Node.js 20 or newer
- Git available on `PATH`
- monitored projects must be local Windows git repositories

Install dependencies:

```bash
npm install
```

Start the dashboard:

```bash
npm start
```

Start in development mode:

```bash
npm run dev
```

Run the two Windows verification scripts:

```bash
npm run test:smoke:frontend
npm run test:regression:windows
```

The test scripts use isolated temporary data directories under `tmp/` and must not overwrite the real `data/` directory.

## Repository Structure

- [src/server.js](src/server.js): HTTP server entry point
- [src/lib/](src/lib/): backend aggregation, intake, workflow, scaffold, and state-generation modules
- [public/](public/): browser frontend shell and view modules
- [scripts/](scripts/): Windows regression, frontend smoke, and test helper scripts
- [docs/superpowers/](docs/superpowers/): workflow rules for changes inside this repository
- [docs/source-state-protocol.md](docs/source-state-protocol.md): monitored-project control-plane protocol

For repository-local workflow rules, read [AGENTS.md](AGENTS.md) and [docs/superpowers/README.md](docs/superpowers/README.md).

## Monitored Project Intake

1. Attach a target repository through the dashboard.
2. Choose a new-project or existing-project recovery path.
3. Enable `useSuperpowers` when the monitored project should follow a Superpowers workflow.
4. The dashboard may create or maintain control-plane assets such as:
   - `.codex-control/`
   - repo-local skills
   - dashboard-managed `AGENTS.md` rule blocks
   - minimal `docs/superpowers/` scaffold files
5. During later reads, the dashboard prefers formal writeback evidence, then spec/plan context, then repo-change fallback evidence when formal writeback is missing or stale.

## Development Boundaries

This repository is the dashboard control plane. Do not change monitored project business code from dashboard steady-state flows.

Changes that affect data structures, API contracts, monitored-project integration protocol, scaffold injection rules, steady-state read/write boundaries, or core intake/recovery/refresh/watch semantics must follow the main workflow in [docs/superpowers/README.md](docs/superpowers/README.md):

```text
spec -> plan -> implementation
```

Small documentation-only changes and other low-risk local edits may use the fast path described there.

## Package Publishing

`package.json` currently keeps `"private": true` only as a guard against accidental `npm publish`. It does not make the repository closed-source and should not be removed casually.

## License

Licensed under the [Apache License 2.0](LICENSE).
