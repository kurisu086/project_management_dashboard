const path = require("node:path");
const {
  CONTROL_DIR_NAME,
  GAME_DESIGN_FILE_NAME,
  OPERATION_LOG_FILE,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME
} = require("./constants");
const {
  applyNewProjectWritebackPreview,
  buildNewProjectPromptBundle,
  buildNewProjectWritebackPreview,
  buildRecoveryPromptBundle,
  buildWorkbenchPayload,
  findRecoverySession,
  normalizeNewProjectDraft,
  saveWorkbench,
  summarizeRecoverySnapshot,
  updateNewProjectDraft,
  upsertRecoverySession
} = require("./intake-workbench");
const {
  diagnoseProjectPath
} = require("./project-path-diagnostics");
const {
  projectIdFromPath,
  readJsonIfExists,
  writeJsonAtomic
} = require("./fs-utils");

async function handleWorkbenchApiRequest(request, response, url, context) {
  const {
    registryState,
    sendJson,
    readJsonBody,
    getRuntimeInfo,
    recordOperationLog,
    refreshProject,
    addProject
  } = context;

  if (request.method === "GET" && url.pathname === "/api/workbench") {
    sendJson(response, 200, buildWorkbenchResponse(registryState));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/workbench/new-project/draft") {
    const payload = await readJsonBody(request);
    registryState.workbench = updateNewProjectDraft(
      registryState.workbench,
      normalizeNewProjectDraft(payload || {}),
      payload?.markGptPrompt ? { lastGptPromptAt: new Date().toISOString() } : {}
    );
    await saveWorkbench(registryState.workbench);
    await recordOperationLog({
      channel: "server",
      action: "new_project_draft_saved",
      status: "ok",
      details: {
        projectPath: payload?.projectPath || null,
        projectName: payload?.projectName || null,
        useSuperpowers: Boolean(payload?.useSuperpowers)
      }
    });
    sendJson(response, 200, {
      ok: true,
      actionBoundary: "dashboard_local_only",
      message: "New project draft saved locally.",
      runtime: getRuntimeInfo(),
      ...buildWorkbenchResponse(registryState)
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/workbench/new-project/writeback/preview") {
    const payload = normalizeNewProjectDraft(await readJsonBody(request));
    const preview = await previewNewProjectDraftWriteback(payload);
    registryState.workbench = updateNewProjectDraft(registryState.workbench, payload, {
      lastPreviewAt: preview.generatedAt
    });
    await saveWorkbench(registryState.workbench);
    await recordOperationLog({
      channel: "server",
      action: "new_project_writeback_preview",
      status: "ok",
      details: {
        projectPath: payload.projectPath || null,
        projectName: payload.projectName || null,
        updatedFiles: preview.updatedFiles,
        useSuperpowers: payload.useSuperpowers
      }
    });
    sendJson(response, 200, {
      ok: true,
      actionBoundary: "explicit_maintenance_write",
      message: "New project filing preview generated. Confirm before writing source-state files.",
      runtime: getRuntimeInfo(),
      preview,
      prompts: {
        newProject: buildNewProjectPromptBundle(payload, {
          workflowState: payload.workflowState
        })
      },
      ...buildWorkbenchResponse(registryState)
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/workbench/new-project/writeback/apply") {
    const payload = normalizeNewProjectDraft(await readJsonBody(request));
    const result = await applyNewProjectDraftWriteback(payload, {
      registryState,
      addProject,
      refreshProject
    });
    await recordOperationLog({
      channel: "server",
      action: "new_project_writeback_apply",
      status: "ok",
      details: {
        projectPath: payload.projectPath || null,
        projectName: payload.projectName || null,
        projectId: result.project?.id || null,
        updatedFiles: result.scan?.updatedFiles || [],
        useSuperpowers: payload.useSuperpowers
      }
    });
    sendJson(response, 200, {
      ok: true,
      actionBoundary: "explicit_maintenance_write",
      message: "New project filing written to source-state files after explicit confirmation.",
      runtime: getRuntimeInfo(),
      ...result,
      ...buildWorkbenchResponse(registryState)
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/workbench/recovery/attach") {
    const payload = await readJsonBody(request);
    const result = await attachRecoveryProject(payload || {}, {
      registryState,
      addProject,
      refreshProject
    });
    await recordOperationLog({
      channel: "server",
      action: "existing_project_recovery_attach",
      status: "ok",
      details: {
        path: payload?.path || null,
        name: payload?.name || null,
        projectId: result.project?.id || null,
        actionBoundary: result.actionBoundary,
        useSuperpowers: Boolean(payload?.useSuperpowers)
      }
    });
    sendJson(response, 200, {
      ok: true,
      actionBoundary: result.actionBoundary,
      message: "Existing project filing attached. Use the generated Codex prompt inside the project repo session.",
      runtime: getRuntimeInfo(),
      ...result,
      ...buildWorkbenchResponse(registryState)
    });
    return true;
  }

  return false;
}

function buildWorkbenchResponse(registryState) {
  const snapshotsByProjectId = Object.fromEntries(
    [...registryState.snapshots.entries()].map(([projectId, snapshot]) => [projectId, snapshot])
  );
  return {
    ...buildWorkbenchPayload(registryState.workbench, snapshotsByProjectId),
    operationLogFile: OPERATION_LOG_FILE
  };
}

async function previewNewProjectDraftWriteback(draft) {
  const diagnostic = await diagnoseProjectPath(draft.projectPath);
  if (!diagnostic.success) {
    const error = new Error(diagnostic.failureReason || "Project path is invalid.");
    error.statusCode = 400;
    error.payload = { diagnostic };
    throw error;
  }

  const projectRecord = buildProjectRecordFromPayload(diagnostic.normalizedPath, draft.projectName, draft.useSuperpowers);
  const existingFiles = await loadExistingNewProjectSourceFiles(projectRecord);
  return buildNewProjectWritebackPreview(projectRecord, draft, existingFiles);
}

async function applyNewProjectDraftWriteback(draft, context) {
  const preview = await previewNewProjectDraftWriteback(draft);
  const projectRecord = await ensureProjectAttachedFromPath(draft.projectPath, draft.projectName, draft.useSuperpowers, context);
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const applyResult = applyNewProjectWritebackPreview(preview);

  for (const file of preview.files) {
    const payload = preview._internalPlan[file.fileName];
    await writeJsonAtomic(path.join(controlDir, file.fileName), payload);
  }

  context.registryState.workbench = updateNewProjectDraft(context.registryState.workbench, draft, {
    attachedProjectId: projectRecord.id,
    lastAppliedAt: applyResult.generatedAt
  });
  await saveWorkbench(context.registryState.workbench);
  const workflowState = context.registryState.workbench?.newProjectDraft?.workflowState || null;

  const snapshot = await context.refreshProject(projectRecord, { persist: true });
  return {
    project: snapshot.project,
    scan: {
      ...applyResult,
      workflowState
    },
    snapshot
  };
}

async function attachRecoveryProject(payload, context) {
  const alreadyAttached = context.registryState.registry.projects.some(
    (item) => item.rootPath.toLowerCase() === String(payload.path || "").trim().toLowerCase()
  );
  const projectRecord = await ensureProjectAttachedFromPath(payload.path, payload.name, payload.useSuperpowers, context);
  const snapshot = context.registryState.snapshots.get(projectRecord.id) || await context.refreshProject(projectRecord, { persist: true });
  const provisionalSummary = summarizeRecoverySnapshot(snapshot, null);
  const recoverySession = {
    projectId: projectRecord.id,
    projectName: projectRecord.name,
    projectPath: projectRecord.rootPath,
    coarseJudgment: payload.coarseJudgment,
    keyQuestions: payload.keyQuestions || payload.keyQuestion,
    useSuperpowers: payload.useSuperpowers,
    provisionalSummary: provisionalSummary.summary,
    unresolvedItems: provisionalSummary.unresolved,
    lastCodexPromptAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString()
  };

  context.registryState.workbench = upsertRecoverySession(context.registryState.workbench, recoverySession);
  await saveWorkbench(context.registryState.workbench);
  const session = findRecoverySession(context.registryState.workbench, projectRecord.id);

  return {
    actionBoundary: alreadyAttached ? "dashboard_local_only" : "initialization_write",
    project: snapshot.project,
    recovery: {
      session,
      prompts: buildRecoveryPromptBundle(session, snapshot, summarizeRecoverySnapshot(snapshot, session)),
      provisionalSummary: summarizeRecoverySnapshot(snapshot, session)
    },
    ...snapshot
  };
}

async function ensureProjectAttachedFromPath(projectPath, name, useSuperpowers, context) {
  const diagnostic = await diagnoseProjectPath(projectPath);
  if (!diagnostic.success) {
    const error = new Error(diagnostic.failureReason || "Project path is invalid.");
    error.statusCode = 400;
    error.payload = { diagnostic };
    throw error;
  }

  const rootPath = diagnostic.normalizedPath;
  const result = await context.addProject({
    path: rootPath,
    name,
    useSuperpowers
  });

  if (!result.ok) {
    const error = new Error(result.message || "Unable to attach project.");
    error.statusCode = result.statusCode || 400;
    error.payload = result;
    throw error;
  }

  return context.registryState.registry.projects.find((item) => item.id === projectIdFromPath(rootPath));
}

function buildProjectRecordFromPayload(rootPath, name, useSuperpowers) {
  return {
    id: projectIdFromPath(rootPath),
    name: name && String(name).trim() ? String(name).trim() : path.win32.basename(rootPath),
    rootPath,
    addedAt: new Date().toISOString(),
    useSuperpowers: Boolean(useSuperpowers)
  };
}

async function loadExistingNewProjectSourceFiles(projectRecord) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  return {
    [PROJECT_BRIEF_FILE_NAME]: await readJsonIfExists(path.join(controlDir, PROJECT_BRIEF_FILE_NAME)),
    [TECH_STACK_FILE_NAME]: await readJsonIfExists(path.join(controlDir, TECH_STACK_FILE_NAME)),
    [VERSION_STATE_FILE_NAME]: await readJsonIfExists(path.join(controlDir, VERSION_STATE_FILE_NAME)),
    [PROJECT_STATE_FILE_NAME]: await readJsonIfExists(path.join(controlDir, PROJECT_STATE_FILE_NAME)),
    [GAME_DESIGN_FILE_NAME]: await readJsonIfExists(path.join(controlDir, GAME_DESIGN_FILE_NAME))
  };
}

function removeProjectFromWorkbench(workbench, projectId) {
  if (!workbench) {
    return workbench;
  }

  const next = {
    ...workbench,
    recoverySessions: (workbench.recoverySessions || []).filter((item) => item.projectId !== projectId),
    newProjectDraft: { ...(workbench.newProjectDraft || {}) }
  };

  if (next.newProjectDraft.attachedProjectId === projectId) {
    next.newProjectDraft.attachedProjectId = null;
    next.newProjectDraft.lastAppliedAt = null;
  }

  return next;
}

module.exports = {
  buildWorkbenchResponse,
  handleWorkbenchApiRequest,
  removeProjectFromWorkbench
};
