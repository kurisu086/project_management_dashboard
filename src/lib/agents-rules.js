const {
  CONTROL_RULES_END,
  CONTROL_RULES_START
} = require("./constants");

function buildControlRulesBlock(options = {}) {
  const lines = [
    CONTROL_RULES_START,
    "## Codex Project Control Rules",
    "",
    "1. `/.codex-control/` is the project control directory. Repo-side source-state files live there.",
    "2. After each completed task, update these repo-side source-state files:",
    "   - `/.codex-control/project_state.json`",
    "   - `/.codex-control/runs/<timestamp>.json`",
    "3. Keep these baseline/version source files aligned when repo facts or confirmed project decisions change:",
    "   - `/.codex-control/project_brief.json`",
    "   - `/.codex-control/module_map.json`",
    "   - `/.codex-control/tech_stack.json`",
    "   - `/.codex-control/game_design.json` (game projects only)",
    "   - `/.codex-control/version_state.json`",
    "   - `/.codex-control/decision_log.json` (when major project decisions exist)",
    "4. `module_map.json` must not leave in-scope modules as `unknown` when repo evidence is already sufficient to classify them. Prefer these stable statuses:",
    "   - `not_started`",
    "   - `prototype`",
    "   - `in_progress`",
    "   - `pending_validation`",
    "   - `completed`",
    "   - `unknown` (only when evidence is truly insufficient)",
    "5. Validation items and risk items must be named clearly. Avoid placeholder labels such as `unnamed`, `unknown item`, or empty titles when a more specific repo-grounded label is available.",
    "6. Record direction-changing decisions in `decision_log.json` when they affect version scope, architecture, module boundaries, backend expectations, or product direction.",
    "7. Dashboard-derived cache files are local to the dashboard and must not be written back into the repo.",
    "8. Every run record must include these 10 deliverables:",
    "   - change_summary",
    "   - changed_files",
    "   - executed_commands",
    "   - test_results",
    "   - open_issues",
    "   - residual_risks",
    "   - impact_scope",
    "   - test_suggestions",
    "   - documentation_updates",
    "   - escalation_or_rollback",
    "9. All control files must be based on repo-verifiable facts. Do not fabricate commands, tests, implementation status, module state, risk state, or validation state.",
    "10. When repo facts conflict with chat, repo facts win and the conflict must be recorded in control files.",
    "11. If a missing answer would change project direction, version boundary, architecture choice, or module planning, stop and ask. Do not silently decide strategy.",
    "12. `AGENTS.md` stores only long-lived stable rules. Do not write temporary version plans or one-off task context here.",
    "13. Repo-local workflow skills live under `/.agents/skills/`.",
    "14. Prefer these repo-local skills when applicable:",
    "   - `codex-project-handoff` before implementation or when resuming work",
    "   - `codex-task-closeout-writeback` after completing a task",
    "   - `codex-project-recovery-scan` when rebuilding project understanding from repo facts",
    "15. `/.codex-control/` and repo-local dashboard-installed skills are local control assets and should stay ignored by git."
  ];

  if (options.onboardingMode === "superpowers" || (options.onboardingMode == null && options.useSuperpowers)) {
    lines.push(
      "16. Superpowers mode is enabled for this repo by dashboard onboarding. Treat `docs/superpowers/specs/**` and `docs/superpowers/plans/**` as workflow constraints, not optional notes, before implementation.",
      "17. In Superpowers mode, handoff, recovery, and closeout must stay aligned with confirmed Superpowers decisions instead of repo guesses or ad-hoc shortcuts.",
      "18. If repo facts and confirmed Superpowers decisions diverge, surface the mismatch explicitly before updating control files or implementation plans."
    );
  }

  lines.push("", CONTROL_RULES_END);
  return lines.join("\n");
}

function upsertControlRules(existingText, options = {}) {
  const block = buildControlRulesBlock(options);
  const pattern = new RegExp(
    `${escapeRegExp(CONTROL_RULES_START)}[\\s\\S]*?${escapeRegExp(CONTROL_RULES_END)}`,
    "m"
  );

  if (!existingText || !existingText.trim()) {
    return `${block}\n`;
  }

  if (pattern.test(existingText)) {
    return `${existingText.replace(pattern, block).trimEnd()}\n`;
  }

  return `${existingText.trimEnd()}\n\n${block}\n`;
}

function hasControlRulesBlock(text) {
  if (!text) {
    return false;
  }

  return text.includes(CONTROL_RULES_START) && text.includes(CONTROL_RULES_END);
}

function removeControlRules(existingText) {
  if (!existingText) {
    return "";
  }

  const pattern = new RegExp(
    `\\n?${escapeRegExp(CONTROL_RULES_START)}[\\s\\S]*?${escapeRegExp(CONTROL_RULES_END)}\\n?`,
    "m"
  );

  return existingText
    .replace(pattern, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  buildControlRulesBlock,
  hasControlRulesBlock,
  removeControlRules,
  upsertControlRules
};
