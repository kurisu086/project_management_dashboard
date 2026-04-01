const path = require("node:path");
const {
  SCHEMA_VERSION,
  WORKBENCH_FILE
} = require("./constants");
const {
  ensureDir,
  readJsonIfExists,
  writeJsonAtomic
} = require("./fs-utils");
const {
  applyNewProjectWritebackPreview,
  buildNewProjectPromptBundle,
  buildNewProjectWritebackPreview,
  buildRecoveryPromptBundle,
  collectNewProjectDraftGaps,
  summarizeRecoverySnapshot
} = require("./intake-workbench-support");

const FLOW_STATES = {
  DRAFT_BASELINE: "draft_baseline",
  PENDING_GPT_CLARIFICATION: "pending_gpt_clarification",
  PENDING_CODEX_SCAN: "pending_codex_scan",
  PENDING_REVIEW: "pending_review",
  READY_FOR_WRITEBACK: "ready_for_writeback",
  READY_FOR_IMPLEMENTATION: "ready_for_implementation"
};

const USER_CONFIRMED_FIELDS = [
  "项目定义",
  "终版目标",
  "当前版本目标",
  "当前版本非范围",
  "目标体验",
  "游戏方向 / 风格方向",
  "后端是否预期存在"
];

const CODEX_SCANNED_FIELDS = [
  "模块地图",
  "技术栈",
  "当前切片",
  "最近两次变更摘要",
  "测试状态",
  "repo 中已有的技术线索",
  "consistency declared",
  "游戏玩法循环的 repo 线索"
];

async function loadWorkbench() {
  const payload = await readJsonIfExists(WORKBENCH_FILE);
  return normalizeWorkbench(payload);
}

async function saveWorkbench(workbench) {
  await ensureDir(path.dirname(WORKBENCH_FILE));
  await writeJsonAtomic(WORKBENCH_FILE, normalizeWorkbench(workbench));
}

function normalizeWorkbench(raw) {
  const newProjectDraft = normalizeNewProjectDraft(raw?.newProjectDraft || {});
  const recoverySessions = Array.isArray(raw?.recoverySessions)
    ? raw.recoverySessions.map(normalizeRecoverySession)
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    newProjectDraft,
    recoverySessions,
    ownershipGuide: {
      userConfirmed: USER_CONFIRMED_FIELDS,
      codexScanned: CODEX_SCANNED_FIELDS
    }
  };
}

function normalizeNewProjectDraft(raw) {
  const draft = {
    projectPath: text(raw.projectPath),
    projectName: text(raw.projectName),
    oneLineDefinition: text(raw.oneLineDefinition),
    finalGoal: text(raw.finalGoal),
    currentVersionTarget: text(raw.currentVersionTarget),
    currentVersionNonScope: text(raw.currentVersionNonScope),
    projectType: text(raw.projectType) || "unknown",
    targetUsers: text(raw.targetUsers),
    targetExperience: text(raw.targetExperience),
    techPreferences: text(raw.techPreferences),
    techConstraints: text(raw.techConstraints),
    useSuperpowers: normalizeBoolean(raw.useSuperpowers),
    gameCategory: text(raw.gameCategory),
    coreGameplay: text(raw.coreGameplay),
    visualDirection: text(raw.visualDirection),
    backendExpectation: text(raw.backendExpectation),
    networkingExpectation: text(raw.networkingExpectation),
    savedAt: raw.savedAt || null,
    lastGptPromptAt: raw.lastGptPromptAt || null,
    lastCodexPromptAt: raw.lastCodexPromptAt || null,
    lastPreviewAt: raw.lastPreviewAt || null,
    lastAppliedAt: raw.lastAppliedAt || null,
    attachedProjectId: raw.attachedProjectId || null
  };

  const gaps = collectNewProjectDraftGaps(draft);
  return {
    ...draft,
    gaps,
    workflowState: deriveNewProjectWorkflowState(draft, gaps)
  };
}

function normalizeRecoverySession(raw) {
  const session = {
    projectId: raw.projectId || null,
    projectName: text(raw.projectName),
    projectPath: text(raw.projectPath || raw.path),
    coarseJudgment: text(raw.coarseJudgment),
    keyQuestions: normalizeStringList(raw.keyQuestions || raw.keyQuestion),
    useSuperpowers: normalizeBoolean(raw.useSuperpowers),
    provisionalSummary: normalizeStringList(raw.provisionalSummary),
    unresolvedItems: normalizeStringList(raw.unresolvedItems),
    savedAt: raw.savedAt || null,
    lastGptPromptAt: raw.lastGptPromptAt || null,
    lastCodexPromptAt: raw.lastCodexPromptAt || null,
    lastSyncedAt: raw.lastSyncedAt || null,
    lastCodexScanAt: raw.lastCodexScanAt || null
  };

  return {
    ...session,
    workflowState: deriveRecoveryWorkflowState(session)
  };
}

function updateNewProjectDraft(workbench, input, markers = {}) {
  const nextDraft = normalizeNewProjectDraft({
    ...workbench.newProjectDraft,
    ...input,
    savedAt: new Date().toISOString(),
    ...markers
  });

  return {
    ...workbench,
    newProjectDraft: nextDraft
  };
}

function upsertRecoverySession(workbench, input, markers = {}) {
  const next = normalizeRecoverySession({
    ...input,
    savedAt: new Date().toISOString(),
    ...markers
  });
  const others = workbench.recoverySessions.filter((item) => item.projectId !== next.projectId);
  return {
    ...workbench,
    recoverySessions: [next, ...others]
  };
}

function findRecoverySession(workbench, projectId) {
  return workbench.recoverySessions.find((item) => item.projectId === projectId) || null;
}

function buildWorkbenchPayload(workbench, snapshotsByProjectId = {}) {
  const newProjectPrompts = buildNewProjectPromptBundle(workbench.newProjectDraft, {
    workflowState: workbench.newProjectDraft.workflowState
  });
  const recoveryByProjectId = Object.fromEntries(
    workbench.recoverySessions.map((session) => {
      const snapshot = snapshotsByProjectId[session.projectId] || null;
      return [session.projectId, buildRecoveryWorkbenchEntry(session, snapshot)];
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    workbench,
    prompts: {
      newProject: newProjectPrompts,
      recoveryByProjectId
    },
    ownershipGuide: workbench.ownershipGuide
  };
}

function buildRecoveryWorkbenchEntry(session, snapshot) {
  const provisionalSummary = summarizeRecoverySnapshot(snapshot, session);
  return {
    session,
    prompts: buildRecoveryPromptBundle(session, snapshot, provisionalSummary),
    provisionalSummary,
    workflowState: deriveRecoveryWorkflowState(session, snapshot)
  };
}

function deriveNewProjectWorkflowState(draft, gaps = collectNewProjectDraftGaps(draft)) {
  if (gaps.length) {
    return FLOW_STATES.DRAFT_BASELINE;
  }
  if (draft.lastPreviewAt && !draft.lastAppliedAt) {
    return FLOW_STATES.PENDING_REVIEW;
  }
  if (draft.lastAppliedAt) {
    return FLOW_STATES.PENDING_CODEX_SCAN;
  }
  if (draft.lastGptPromptAt && !draft.lastAppliedAt) {
    return FLOW_STATES.PENDING_GPT_CLARIFICATION;
  }
  return FLOW_STATES.READY_FOR_WRITEBACK;
}

function deriveRecoveryWorkflowState(session, snapshot = null) {
  if (!session.projectPath) {
    return FLOW_STATES.DRAFT_BASELINE;
  }
  const unresolved = summarizeRecoverySnapshot(snapshot, session).unresolved;
  if (!session.lastCodexScanAt) {
    return FLOW_STATES.PENDING_CODEX_SCAN;
  }
  if (unresolved.length) {
    return FLOW_STATES.PENDING_REVIEW;
  }
  return FLOW_STATES.READY_FOR_IMPLEMENTATION;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => text(item)).filter(Boolean));
  }
  return uniqueStrings(
    text(value)
      .split(/\r?\n|[;；]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = text(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function text(value) {
  return String(value ?? "").trim();
}

module.exports = {
  FLOW_STATES,
  applyNewProjectWritebackPreview,
  buildNewProjectPromptBundle,
  buildNewProjectWritebackPreview,
  buildRecoveryPromptBundle,
  buildWorkbenchPayload,
  findRecoverySession,
  loadWorkbench,
  normalizeNewProjectDraft,
  normalizeRecoverySession,
  saveWorkbench,
  summarizeRecoverySnapshot,
  updateNewProjectDraft,
  upsertRecoverySession
};
