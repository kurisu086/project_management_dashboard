const {
  buildSuperpowersPendingReviewItems
} = require("./state-generator-superpowers");

function buildPendingReviewModel(input = {}) {
  const {
    conflicts = [],
    currentSliceModule = {},
    mergedRisks = [],
    needsConfirmation = [],
    overviewSources,
    verificationMatrix = [],
    workflowGuidance = null
  } = input;
  const userItems = [];
  const cleanupItems = [];
  const conflictItems = [];
  const auditItems = [];

  const addItem = (bucket, id, label, detail, viewId, severity = "medium") => {
    if (!label || bucket.some((item) => item.id === id)) {
      return;
    }
    bucket.push({ id, label, detail, viewId, severity });
  };

  uniqueStrings(needsConfirmation).forEach((item, index) => {
    addItem(
      userItems,
      `needs-confirmation-${index + 1}`,
      item,
      "This still needs user confirmation before the blueprint can be treated as stable.",
      inferPendingReviewView(item)
    );
  });

  if (currentSliceModule?.moduleName === "unknown") {
    addItem(
      userItems,
      "current-slice-module",
      "Current slice -> module mapping still needs confirmation",
      "Confirm which module the current work package belongs to before continuing implementation.",
      "version-cockpit",
      "high"
    );
  }

  verificationMatrix.forEach((item, index) => {
    if (normalizeValue(item.label).startsWith("validation item")) {
      addItem(
        cleanupItems,
        `verification-item-${index + 1}`,
        `Validation item ${index + 1} needs a clearer name`,
        item.note || "Rename this validation item so people can tell what has been checked and what still needs work.",
        "verification-matrix"
      );
    }
  });

  mergedRisks.forEach((item, index) => {
    if (normalizeValue(item.title).startsWith("risk item")) {
      addItem(
        cleanupItems,
        `risk-item-${index + 1}`,
        `Risk item ${index + 1} needs a clearer title`,
        item.detail || "Rename this risk so the team can understand what it blocks or threatens.",
        "risk-blockers"
      );
    }
  });

  conflicts.forEach((item, index) => {
    const sourceConflict = isSourceConflictType(item?.type);
    addItem(
      sourceConflict ? conflictItems : auditItems,
      `${sourceConflict ? "source-conflict" : "audit-conflict"}-${index + 1}`,
      item.message,
      buildConflictImpactHint(item),
      "risk-blockers",
      item.level || "medium"
    );
  });

  buildSuperpowersPendingReviewItems(overviewSources, workflowGuidance).forEach((item) => {
    addItem(auditItems, item.id, item.label, item.detail, item.viewId, item.severity);
  });

  const items = [...userItems, ...cleanupItems, ...conflictItems, ...auditItems];

  return {
    count: items.length,
    signature: items.map((item) => item.id).join("|"),
    items,
    userItems,
    cleanupItems,
    conflictItems,
    auditItems,
    userCount: userItems.length,
    cleanupCount: cleanupItems.length,
    conflictCount: conflictItems.length,
    auditCount: auditItems.length,
    gptPrompt: buildPendingReviewPrompt(userItems),
    codexCleanupPrompt: buildPendingCleanupPrompt(cleanupItems, conflicts)
  };
}

function buildPendingReviewPrompt(items) {
  const lines = [
    "Please help me confirm the remaining blueprint questions below.",
    "Goal: tighten the project definition and version boundary before further implementation.",
    "Rules:",
    "1. Prefer direct recommended answers when reasonable.",
    "2. If there are multiple viable choices, group them as options with pros/cons.",
    "3. Ask at most 5 high-value clarification questions.",
    "",
    "Items that need user confirmation:"
  ];

  if (!items.length) {
    lines.push("- None.");
  } else {
    items.forEach((item) => {
      lines.push(`- ${item.label}: ${item.detail}`);
    });
  }

  lines.push("", "Please respond with:", "1. Recommended confirmations", "2. Optional alternatives", "3. Remaining critical questions");
  return lines.join("\n");
}

function buildPendingCleanupPrompt(cleanupItems, conflicts) {
  const lines = [
    "Please clean up project control-state quality without changing business code.",
    "Goal: make repo-side control files easier to read and more actionable in the dashboard.",
    "Rules:",
    "1. Rename placeholder validation items into concrete repo-grounded verification targets.",
    "2. Rename placeholder risk items into concrete repo-grounded risk titles and scopes.",
    "3. Review source inconsistencies and separate final-goal declarations from current repo-observed facts.",
    "4. Keep true strategic uncertainties as needs_confirmation instead of forcing a false resolution.",
    "",
    "Control-state cleanup items:"
  ];

  if (!cleanupItems.length) {
    lines.push("- No placeholder validation or risk labels remain.");
  } else {
    cleanupItems.forEach((item) => {
      lines.push(`- ${item.label}: ${item.detail}`);
    });
  }

  if (conflicts.length) {
    lines.push("", "Source inconsistencies to review:");
    conflicts.slice(0, 12).forEach((item) => {
      lines.push(`- [${item.level}] ${item.message}`);
    });
  }

  lines.push(
    "",
    "Please respond with:",
    "1. Exact control files to update",
    "2. Proposed renamed validation/risk items",
    "3. Source inconsistencies that should remain unresolved",
    "4. Minimum follow-up questions only if a true strategic answer is still missing"
  );
  return lines.join("\n");
}

function inferPendingReviewView(label) {
  const normalized = normalizeValue(label);
  if (normalized.includes("module")) return "modules";
  if (normalized.includes("version") || normalized.includes("dod") || normalized.includes("work package")) return "version-cockpit";
  if (normalized.includes("verify") || normalized.includes("validation") || normalized.includes("test")) return "verification-matrix";
  if (normalized.includes("risk") || normalized.includes("conflict")) return "risk-blockers";
  if (normalized.includes("tech") || normalized.includes("render") || normalized.includes("backend")) return "tech";
  if (normalized.includes("game") || normalized.includes("visual")) return "game";
  return "definition";
}

function buildConflictImpactHint(conflict) {
  const message = String(conflict?.message || "");
  if (conflict?.type === "run_protocol_incomplete") {
    return "This is a control-file protocol issue in historical run records. It does not mean the business implementation regressed, but it keeps dashboard evidence less trustworthy.";
  }
  if (conflict?.type === "missing_run_file") {
    return "This means a historical run record path could not be resolved. It affects evidence integrity, not current business behavior.";
  }
  if (message.includes("backend")) {
    return "This affects how the dashboard interprets planned backend capability versus what is currently present in the repo.";
  }
  if (message.includes("project_type")) {
    return "This affects how the dashboard classifies the project and which views are emphasized.";
  }
  if (message.includes("validation")) {
    return "This affects whether the dashboard treats verification evidence as aligned and trustworthy.";
  }
  return "If left unresolved, this keeps the dashboard conservative and may lower trust in summaries, diagrams, and action-state reasoning.";
}

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isSourceConflictType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return normalized.startsWith("project_")
    || normalized.startsWith("tech_")
    || normalized.startsWith("game_")
    || normalized.startsWith("version_");
}

module.exports = {
  buildPendingReviewModel
};
