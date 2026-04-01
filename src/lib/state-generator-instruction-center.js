function collectPendingDecisions(decisionLog) {
  return (decisionLog?.decisions || []).filter((item) => {
    const status = normalizeValue(item.status);
    return ["pending", "open", "needs_decision", "unresolved"].includes(status);
  });
}

function buildDecisionImpactRows(decisionLog) {
  return (decisionLog?.decisions || []).map((item) => ({
    title: item.title,
    status: item.status,
    versions: item.related_versions || [],
    modules: item.related_modules || [],
    risks: item.related_risks || []
  }));
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = {
  buildDecisionImpactRows,
  collectPendingDecisions
};
