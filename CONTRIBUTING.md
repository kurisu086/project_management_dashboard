# Contributing

Thanks for helping make this dashboard easier to run and reason about. This project is early-stage public OSS, so small, focused issues and pull requests are especially useful.

## Minimal Reproduction

When reporting a bug, include:

- Windows version
- Node.js version
- Git version
- exact command or dashboard action
- expected result
- actual result, including logs or stack traces
- whether the monitored project uses `useSuperpowers`
- a minimal repository shape or fixture when the issue depends on project files

Do not include secrets, private repository contents, tokens, or real user data.

## Tests

Run the most relevant checks before opening a pull request. For general dashboard changes, run:

```bash
npm run test:smoke:frontend
npm run test:regression:windows
```

Test scripts must use isolated temporary data directories and must not overwrite the real `data/` directory.

If a test cannot run locally, explain the blocker in the issue or pull request instead of marking it as passed.

## Workflow Boundary

This repository uses a mixed-mode Superpowers workflow for changes inside `project_management_dashboard`.

Use the main path when a change affects any of these boundaries:

- data structures or state models
- API contracts
- monitored-project integration protocol
- scaffold injection behavior
- steady-state read/write boundaries
- intake, recovery, refresh, maintenance, watcher, or snapshot-generation semantics
- cross-module or core control-plane capabilities

Main-path work must go through:

```text
docs/superpowers/specs/ -> docs/superpowers/plans/ -> implementation
```

Use the fast path only for low-risk local changes such as documentation edits, copy updates, and isolated presentation fixes that do not change data shape, API shape, integration protocol, or read/write boundaries.

If the classification is unclear, default to the main path.
