## Dashboard Repo Stable Rules

1. This repo is the control-plane implementation. Do not modify monitored project business code from dashboard steady-state flows.
2. Repo facts override chat descriptions. If data conflicts, surface the inconsistency instead of silently overwriting it.
3. Keep long-lived rules here only. Do not put current version plans, one-off tasks, or temporary context in this file.
4. Any `.js` file in this repo must stay at or below 700 lines.
5. If a change would push a `.js` file over 700 lines, split it by responsibility before adding more logic.
6. Prefer small focused frontend modules and backend library modules over monolithic files.
7. Test scripts must use isolated temporary data directories and must not overwrite the real `data/` directory.
8. This repo uses a mixed-mode Superpowers workflow for changes inside `project_management_dashboard` itself.
9. Changes that affect data structures, API contracts, monitored-project integration protocol, scaffold injection rules, steady-state read/write boundaries, or core intake/recovery/refresh/watch semantics must go through `docs/superpowers/specs/` and `docs/superpowers/plans/` before implementation.
10. The fast path is only for low-risk, local changes that stay within a single module or file; cross-module work or core control-plane capability work does not qualify, even if it does not change data shape or API contracts.
11. If it is unclear whether a task changes those boundaries, default to the spec/plan path; if a fast-path task grows into boundary-changing work, reclassify it to the spec/plan path before continuing.
12. Read `docs/superpowers/README.md` before classifying work in this repo.
13. Already-oversized `.js` files are legacy exceptions; when touching one, split by responsibility before adding more logic, and keep the 700-line rule in mind when deciding whether further growth is acceptable.
