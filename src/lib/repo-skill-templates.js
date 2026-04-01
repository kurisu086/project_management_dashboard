const path = require("node:path");
const {
  AGENTS_DIR_NAME,
  LOCAL_SKILL_NAMES,
  SKILLS_DIR_NAME
} = require("./constants");
const {
  ensureDir,
  readTextIfExists,
  writeTextAtomic
} = require("./fs-utils");

const COMMON_PROTOCOL_REFERENCE = `# Project Control Protocol

This repo uses project-local control files under \`/.codex-control/\`.

Action boundaries:
- initialization_write: allowed during initial dashboard attach only
- explicit_maintenance_write: allowed only after an explicit user action or confirmation
- steady_state_readonly: watcher/polling/refresh; never write repo-side derived cache

Repo-side source files:
- .codex-control/project_brief.json
- .codex-control/module_map.json
- .codex-control/tech_stack.json
- .codex-control/game_design.json (game projects only)
- .codex-control/version_state.json
- .codex-control/decision_log.json
- .codex-control/project_state.json
- .codex-control/runs/<timestamp>.json

Baseline/version files describe project understanding:
- project_brief.json: project definition, final goal, audience, experience, scope
- module_map.json: module list, responsibility, status, relations, current work-package mapping
- tech_stack.json: client/frontend, rendering, UI, state/data flow, storage, build/run, backend existence and responsibility
- game_design.json: gameplay loops, visual direction, primary screens, playable state
- version_state.json: current version target, non-scope, DoD, validation matrix, go/no-go, stage, work package, slice->module mapping
- decision_log.json: only direction-changing decisions that affect version scope, architecture, module boundaries, backend expectations, or product direction

Execution files describe current task evidence:
- project_state.json: current execution state, fixed deliverables, risks, consistency, evidence history
- runs/<timestamp>.json: one run record per completed task or recovery scan

Stable module status values:
- not_started
- prototype
- in_progress
- pending_validation
- completed
- unknown (use only when repo evidence is genuinely insufficient)

Validation matrix rules:
- every validation item must have a specific human-readable label
- do not leave placeholder labels such as "Validation item 1", "unnamed", or empty strings when repo facts allow a better name
- each item should describe one concrete verification target, such as build, smoke path, restart flow, score persistence, or mobile/manual acceptance

Risk rules:
- every risk should have a specific title and a concrete note or scope
- avoid placeholder titles such as "risk item", "unnamed risk", or empty strings when repo facts allow a better name

Decision log rules:
- write a decision only when the choice changes project direction or long-lived constraints
- do not use decision_log.json for routine implementation notes or one-off task chatter

Never write dashboard-local derived cache into this repo:
- current_state.json
- current_state.md

Fact priority:
1. repo source-state files
2. repo-verifiable docs / code structure
3. supplemental docs such as docs/superpowers/specs or plans
4. other explanatory notes
5. manual user clarification

If evidence is incomplete:
- keep unknown as unknown
- use needs_confirmation for unresolved fields
- do not invent strategy, scope, or validation outcomes
- if the missing answer would change project direction, version boundary, architecture, or module planning, stop and ask before deciding
`;

const COMMON_DELIVERABLES_REFERENCE = `# Fixed Deliverables

Every completed task run must write these 10 deliverable keys:

- change_summary
- changed_files
- executed_commands
- test_results
- open_issues
- residual_risks
- impact_scope
- test_suggestions
- documentation_updates
- escalation_or_rollback

Rules:
- fill only from repo-verifiable evidence
- do not fabricate commands or tests
- if a test was not run, state that explicitly
- if a question remains unresolved, keep it under open_issues or residual_risks
`;

function buildHandoffSkill(onboardingMode = "standard") {
  const isSuperpowers = onboardingMode === "superpowers";
  return `---
name: codex-project-handoff
description: Use when starting work in this repo, resuming the project, or before implementing a work package. Read AGENTS.md and .codex-control state first, decide whether the project is ready_for_implementation, and stop for clarification when product-defining information is still missing.${isSuperpowers ? " In Superpowers mode, check specs/plans readiness before coding and treat confirmed Superpowers decisions as workflow constraints." : ""} Do not use for pure closeout/writeback.
---

# Goal

Establish the current project state before implementation.

# Read first

- AGENTS.md
- .codex-control/project_brief.json
- .codex-control/module_map.json
- .codex-control/tech_stack.json
- .codex-control/game_design.json (if present)
- .codex-control/version_state.json
- .codex-control/project_state.json
- latest 1-3 files in .codex-control/runs/
${isSuperpowers ? "- docs/superpowers/specs/*.md (if present)\n- docs/superpowers/plans/*.md (if present)\n" : ""}- references/project-control-protocol.md

# Steps

1. Summarize:
   - current version goal
   - current stage
   - current work package
   - current slice -> module mapping
   - current action state and reasons
${isSuperpowers ? "   - whether specs/plans readiness is sufficient for the work you are about to do\n" : ""}2. Identify:
   - missing baseline information
   - missing version definition
   - in-scope modules still left as unknown without good reason
   - validation items that still have placeholder names
   - risk items that still have placeholder names
   - blockers
   - unresolved validation gaps
   - unresolved human decisions
${isSuperpowers ? "   - missing or unconfirmed Superpowers specs/plans decisions that block implementation\n" : ""}3. Decide whether the repo is:
   - needs_baseline
   - needs_version_definition
   - needs_validation
   - blocked
   - needs_human_decision
   - ready_for_implementation
4. If not ready_for_implementation:
   - do not change business code
   - ask only the minimum necessary questions
   - name the exact missing fields or confirmations
5. If ready_for_implementation:
   - restate scope, non-scope, validation target, and allowed area before coding
${isSuperpowers ? "   - confirm the relevant specs/plans are ready before implementation when workflow-defining work is in scope\n" : ""}   - if module status / validation labels / risk labels are obviously stale or placeholder-only, fix source-state first or pair that cleanup with the next explicit closeout

# Stop conditions

- product-defining information is still missing
- current version target is still unknown
- current work package is not mapped clearly enough
- direction-impacting ambiguity still exists
${isSuperpowers ? "- Superpowers mode is active but specs/plans readiness is not confirmed for the intended work\n" : ""}
# Never do

- never invent version goals
- never treat chat guesses as facts
- never write dashboard local cache files
- never write current_state.json or current_state.md into repo
- never silently keep placeholder module, validation, or risk labels when repo evidence already supports real names
${isSuperpowers ? "- never bypass missing specs/plans readiness by presenting repo guesses as confirmed Superpowers decisions\n" : ""}`;
}

function buildCloseoutSkill(onboardingMode = "standard") {
  const isSuperpowers = onboardingMode === "superpowers";
  return `---
name: codex-task-closeout-writeback
description: Use after completing a task in this repo to update .codex-control source-state files and append a run record. Write back project_state.json and runs/<timestamp>.json from repo-verifiable evidence.${isSuperpowers ? " In Superpowers mode, keep writeback aligned with confirmed Superpowers decisions and call out any mismatch explicitly." : ""} Do not use before implementation starts.
---

# Goal

Write back control-state updates after a completed task.

# Read first

- AGENTS.md
- .codex-control/project_state.json
- .codex-control/version_state.json
- latest run file(s) in .codex-control/runs/
${isSuperpowers ? "- docs/superpowers/specs/*.md (if present)\n- docs/superpowers/plans/*.md (if present)\n" : ""}- references/project-control-protocol.md
- references/fixed-deliverables.md

# Required outputs

- update .codex-control/project_state.json
- create .codex-control/runs/<timestamp>.json

# Steps

1. Gather repo-verifiable evidence:
   - changed files
   - commands actually run
   - tests actually run
   - unresolved issues and residual risks
2. Update project_state.json:
   - current stage
   - current work package
   - fixed deliverables
   - risk flags
   - consistency declared
   - evidence.history
3. Keep module_map.json and version_state.json aligned when task evidence changes:
   - in-scope module statuses
   - current slice -> module mapping
   - validation matrix status
   - go / no-go reasoning
${isSuperpowers ? "   - keep project_state.json and runs/<timestamp>.json aligned with confirmed Superpowers decisions\n" : ""}4. Name validation items and risk items clearly:
   - replace placeholder labels when repo evidence is sufficient
   - keep placeholder-like labels only when evidence is genuinely insufficient and explain why
5. Append a new run record with the 10 required deliverables
6. Report exactly what was written

# Stop conditions

- tests were not actually run but are being claimed
- repo evidence is insufficient
- a version-level change would require explicit human confirmation
${isSuperpowers ? "- task evidence conflicts with confirmed Superpowers decisions and the mismatch has not been surfaced\n" : ""}
# Never do

- never fabricate tests or commands
- never write dashboard local cache
- never commit or recommend committing .codex-control
- never leave stale placeholder validation or risk labels behind when the completed task already clarified them
${isSuperpowers ? "- never let closeout writeback drift away from confirmed Superpowers decisions without explicitly recording the conflict\n" : ""}`;
}

function buildRecoverySkill(onboardingMode = "standard") {
  const isSuperpowers = onboardingMode === "superpowers";
  return `---
name: codex-project-recovery-scan
description: Use when restoring a half-finished repo into the control system, rebuilding the project profile, or filling missing .codex-control baseline/version files from repo facts. Scan repo-visible evidence, write unknown or needs_confirmation when evidence is incomplete, and do not modify business code.${isSuperpowers ? " In Superpowers mode, never present repo guesses as confirmed design decisions." : ""}
---

# Goal

Recover project understanding from an existing repo.

# Read first

- AGENTS.md
- existing .codex-control/*
- README, docs, notes, plans
- package/build scripts
- main entry points
- major module directories
- tests
- recent change clues
${isSuperpowers ? "- docs/superpowers/specs/*.md (if present)\n- docs/superpowers/plans/*.md (if present)\n" : ""}- references/project-control-protocol.md
- references/fixed-deliverables.md

# Outputs

Try to fill or update:
- .codex-control/project_brief.json
- .codex-control/module_map.json
- .codex-control/tech_stack.json
- .codex-control/game_design.json (if game)
- .codex-control/version_state.json
- .codex-control/project_state.json
- .codex-control/runs/<timestamp>-recovery-scan.json

Recovery quality bar:
- do not stop at module names only; give each in-scope module a responsibility and the best repo-grounded status you can justify
- do not leave validation_matrix as generic "Validation item 1/2/3" placeholders when repo evidence already points to concrete verification targets
- do not leave risk titles as generic placeholders when repo evidence already points to concrete risk scope
- record needs_confirmation only for gaps that repo evidence truly cannot settle
${isSuperpowers ? "- never upgrade repo guesses into confirmed Superpowers design decisions without explicit evidence\n" : ""}
# Rules

- facts first
- unknown stays unknown
- use needs_confirmation when evidence is incomplete
- do not modify business code

# Required report

1. provisional project definition
2. provisional current version goal
3. provisional current stage / work package
4. key blockers / risks
5. questions needing confirmation
6. which module statuses, validation items, and risk titles were named from repo evidence
${isSuperpowers ? "7. which Superpowers decisions were confirmed versus still inferred from repo evidence\n" : ""}`;
}

function buildSkillDefinitions(onboardingMode = "standard") {
  return [
  {
    name: LOCAL_SKILL_NAMES[0],
    files: {
      "SKILL.md": buildHandoffSkill(onboardingMode),
      "references/project-control-protocol.md": COMMON_PROTOCOL_REFERENCE
    }
  },
  {
    name: LOCAL_SKILL_NAMES[1],
    files: {
      "SKILL.md": buildCloseoutSkill(onboardingMode),
      "references/project-control-protocol.md": COMMON_PROTOCOL_REFERENCE,
      "references/fixed-deliverables.md": COMMON_DELIVERABLES_REFERENCE
    }
  },
  {
    name: LOCAL_SKILL_NAMES[2],
    files: {
      "SKILL.md": buildRecoverySkill(onboardingMode),
      "references/project-control-protocol.md": COMMON_PROTOCOL_REFERENCE,
      "references/fixed-deliverables.md": COMMON_DELIVERABLES_REFERENCE
    }
  }
  ];
}

async function ensureRepoLocalSkills(projectRoot, options = {}) {
  const skillsRoot = path.join(projectRoot, AGENTS_DIR_NAME, SKILLS_DIR_NAME);
  const skillDefinitions = buildSkillDefinitions(options.onboardingMode || "standard");
  await ensureDir(skillsRoot);

  for (const skill of skillDefinitions) {
    for (const [relativePath, content] of Object.entries(skill.files)) {
      const targetPath = path.join(skillsRoot, skill.name, relativePath);
      const existing = await readTextIfExists(targetPath);
      if (existing !== content) {
        await writeTextAtomic(targetPath, content);
      }
    }
  }
}

function getRepoLocalSkillPaths(projectRoot) {
  return buildSkillDefinitions().map((skill) => ({
    name: skill.name,
    rootDir: path.join(projectRoot, AGENTS_DIR_NAME, SKILLS_DIR_NAME, skill.name),
    files: Object.keys(skill.files).map((relativePath) => path.join(projectRoot, AGENTS_DIR_NAME, SKILLS_DIR_NAME, skill.name, relativePath))
  }));
}

module.exports = {
  ensureRepoLocalSkills,
  getRepoLocalSkillPaths
};
