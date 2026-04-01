## Dashboard Repo Stable Rules

1. This repo is the control-plane implementation. Do not modify monitored project business code from dashboard steady-state flows.
2. Repo facts override chat descriptions. If data conflicts, surface the inconsistency instead of silently overwriting it.
3. Keep long-lived rules here only. Do not put current version plans, one-off tasks, or temporary context in this file.
4. Any `.js` file in this repo must stay at or below 700 lines.
5. If a change would push a `.js` file over 700 lines, split it by responsibility before adding more logic.
6. Prefer small focused frontend modules and backend library modules over monolithic files.
7. Test scripts must use isolated temporary data directories and must not overwrite the real `data/` directory.
