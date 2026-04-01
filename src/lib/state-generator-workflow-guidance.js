const { deriveProjectWorkflowGuidance } = require("./project-workflow-guidance");

const PRIMARY_TYPE_INDEX_BY_STAGE = {
  blocked: 6,
  closeout_needed: 5,
  docs_decision_needed: 5,
  handoff_needed: 5,
  ready_for_implementation: 3
};

function buildWorkflowGuidanceState(projectRecord, overviewSources, conflicts, summary, baseInstructionCenter = {}) {
  const guidance = deriveProjectWorkflowGuidance({
    onboardingMode: resolveOnboardingMode(projectRecord),
    currentAction: {
      state: summary?.currentActionState,
      reasons: summary?.currentActionReasons,
      secondaryConditions: summary?.secondaryConditions
    },
    superpowersWorkflow: overviewSources?.superpowers?.workflow || {},
    conflicts,
    pendingDecisions: baseInstructionCenter.pendingDecisions || []
  });

  return {
    guidance,
    summaryFields: buildWorkflowSummaryFields(guidance)
  };
}

function withWorkflowGuidanceInstructionCenter(baseInstructionCenter, guidance) {
  if (!guidance) {
    return baseInstructionCenter;
  }

  return {
    ...baseInstructionCenter,
    currentActionState: guidance.workflowStage || baseInstructionCenter.currentActionState,
    currentActionReasons: uniqueStrings([
      guidance.recommendedNextReason,
      ...(guidance.workflowBlockingItems || []),
      ...(baseInstructionCenter.currentActionReasons || [])
    ]),
    primaryType: mapStageToInstructionType(baseInstructionCenter, guidance),
    firstActionHint: guidance.recommendedNextReason || baseInstructionCenter.firstActionHint,
    workflowGuidance: guidance
  };
}

function buildWorkflowOnboardingView(projectRecord, baseOnboardingView, guidance) {
  return {
    ...baseOnboardingView,
    onboardingMode: resolveOnboardingMode(projectRecord),
    workflowGuidance: guidance || null
  };
}

function buildWorkflowSummaryFields(guidance) {
  return {
    workflowStage: guidance?.workflowStage || null,
    recommendedNextAction: guidance?.recommendedNextAction || null,
    recommendedNextSkill: guidance?.recommendedNextSkill || null,
    recommendedNextReason: guidance?.recommendedNextReason || null
  };
}

function resolveOnboardingMode(projectRecord = {}) {
  if (projectRecord.onboardingMode) {
    return String(projectRecord.onboardingMode).trim().toLowerCase() || "standard";
  }

  return projectRecord.useSuperpowers ? "superpowers" : "standard";
}

function mapStageToInstructionType(baseInstructionCenter = {}, guidance) {
  const stage = guidance?.workflowStage;
  const mappedIndex = PRIMARY_TYPE_INDEX_BY_STAGE[stage];

  if (!Number.isInteger(mappedIndex)) {
    return baseInstructionCenter.primaryType;
  }

  return baseInstructionCenter.availableTypes?.[mappedIndex]?.type || baseInstructionCenter.primaryType;
}

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

module.exports = {
  buildWorkflowGuidanceState,
  buildWorkflowOnboardingView,
  withWorkflowGuidanceInstructionCenter
};
