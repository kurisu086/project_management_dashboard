function buildSuperpowersWorkflowState({ superpowers = null, repoFacts = null, projectState = null } = {}) {
  const normalizedSuperpowers = normalizeSuperpowers(superpowers);
  const normalizedRepoFacts = normalizeRepoFacts(repoFacts);
  const normalizedProjectState = projectState || {};
  const latestFormalRun = pickLatestFormalRun(normalizedProjectState.evidence?.history);
  const latestSpec = pickLatestDoc(normalizedSuperpowers.evidence.specs);
  const latestPlan = pickLatestDoc(normalizedSuperpowers.evidence.plans);
  const repoFallback = normalizedRepoFacts.repoChangeFallback;
  const repoFallbackHasChanges = Boolean(
    repoFallback.hasRepoVisibleChanges
      && parseTimestamp(repoFallback.latestRepoVisibleUpdateAt) !== null
  );
  const repoFallbackIsNewer = Boolean(
    repoFallbackHasChanges
      && compareIso(repoFallback.latestRepoVisibleUpdateAt, latestFormalRun?.createdAt) > 0
  );

  if (!hasAnySuperpowersEvidence(normalizedSuperpowers, latestFormalRun, normalizedRepoFacts)) {
    return {
      workflowState: "not_used",
      latestExecutionEvidenceSource: "none",
      latestExecutionEvidenceLabel: "Superpowers workflow is not used in this repo.",
      hasUnwrittenRepoChanges: false,
      writebackDrift: "not_applicable",
      linkedSpecTitle: null,
      linkedPlanTitle: null,
      fallbackRepoChangeSummary: repoFallback.fallbackRepoChangeSummary,
      latestFormalRun: null,
      repoLocalSkills: normalizedRepoFacts.repoLocalSkills
    };
  }

  if (repoFallbackHasChanges && (repoFallbackIsNewer || !latestFormalRun)) {
    const driftKind = latestFormalRun ? "repo_ahead_of_writeback" : "missing_formal_writeback";
    return {
      workflowState: "repo_changed_without_closeout",
      latestExecutionEvidenceSource: "repo_fallback",
      latestExecutionEvidenceLabel: latestFormalRun
        ? "Repo-visible changes after the latest formal run."
        : "Repo-visible changes were detected without a formal closeout run.",
      hasUnwrittenRepoChanges: true,
      writebackDrift: driftKind,
      linkedSpecTitle: latestSpec?.title || null,
      linkedPlanTitle: latestPlan?.title || null,
      fallbackRepoChangeSummary: repoFallback.fallbackRepoChangeSummary,
      latestFormalRun,
      repoLocalSkills: normalizedRepoFacts.repoLocalSkills
    };
  }

  if (latestFormalRun) {
    return {
      workflowState: "executed_and_written_back",
      latestExecutionEvidenceSource: "formal_run",
      latestExecutionEvidenceLabel: latestFormalRun.title || "Latest formal run",
      hasUnwrittenRepoChanges: false,
      writebackDrift: "aligned",
      linkedSpecTitle: latestSpec?.title || null,
      linkedPlanTitle: latestPlan?.title || null,
      fallbackRepoChangeSummary: repoFallback.fallbackRepoChangeSummary,
      latestFormalRun,
      repoLocalSkills: normalizedRepoFacts.repoLocalSkills
    };
  }

  if (normalizedSuperpowers.hasPlans) {
    return {
      workflowState: "planned_not_executed",
      latestExecutionEvidenceSource: "none",
      latestExecutionEvidenceLabel: "Specs and plans are present, but no formal run was found.",
      hasUnwrittenRepoChanges: false,
      writebackDrift: "insufficient_evidence",
      linkedSpecTitle: latestSpec?.title || null,
      linkedPlanTitle: latestPlan?.title || null,
      fallbackRepoChangeSummary: repoFallback.fallbackRepoChangeSummary,
      latestFormalRun: null,
      repoLocalSkills: normalizedRepoFacts.repoLocalSkills
    };
  }

  if (normalizedSuperpowers.hasSpecs) {
    return {
      workflowState: "docs_only",
      latestExecutionEvidenceSource: "none",
      latestExecutionEvidenceLabel: "Only supplemental docs are present.",
      hasUnwrittenRepoChanges: false,
      writebackDrift: "insufficient_evidence",
      linkedSpecTitle: latestSpec?.title || null,
      linkedPlanTitle: latestPlan?.title || null,
      fallbackRepoChangeSummary: repoFallback.fallbackRepoChangeSummary,
      latestFormalRun: null,
      repoLocalSkills: normalizedRepoFacts.repoLocalSkills
    };
  }

  return {
    workflowState: "insufficient_evidence",
    latestExecutionEvidenceSource: "none",
    latestExecutionEvidenceLabel: "Superpowers evidence is incomplete.",
    hasUnwrittenRepoChanges: false,
    writebackDrift: "insufficient_evidence",
    linkedSpecTitle: latestSpec?.title || null,
    linkedPlanTitle: latestPlan?.title || null,
    fallbackRepoChangeSummary: repoFallback.fallbackRepoChangeSummary,
    latestFormalRun,
    repoLocalSkills: normalizedRepoFacts.repoLocalSkills
  };
}

function normalizeSuperpowers(superpowers) {
  const specs = normalizeDocItems(superpowers?.evidence?.specs);
  const plans = normalizeDocItems(superpowers?.evidence?.plans);
  return {
    status: superpowers?.status || "not_used",
    hasDirectory: Boolean(superpowers?.hasDirectory),
    hasSpecs: Boolean(superpowers?.hasSpecs || specs.length > 0),
    hasPlans: Boolean(superpowers?.hasPlans || plans.length > 0),
    evidence: {
      specs,
      plans
    }
  };
}

function normalizeRepoFacts(repoFacts) {
  const fallback = repoFacts?.repoChangeFallback || {};
  return {
    repoChangeFallback: {
      latestCommitHash: fallback.latestCommitHash || null,
      latestCommitSummary: fallback.latestCommitSummary || null,
      latestCommitTimestamp: fallback.latestCommitTimestamp || null,
      latestRepoVisibleUpdateAt: fallback.latestRepoVisibleUpdateAt || null,
      hasRepoVisibleChanges: Boolean(fallback.hasRepoVisibleChanges),
      workingTreeDirty: Boolean(fallback.workingTreeDirty),
      changedFiles: Array.isArray(fallback.changedFiles) ? fallback.changedFiles : [],
      fallbackRepoChangeSummary: fallback.fallbackRepoChangeSummary || "No repo-visible fallback evidence is available."
    },
    repoLocalSkills: normalizeRepoLocalSkills(repoFacts?.repoLocalSkills)
  };
}

function hasAnySuperpowersEvidence(superpowers, latestFormalRun, repoFacts) {
  return Boolean(
    latestFormalRun
      || superpowers.hasDirectory
      || superpowers.hasSpecs
      || superpowers.hasPlans
      || Object.values(repoFacts.repoLocalSkills).some((entry) => entry.exists)
  );
}

function normalizeDocItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(Boolean)
    .map((item) => ({
      title: String(item.title || item.file || "").trim() || null,
      summary: String(item.summary || "").trim(),
      file: String(item.file || "").trim() || null,
      updatedAt: item.updatedAt || null
    }))
    .filter((item) => item.title || item.file);
}

function pickLatestDoc(items) {
  return [...items].sort((left, right) => {
    const leftTime = parseTimestamp(left.updatedAt);
    const rightTime = parseTimestamp(right.updatedAt);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    if (leftTime !== null && rightTime === null) {
      return -1;
    }
    if (leftTime === null && rightTime !== null) {
      return 1;
    }
    return String(left.title || left.file || "").localeCompare(String(right.title || right.file || ""));
  })[0] || null;
}

function pickLatestFormalRun(history) {
  if (!Array.isArray(history)) {
    return null;
  }

  const runEntries = history
    .filter((entry) => entry && entry.type === "run")
    .map((entry) => ({
      id: entry.id || null,
      type: "run",
      title: entry.title || null,
      summary: entry.summary || null,
      createdAt: entry.createdAt || null,
      file: entry.file || null
    }));

  return [...runEntries].sort((left, right) => {
    const leftTime = parseTimestamp(left.createdAt);
    const rightTime = parseTimestamp(right.createdAt);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    if (leftTime !== null && rightTime === null) {
      return -1;
    }
    if (leftTime === null && rightTime !== null) {
      return 1;
    }
    return String(left.id || left.file || left.title || "").localeCompare(String(right.id || right.file || right.title || ""));
  })[0] || null;
}

function normalizeRepoLocalSkills(repoLocalSkills) {
  const slots = ["handoff", "closeout", "recovery"];
  return Object.fromEntries(slots.map((slot) => [
    slot,
    {
      name: repoLocalSkills?.[slot]?.name || slot,
      path: repoLocalSkills?.[slot]?.path || null,
      exists: Boolean(repoLocalSkills?.[slot]?.exists),
      files: Array.isArray(repoLocalSkills?.[slot]?.files) ? repoLocalSkills[slot].files : []
    }
  ]));
}

function compareIso(left, right) {
  const leftTime = parseTimestamp(left);
  const rightTime = parseTimestamp(right);
  if (leftTime === null && rightTime === null) {
    return 0;
  }
  if (leftTime === null) {
    return -1;
  }
  if (rightTime === null) {
    return 1;
  }
  return leftTime - rightTime;
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

module.exports = {
  buildSuperpowersWorkflowState
};
