function buildSuperpowersSummaryFields(overviewSources) {
  const workflow = overviewSources.superpowers?.workflow || {};
  return {
    superpowersWorkflowState: workflow.workflowState || "not_used",
    latestExecutionEvidenceSource: workflow.latestExecutionEvidenceSource || "none",
    latestExecutionEvidenceLabel: workflow.latestExecutionEvidenceLabel || "No recent execution evidence",
    hasUnwrittenRepoChanges: Boolean(workflow.hasUnwrittenRepoChanges),
    writebackDrift: workflow.writebackDrift || "not_applicable",
    linkedSpecTitle: workflow.linkedSpecTitle || null,
    linkedPlanTitle: workflow.linkedPlanTitle || null,
    fallbackRepoChangeSummary: workflow.fallbackRepoChangeSummary || null
  };
}

function buildSuperpowersRecentEntries(overviewSources, recentChangeSummaries, repoFacts = {}) {
  const workflow = overviewSources.superpowers?.workflow || {};
  if (workflow.latestExecutionEvidenceSource !== "repo_fallback") {
    return recentChangeSummaries;
  }

  const repoFallback = repoFacts.repoChangeFallback || {};
  return [
    {
      id: "repo-fallback",
      type: "repo_change_inferred",
      title: workflow.latestExecutionEvidenceLabel || "Repo-visible changes inferred",
      summary: workflow.fallbackRepoChangeSummary || repoFallback.fallbackRepoChangeSummary || "Repo-visible changes were detected.",
      createdAt: repoFallback.latestRepoVisibleUpdateAt || repoFallback.latestCommitTimestamp || null,
      evidenceSource: "repo_fallback",
      gitDiff: false
    },
    ...recentChangeSummaries
  ].slice(0, 2);
}

function buildSuperpowersPendingReviewItems(overviewSources, workflowGuidance = null) {
  const workflow = overviewSources.superpowers?.workflow || {};
  if (!workflow.hasUnwrittenRepoChanges) {
    return [];
  }

  const workflowStage = workflowGuidance?.workflowStage || "closeout_needed";
  const recommendedNextAction = workflowGuidance?.recommendedNextAction || "write back closeout state";
  const recommendedNextReason = workflowGuidance?.recommendedNextReason || "Repo-visible changes exist without a newer formal closeout record.";

  return [
    {
      id: "superpowers-writeback-drift",
      label: "Repo changed without a newer Superpowers closeout run",
      detail: `Current workflow stage: ${workflowStage}. ${recommendedNextReason} Recommended next action: ${recommendedNextAction}. Write back project_state.json and append a new runs/*.json record before treating the latest repo change as formally closed out.`,
      viewId: "instruction-center",
      severity: "high"
    }
  ];
}

function buildSuperpowersInstructionGuidance(overviewSources) {
  const workflow = overviewSources.superpowers?.workflow || {};
  if (!workflow.hasUnwrittenRepoChanges) {
    return null;
  }

  const extraReasons = workflow.writebackDrift === "missing_formal_writeback"
    ? ["Repo-visible changes were detected, but no formal Superpowers closeout run was found."]
    : ["Repo-visible changes are newer than the latest formal Superpowers closeout run."];

  return {
    overridePrimaryType: "同步文档",
    extraReasons,
    extraRequiredContext: [
      "latest changed files",
      "actual commands run",
      "actual tests run",
      "closeout summary"
    ],
    firstActionHint: "Write back project_state.json and a new runs record before continuing implementation guidance."
  };
}

function appendSuperpowersMarkdownSection(lines, currentState) {
  const summary = currentState.summary || {};
  if (!summary.superpowersWorkflowState || summary.superpowersWorkflowState === "not_used") {
    return;
  }

  lines.push("", "## Superpowers Workflow", "");
  lines.push(`- workflow state: ${summary.superpowersWorkflowState}`);
  lines.push(`- evidence source: ${summary.latestExecutionEvidenceSource}`);
  lines.push(`- evidence label: ${summary.latestExecutionEvidenceLabel}`);
  lines.push(`- writeback drift: ${summary.writebackDrift}`);
  if (summary.linkedSpecTitle) {
    lines.push(`- linked spec: ${summary.linkedSpecTitle}`);
  }
  if (summary.linkedPlanTitle) {
    lines.push(`- linked plan: ${summary.linkedPlanTitle}`);
  }
  if (summary.fallbackRepoChangeSummary) {
    lines.push(`- fallback summary: ${summary.fallbackRepoChangeSummary}`);
  }
}

module.exports = {
  appendSuperpowersMarkdownSection,
  buildSuperpowersInstructionGuidance,
  buildSuperpowersPendingReviewItems,
  buildSuperpowersRecentEntries,
  buildSuperpowersSummaryFields
};
