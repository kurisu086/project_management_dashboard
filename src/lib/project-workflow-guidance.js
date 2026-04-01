const STAGE_PRIORITY = [
  "blocked",
  "closeout_needed",
  "recovery_needed",
  "docs_decision_needed",
  "handoff_needed",
  "ready_for_implementation"
];

function deriveProjectWorkflowGuidance(input = {}) {
  const onboardingMode = normalizeOnboardingMode(input.onboardingMode);
  const currentAction = normalizeCurrentAction(input.currentAction);
  const superpowersWorkflow = normalizeSuperpowersWorkflow(input.superpowersWorkflow);
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts.filter(Boolean) : [];
  const pendingDecisions = Array.isArray(input.pendingDecisions) ? input.pendingDecisions.filter(Boolean) : [];
  const candidates = [];

  if (isBlocked(currentAction, conflicts, pendingDecisions)) {
    const blockingItems = collectBlockingItems(conflicts, pendingDecisions, currentAction.reasons);
    candidates.push(buildGuidance("blocked", {
      action: "resolve the blocking issue",
      skill: null,
      reason: "High-priority conflicts or unresolved human decisions still block the next repo action.",
      after: "Resolve the blocker, then re-evaluate workflow stage.",
      blockingItems
    }));
  }

  if (needsCloseout(superpowersWorkflow)) {
    candidates.push(buildGuidance("closeout_needed", {
      action: "write back closeout state",
      skill: "codex-task-closeout-writeback",
      reason: "Repo-visible changes exist without a newer formal closeout record.",
      after: "Write back project_state.json and runs/*.json, then re-check readiness."
    }));
  }

  if (needsRecovery(currentAction)) {
    candidates.push(buildGuidance("recovery_needed", {
      action: "run the recovery scan",
      skill: "codex-project-recovery-scan",
      reason: "Baseline or version state is still too incomplete for safe implementation guidance.",
      after: "Recover control-state first, then re-evaluate docs or handoff."
    }));
  }

  if (needsDocsDecision(onboardingMode, currentAction, superpowersWorkflow)) {
    candidates.push(buildGuidance("docs_decision_needed", {
      action: "decide the docs and planning path",
      skill: "codex-project-handoff",
      reason: "Superpowers workflow-defining docs are still missing or incomplete for the intended next work.",
      after: "Confirm specs/plans, then run handoff."
    }));
  }

  if (needsHandoff(onboardingMode, currentAction, superpowersWorkflow)) {
    candidates.push(buildGuidance("handoff_needed", {
      action: "prepare the handoff prompt",
      skill: "codex-project-handoff",
      reason: "Control-state and workflow docs are present enough that implementation readiness should now be judged by handoff.",
      after: "If handoff confirms readiness, continue with implementation and closeout afterward."
    }));
  }

  if (needsReadyForImplementation(onboardingMode, currentAction)) {
    candidates.push(buildGuidance("ready_for_implementation", {
      action: "start implementation",
      skill: null,
      reason: "No higher-priority workflow blockers are active.",
      after: "Implement the current slice and then close out formally."
    }));
  }

  return chooseGuidance(candidates);
}

function normalizeOnboardingMode(value) {
  return String(value || "standard").trim().toLowerCase() || "standard";
}

function normalizeCurrentAction(currentAction = {}) {
  return {
    state: String(currentAction.state || "").trim().toLowerCase() || "unknown",
    reasons: Array.isArray(currentAction.reasons) ? currentAction.reasons.filter(Boolean) : []
  };
}

function normalizeSuperpowersWorkflow(superpowersWorkflow = {}) {
  return {
    workflowState: String(superpowersWorkflow.workflowState || "").trim().toLowerCase() || "not_used",
    hasUnwrittenRepoChanges: Boolean(superpowersWorkflow.hasUnwrittenRepoChanges),
    writebackDrift: String(superpowersWorkflow.writebackDrift || "").trim().toLowerCase() || "not_applicable"
  };
}

function isBlocked(currentAction, conflicts, pendingDecisions) {
  return currentAction.state === "blocked"
    || currentAction.state === "needs_human_decision"
    || conflicts.some((item) => normalizeLevel(item.level) === "high")
    || pendingDecisions.length > 0;
}

function needsCloseout(superpowersWorkflow) {
  return superpowersWorkflow.hasUnwrittenRepoChanges
    || superpowersWorkflow.workflowState === "repo_changed_without_closeout"
    || superpowersWorkflow.writebackDrift !== "not_applicable";
}

function needsRecovery(currentAction) {
  return ["needs_baseline", "needs_version_definition", "recovery"].includes(currentAction.state);
}

function needsDocsDecision(onboardingMode, currentAction, superpowersWorkflow) {
  return onboardingMode === "superpowers"
    && currentAction.state === "ready_for_implementation"
    && ["docs_only", "insufficient_evidence"].includes(superpowersWorkflow.workflowState);
}

function needsHandoff(onboardingMode, currentAction, superpowersWorkflow) {
  return onboardingMode === "superpowers"
    && currentAction.state === "ready_for_implementation"
    && !needsDocsDecision(onboardingMode, currentAction, superpowersWorkflow);
}

function needsReadyForImplementation(onboardingMode, currentAction) {
  return onboardingMode !== "superpowers" && currentAction.state === "ready_for_implementation";
}

function collectBlockingItems(conflicts, pendingDecisions, reasons) {
  const items = [];

  conflicts.forEach((item) => {
    const message = String(item?.message || "").trim();
    if (normalizeLevel(item?.level) === "high" && message) {
      items.push(message);
    }
  });

  pendingDecisions.forEach((item) => {
    const label = String(item?.label || item?.title || item?.value || "").trim();
    if (label) {
      items.push(label);
    }
  });

  reasons.forEach((item) => {
    const reason = String(item || "").trim();
    if (reason) {
      items.push(reason);
    }
  });

  return uniqueStrings(items);
}

function normalizeLevel(level) {
  return String(level || "").trim().toLowerCase();
}

function buildGuidance(stage, config) {
  const blockingItems = Array.isArray(config.blockingItems) && config.blockingItems.length
    ? uniqueStrings(config.blockingItems)
    : [config.reason];

  return {
    workflowStage: stage,
    recommendedNextAction: config.action,
    recommendedNextSkill: config.skill || null,
    recommendedNextReason: config.reason,
    recommendedNextAfter: config.after,
    workflowBlockingItems: blockingItems
  };
}

function chooseGuidance(candidates) {
  const fallback = buildGuidance("ready_for_implementation", {
    action: "start implementation",
    skill: null,
    reason: "No blocking workflow conditions were found.",
    after: "Continue implementation and write back formal closeout evidence afterward."
  });

  if (!candidates.length) {
    return fallback;
  }

  return [...candidates].sort((left, right) => (
    STAGE_PRIORITY.indexOf(left.workflowStage) - STAGE_PRIORITY.indexOf(right.workflowStage)
  ))[0];
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

module.exports = {
  STAGE_PRIORITY,
  deriveProjectWorkflowGuidance
};
