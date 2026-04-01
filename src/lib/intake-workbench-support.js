const path = require("node:path");
const {
  CONTROL_DIR_NAME,
  GAME_DESIGN_FILE_NAME,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  SCHEMA_VERSION,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME
} = require("./constants");
const {
  buildDefaultProjectState,
  normalizeProjectState
} = require("./state-generator");

const NEW_PROJECT_FIELD_SEQUENCE = [
  { key: "projectPath", label: "项目路径", includeInPrompt: false, guidance: "填写 Windows 本机 git repo 绝对路径；这项通常不需要 GPT 推断。" },
  { key: "projectName", label: "项目名称", guidance: "给出一个稳定、易识别的项目名，尽量与 repo 名或产品名一致。" },
  { key: "oneLineDefinition", label: "项目一句话定义", guidance: "用一句话回答“这个项目是什么，用户或玩家在里面主要做什么”。" },
  { key: "finalGoal", label: "终版目标", guidance: "描述项目最终想做成的完整形态，而不是当前版本的小目标。" },
  { key: "currentVersionTarget", label: "当前版本目标", guidance: "只写这个版本必须做到什么，尽量可验证、可收敛。" },
  { key: "currentVersionNonScope", label: "当前版本不做什么", guidance: "明确这版不做的范围，避免目标漂移。" },
  { key: "projectType", label: "项目类型", guidance: "在 game / tool / website / client 里选最接近的一类。" },
  { key: "targetUsers", label: "目标用户", guidance: "回答这是给谁用的，或者主要玩家是谁。" },
  { key: "targetExperience", label: "目标体验", guidance: "回答希望用户或玩家感受到什么，例如轻量、爽快、低门槛、专注。" },
  { key: "techPreferences", label: "技术偏好", guidance: "写你倾向采用的技术、引擎、语言或平台。" },
  { key: "techConstraints", label: "技术约束", guidance: "写不能突破的限制，例如必须 Windows 原生、必须保持现有栈、不能上后端。" },
  { key: "useSuperpowers", label: "是否使用 Superpowers 严格流程", guidance: "如果后续开发必须严格遵守 docs/superpowers/specs 与 plans 的流程，这里设为 true。" },
  { key: "gameCategory", label: "游戏分类", gameOnly: true, guidance: "游戏项目再填，回答是 idle / clicker / fishing / simulation 之类哪一类。" },
  { key: "coreGameplay", label: "核心玩法一句话", gameOnly: true, guidance: "游戏项目再填，用一句话写清玩家核心操作和主要反馈。" },
  { key: "visualDirection", label: "画面方向", gameOnly: true, guidance: "游戏项目再填，回答像素 / 写实 / UI 原型 / 占位资源等风格方向。" },
  { key: "backendExpectation", label: "是否预期有后端", guidance: "回答 yes / no / unknown，重点是预期是否需要服务端能力。" },
  { key: "networkingExpectation", label: "是否预期联网 / 离线", guidance: "回答 online_expected / offline_supported / offline_only / unknown。" }
];

function buildNewProjectPromptBundle(draft, options = {}) {
  const missingFields = collectNewProjectDraftGaps(draft);
  const fieldSuggestions = buildNewProjectFieldSuggestions(draft);
  const structuredDraftTemplate = JSON.stringify(buildStructuredDraftTemplate(draft), null, 2);
  const strongFillTargets = uniqueStrings([
    !text(draft.targetExperience) ? "targetExperience" : null,
    !text(draft.techPreferences) ? "techPreferences" : null,
    !text(draft.techConstraints) ? "techConstraints" : null,
    draft.projectType === "game" && !text(draft.gameCategory) ? "gameCategory" : null,
    draft.projectType === "game" && !text(draft.coreGameplay) ? "coreGameplay" : null,
    draft.projectType === "game" && !text(draft.visualDirection) ? "visualDirection" : null
  ]);
  const conciseDraft = buildConciseDraftSummary(draft);
  const superpowersLines = draft.useSuperpowers ? [
    "Superpowers mode: enabled.",
    "Future repo-side development must strictly follow docs/superpowers/specs/** and docs/superpowers/plans/** when those materials exist."
  ] : [];
  const skillList = [
    "codex-project-handoff",
    "codex-task-closeout-writeback",
    "codex-project-recovery-scan"
  ];

  return {
    workflowState: options.workflowState || null,
    gptDraftPrompt: [
      "Please fill the remaining new-project filing fields based on the confirmed draft below.",
      "Rules:",
      "1. Do not invent repo facts; this is still a filing draft.",
      "2. Prefer recommended values over writing needs_confirmation into main fields.",
      "3. Put uncertainty into _notes.assumptions / _notes.recommended_options / _notes.clarification_questions.",
      "4. Return JSON only if possible.",
      "5. If the project is a game, also fill gameCategory, coreGameplay, visualDirection, backendExpectation, networkingExpectation.",
      "6. At most 3 clarification questions.",
      "Focus fill targets: " + (strongFillTargets.join(" / ") || "none"),
      "",
      "Missing fields: " + (missingFields.join(", ") || "none"),
      "",
      "Return JSON using this shape:",
      structuredDraftTemplate,
      "",
      ...conciseDraft
    ].join("\n"),
    codexStructurePrompt: [
      "Run this in the target repo Codex session, not inside the dashboard.",
      "Use repo-local skill codex-project-handoff first.",
      "If repo-local skills exist, prefer this sequence:",
      ...skillList.map((item) => "- " + item),
      "",
      "Goal: complete the first control-plane blueprint from confirmed filing info without changing business code.",
      "Write or update: project_brief.json, module_map.json, tech_stack.json, game_design.json (if game), version_state.json, project_state.json.",
      "Rules:",
      "1. Tighten blueprint first; do not jump into feature implementation.",
      "2. module_map must contain a usable first-pass module map, not only unknown placeholders.",
      "3. version_state should define version target, non-scope, DoD, validation basis, phase, first work package, and current slice module mapping.",
      "4. project_state should keep current execution state and fixed-deliverable frame only; do not fabricate runs or tests.",
      "5. If direction-defining information is missing, ask the minimum necessary questions and stop at blueprint confirmation.",
      "6. Facts priority: confirmed filing > repo-verifiable facts > other notes.",
      "7. Only move toward implementation after codex-project-handoff judges the repo ready_for_implementation.",
      "8. After later tasks complete, use codex-task-closeout-writeback to update project_state.json and runs/<timestamp>.json.",
      ...superpowersLines,
      "",
      ...conciseDraft
    ].join("\n"),
    missingFields,
    fieldSuggestions,
    structuredDraftTemplate
  };
}

function buildRecoveryPromptBundle(session, snapshot, provisional) {
  const summary = provisional || summarizeRecoverySnapshot(snapshot, session);
  const superpowersLines = session?.useSuperpowers ? [
    "Superpowers mode: enabled.",
    "Future repo-side development and recovery should strictly follow docs/superpowers/specs/** and docs/superpowers/plans/** when those materials exist."
  ] : [];
  return {
    codexScanPrompt: [
      "Run this in the target repo Codex session, not inside the dashboard.",
      "Use repo-local skill codex-project-recovery-scan first.",
      "If repo-local skills exist, prefer this sequence:",
      "- codex-project-recovery-scan",
      "- codex-project-handoff",
      "- codex-task-closeout-writeback",
      "",
      "Goal: scan the repo and recover control-state source files without modifying business code.",
      "Fill or update: project_brief.json, module_map.json, tech_stack.json, game_design.json (if game), version_state.json, project_state.json, runs/*.json.",
      "Rules:",
      "1. Repo facts override chat descriptions.",
      "2. Keep unknown fields as unknown / needs_confirmation rather than fabricating conclusions.",
      "3. Report current slice, recent change summaries, test state, consistency declared, and technical clues.",
      "4. If direction-defining gaps remain, list them clearly instead of deciding for the user.",
      "5. Report which files were filled, which fields remain unresolved, and whether the repo is ready_for_implementation.",
      ...superpowersLines,
      "",
      "Project name: " + (session.projectName || "missing"),
      "Project path: " + (session.projectPath || "missing"),
      "Coarse judgment: " + (session.coarseJudgment || "missing"),
      "Key questions: " + (session.keyQuestions.join("; ") || "missing"),
      "Provisional summary: " + (summary.summary.join("; ") || "none"),
      "Unresolved items: " + (summary.unresolved.join("; ") || "none")
    ].join("\n"),
    unresolvedItems: summary.unresolved
  };
}

function summarizeRecoverySnapshot(snapshot, session) {
  const summary = [];
  const unresolved = [];

  if (snapshot?.summary) {
    summary.push(`当前可动作状态：${snapshot.summary.currentActionState}`);
    if (snapshot.summary.oneLineDefinition) {
      summary.push(`项目定义：${snapshot.summary.oneLineDefinition}`);
    }
    if (snapshot.summary.versionTarget) {
      summary.push(`当前版本目标：${snapshot.summary.versionTarget}`);
    }
  }

  if (session?.coarseJudgment) {
    summary.push(`粗判断：${session.coarseJudgment}`);
  }
  if (session?.keyQuestions?.length) {
    unresolved.push(...session.keyQuestions);
  }

  const needsConfirmation = snapshot?.detail?.baseline
    ? [
        ...(snapshot.detail.baseline.projectBrief?.needsConfirmation || []),
        ...(snapshot.detail.baseline.moduleMap?.needsConfirmation || []),
        ...(snapshot.detail.baseline.techStack?.needsConfirmation || []),
        ...(snapshot.detail.versionControl?.versionState?.needsConfirmation || [])
      ]
    : [];
  unresolved.push(...needsConfirmation);

  return {
    summary: uniqueStrings(summary).slice(0, 8),
    unresolved: uniqueStrings(unresolved).slice(0, 10)
  };
}

function buildNewProjectWritebackPreview(projectRecord, draft, existingFiles = {}) {
  const payloads = buildNewProjectSourcePayloads(projectRecord.name, draft, existingFiles.projectState);
  const filePlans = Object.entries(payloads).map(([fileName, nextPayload]) => {
    const existingPayload = existingFiles[fileName] || null;
    const updatedFields = collectChangedLeafPaths(existingPayload, nextPayload);
    const overwrittenFields = collectOverwrittenLeafPaths(existingPayload, nextPayload);
    return {
      fileName,
      filePath: path.join(projectRecord.rootPath, CONTROL_DIR_NAME, fileName),
      status: existingPayload ? (updatedFields.length ? "updated" : "unchanged") : "created",
      updatedFields,
      overwrittenFields,
      willOverwriteOldValues: overwrittenFields.length > 0,
      sourceKinds: collectSourceKinds(nextPayload),
      nextPayload
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    actionBoundary: "explicit_maintenance_write",
    previewOnly: true,
    files: filePlans.map((item) => ({
      fileName: item.fileName,
      filePath: item.filePath,
      status: item.status,
      updatedFields: item.updatedFields,
      overwrittenFields: item.overwrittenFields,
      willOverwriteOldValues: item.willOverwriteOldValues,
      sourceKinds: item.sourceKinds
    })),
    _internalPlan: Object.fromEntries(filePlans.map((item) => [item.fileName, item.nextPayload])),
    updatedFiles: filePlans.filter((item) => item.status !== "unchanged").map((item) => item.fileName),
    stillUnknown: collectNewProjectWritebackUnknowns(draft),
    minimumQuestions: buildMinimumQuestions(collectNewProjectWritebackUnknowns(draft))
  };
}

function applyNewProjectWritebackPreview(preview) {
  return {
    generatedAt: new Date().toISOString(),
    actionBoundary: "explicit_maintenance_write",
    previewOnly: false,
    files: preview.files,
    updatedFiles: preview.updatedFiles,
    stillUnknown: preview.stillUnknown,
    minimumQuestions: preview.minimumQuestions
  };
}

function collectNewProjectDraftGaps(draft) {
  return uniqueStrings([
    draft.projectName ? null : "项目名称",
    draft.oneLineDefinition ? null : "项目一句话定义",
    draft.finalGoal ? null : "终版目标",
    draft.currentVersionTarget ? null : "当前版本目标",
    draft.currentVersionNonScope ? null : "当前版本不做什么",
    draft.projectType && draft.projectType !== "unknown" ? null : "项目类型",
    draft.targetUsers ? null : "目标用户",
    draft.targetExperience ? null : "目标体验",
    draft.techPreferences ? null : "技术偏好",
    draft.techConstraints ? null : "技术约束",
    draft.projectType === "game" && !draft.gameCategory ? "游戏分类" : null,
    draft.projectType === "game" && !draft.coreGameplay ? "核心玩法一句话" : null,
    draft.projectType === "game" && !draft.visualDirection ? "画面方向" : null
  ]);
}

function collectNewProjectWritebackUnknowns(draft) {
  return uniqueStrings([
    draft.targetUsers ? null : "目标用户",
    draft.targetExperience ? null : "目标体验",
    draft.techPreferences ? null : "技术偏好",
    draft.techConstraints ? null : "技术约束",
    "模块地图",
    "第一工作包",
    "验证矩阵",
    draft.projectType === "game" && !draft.gameCategory ? "游戏分类" : null,
    draft.projectType === "game" && !draft.coreGameplay ? "核心玩法一句话" : null
  ]);
}

function buildNewProjectSourcePayloads(displayName, draft, existingProjectState) {
  const now = new Date().toISOString();
  const projectStateBase = normalizeProjectState(
    existingProjectState || buildDefaultProjectState(displayName),
    displayName
  );

  const nextProjectState = {
    ...projectStateBase,
    project: {
      ...projectStateBase.project,
      name: draft.projectName || displayName
    },
    status: {
      ...projectStateBase.status,
      versionTarget: executionField(draft.currentVersionTarget || "unknown", now),
      currentStage: executionField("drafting", now),
      currentWorkPackage: executionField("unknown", now),
      lastUpdatedAt: now
    }
  };

  return {
    [PROJECT_BRIEF_FILE_NAME]: {
      schemaVersion: SCHEMA_VERSION,
      kind: "project_brief",
      projectName: draft.projectName || displayName,
      oneLineDefinition: declaredSourceField(draft.oneLineDefinition),
      finalGoal: declaredSourceField(draft.finalGoal),
      projectType: declaredSourceField(draft.projectType || "unknown"),
      targetUsers: declaredSourceField(draft.targetUsers),
      targetExperience: declaredSourceField(draft.targetExperience),
      targetOutcome: unknownSourceField(),
      scopeIn: unknownSourceField(),
      scopeOut: declaredSourceField(draft.currentVersionNonScope),
      knownFacts: [],
      declaredItems: buildDeclaredEntries([
        ["confirmed_project_definition", draft.oneLineDefinition],
        ["confirmed_final_goal", draft.finalGoal],
        ["confirmed_version_target", draft.currentVersionTarget],
        ["confirmed_version_non_scope", draft.currentVersionNonScope]
      ]),
      supplementalItems: [],
      needsConfirmation: collectNewProjectWritebackUnknowns(draft)
    },
    [TECH_STACK_FILE_NAME]: {
      schemaVersion: SCHEMA_VERSION,
      kind: "tech_stack",
      frontendClient: declaredSourceField(draft.techPreferences),
      rendering: draft.projectType === "game" ? declaredSourceField(draft.visualDirection) : unknownSourceField(),
      uiTech: unknownSourceField(),
      stateManagement: unknownSourceField(),
      storage: unknownSourceField(),
      buildRun: declaredSourceField(draft.techConstraints),
      backend: {
        exists: declaredSourceField(normalizeBackendExpectation(draft.backendExpectation)),
        technology: unknownSourceField(),
        responsibility: unknownSourceField()
      },
      infrastructure: [],
      knownFacts: [],
      declaredItems: buildDeclaredEntries([
        ["tech_preferences", draft.techPreferences],
        ["tech_constraints", draft.techConstraints],
        ["backend_expectation", normalizeBackendExpectation(draft.backendExpectation)]
      ]),
      supplementalItems: [],
      needsConfirmation: uniqueStrings([
        draft.techPreferences ? null : "技术偏好",
        draft.techConstraints ? null : "技术约束",
        "UI 技术",
        "状态管理 / 数据流",
        "构建与启动方式"
      ])
    },
    [VERSION_STATE_FILE_NAME]: {
      schemaVersion: SCHEMA_VERSION,
      kind: "version_state",
      version_id: `version-${normalizeId(draft.currentVersionTarget || "current")}`,
      work_package_id: "work-package-unknown",
      versionTarget: declaredSourceField(draft.currentVersionTarget),
      versionNonScope: buildDeclaredEntries([["current_version_non_scope", draft.currentVersionNonScope]]),
      definitionOfDone: [],
      keyRisks: [],
      blockers: [],
      verificationSummary: unknownSourceField(),
      verificationMatrix: [],
      goNoGoStatus: unknownSourceField(),
      currentStage: declaredSourceField("drafting"),
      currentWorkPackage: unknownSourceField(),
      currentSliceModule: {
        moduleId: "module-unknown",
        moduleName: "unknown",
        source: "needs_confirmation",
        source_ref: "needs_confirmation",
        confidence: "low",
        last_updated_at: null,
        sourceKind: "needs_confirmation"
      },
      knownFacts: [],
      declaredItems: buildDeclaredEntries([
        ["version_target", draft.currentVersionTarget],
        ["version_non_scope", draft.currentVersionNonScope]
      ]),
      supplementalItems: [],
      needsConfirmation: uniqueStrings([
        "完成定义（DoD）",
        "验证矩阵",
        "当前工作包",
        "当前切片所属模块",
        "go / no-go 状态"
      ])
    },
    [PROJECT_STATE_FILE_NAME]: nextProjectState,
    ...(draft.projectType === "game"
      ? {
          [GAME_DESIGN_FILE_NAME]: {
            schemaVersion: SCHEMA_VERSION,
            kind: "game_design",
            gameCategory: declaredSourceField(draft.gameCategory),
            coreGameplayLoop: declaredSourceField(draft.coreGameplay),
            progressionLoop: unknownSourceField(),
            rewardLoop: unknownSourceField(),
            offlineProgression: declaredSourceField(draft.networkingExpectation === "offline_supported" ? "expected" : ""),
            automation: unknownSourceField(),
            visualDirection: declaredSourceField(draft.visualDirection),
            primaryScreens: unknownSourceField(),
            playerExperienceGoal: declaredSourceField(draft.targetExperience),
            currentPlayableState: declaredSourceField("not_started"),
            needsConfirmation: uniqueStrings([
              draft.gameCategory ? null : "游戏分类",
              draft.coreGameplay ? null : "核心玩法一句话",
              draft.visualDirection ? null : "画面方向",
              "成长循环",
              "收益循环",
              "主要界面构成"
            ])
          }
        }
      : {})
  };
}

function buildNewProjectFieldSuggestions(draft) {
  return getNewProjectFieldSequence(draft).map((item) => {
    const value = text(draft[item.key]);
    return {
      key: item.key,
      label: item.label,
      currentValue: value || "待补",
      status: value ? "filled" : "missing",
      guidance: item.guidance
    };
  });
}

function getNewProjectFieldSequence(draft = {}) {
  return NEW_PROJECT_FIELD_SEQUENCE.filter((item) => !item.gameOnly || draft.projectType === "game");
}

function buildStructuredDraftTemplate(draft) {
  const template = {};
  NEW_PROJECT_FIELD_SEQUENCE.forEach((item) => {
    template[item.key] = item.key === "useSuperpowers" ? Boolean(draft[item.key]) : text(draft[item.key]) || "";
  });
  template._notes = {
    assumptions: ["写本次补全依赖的默认假设，例如默认先做单机、默认先做轻量美术风格。"],
    recommended_options: [{ field: "techPreferences", recommended: "", alternatives: [], reason: "" }],
    clarification_questions: [{ field: "visualDirection", question: "" }],
    optional_comments: ""
  };
  return template;
}

function buildConciseDraftSummary(draft) {
  const lines = [
    "Project name: " + (draft.projectName || "missing"),
    "One-line definition: " + (draft.oneLineDefinition || "missing"),
    "Final goal: " + (draft.finalGoal || "missing"),
    "Current version target: " + (draft.currentVersionTarget || "missing"),
    "Current version non-scope: " + (draft.currentVersionNonScope || "missing"),
    "Project type: " + (draft.projectType || "missing"),
    "Target users: " + (draft.targetUsers || "missing"),
    "Target experience: " + (draft.targetExperience || "missing"),
    "Tech preferences: " + (draft.techPreferences || "missing"),
    "Tech constraints: " + (draft.techConstraints || "missing"),
    "Use Superpowers: " + (draft.useSuperpowers ? "true" : "false")
  ];
  if (draft.projectType === "game") {
    lines.push("Game category: " + (draft.gameCategory || "missing"));
    lines.push("Core gameplay: " + (draft.coreGameplay || "missing"));
    lines.push("Visual direction: " + (draft.visualDirection || "missing"));
    lines.push("Backend / networking expectation: " + (draft.backendExpectation || "missing") + " / " + (draft.networkingExpectation || "missing"));
  }
  return lines;
}

function buildMinimumQuestions(items) {
  return uniqueStrings(items).slice(0, 5);
}

function declaredSourceField(value) {
  if (!text(value)) {
    return unknownSourceField();
  }
  return {
    value: text(value),
    source: "user_confirmed_intake",
    source_ref: "user_confirmed_intake",
    confidence: "medium",
    last_updated_at: new Date().toISOString(),
    sourceKind: "declared"
  };
}

function unknownSourceField() {
  return {
    value: "unknown",
    source: "needs_confirmation",
    source_ref: "needs_confirmation",
    confidence: "low",
    last_updated_at: null,
    sourceKind: "needs_confirmation"
  };
}

function executionField(value, now) {
  return {
    value: text(value) || "unknown",
    source: "user_confirmed_intake",
    updatedAt: now
  };
}

function buildDeclaredEntries(entries) {
  return entries
    .filter(([, value]) => text(value))
    .map(([label, value]) => ({
      label,
      value: text(value),
      source: "user_confirmed_intake",
      source_ref: "user_confirmed_intake",
      confidence: "medium",
      last_updated_at: new Date().toISOString(),
      sourceKind: "declared"
    }));
}

function normalizeBackendExpectation(value) {
  const normalized = text(value);
  if (!normalized) return "unknown";
  if (["yes", "expected", "required"].includes(normalized)) return "yes";
  if (["no", "not_expected", "not_needed"].includes(normalized)) return "no";
  return normalized;
}

function collectChangedLeafPaths(existingValue, nextValue, prefix = "", results = []) {
  if (Array.isArray(nextValue)) {
    if (!Array.isArray(existingValue) || JSON.stringify(existingValue) !== JSON.stringify(nextValue)) {
      results.push(prefix || "root");
    }
    return uniqueStrings(results);
  }

  if (typeof nextValue === "object" && nextValue !== null) {
    const keys = new Set([
      ...Object.keys(existingValue && typeof existingValue === "object" ? existingValue : {}),
      ...Object.keys(nextValue)
    ]);
    keys.forEach((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectChangedLeafPaths(existingValue ? existingValue[key] : undefined, nextValue[key], nextPrefix, results);
    });
    return uniqueStrings(results);
  }

  if (existingValue !== nextValue) {
    results.push(prefix || "root");
  }
  return uniqueStrings(results);
}

function collectOverwrittenLeafPaths(existingValue, nextValue, prefix = "", results = []) {
  if (nextValue === undefined) {
    return uniqueStrings(results);
  }
  if (Array.isArray(nextValue)) {
    if (Array.isArray(existingValue) && existingValue.length && JSON.stringify(existingValue) !== JSON.stringify(nextValue)) {
      results.push(prefix || "root");
    }
    return uniqueStrings(results);
  }
  if (typeof nextValue === "object" && nextValue !== null) {
    Object.keys(nextValue).forEach((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectOverwrittenLeafPaths(existingValue ? existingValue[key] : undefined, nextValue[key], nextPrefix, results);
    });
    return uniqueStrings(results);
  }
  if (!isUnknownLike(existingValue) && existingValue !== nextValue) {
    results.push(prefix || "root");
  }
  return uniqueStrings(results);
}

function collectSourceKinds(value, results = new Set()) {
  if (!value) return [];
  if (Array.isArray(value)) {
    value.forEach((item) => collectSourceKinds(item, results));
    return [...results];
  }
  if (typeof value === "object") {
    if (value.sourceKind) {
      results.add(value.sourceKind);
    }
    Object.values(value).forEach((item) => collectSourceKinds(item, results));
  }
  return [...results];
}

function isUnknownLike(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "" || value === "unknown";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    if ("value" in value) return isUnknownLike(value.value);
    return Object.keys(value).length === 0;
  }
  return false;
}

function normalizeId(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function text(value) {
  return String(value ?? "").trim();
}

module.exports = {
  applyNewProjectWritebackPreview,
  buildNewProjectPromptBundle,
  buildNewProjectWritebackPreview,
  buildRecoveryPromptBundle,
  collectNewProjectDraftGaps,
  summarizeRecoverySnapshot
};
