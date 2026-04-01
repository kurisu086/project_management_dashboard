const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  APP_ROOT,
  PUBLIC_DIR,
  SERVER_PORT
} = require("./lib/constants");
const {
  projectIdFromPath
} = require("./lib/fs-utils");
const {
  loadRegistry,
  removeRegistryProject,
  saveRegistry,
  sortRegistry,
  upsertRegistryProject
} = require("./lib/project-registry");
const {
  getRecentDiagnostics,
  loadDiagnosticHistory,
  recordDiagnosticEntry,
  saveDiagnosticHistory
} = require("./lib/diagnostic-history");
const {
  ensureProjectScaffold,
  readProjectSnapshot,
  previewRebuildProfileMaintenance,
  applyRebuildProfileMaintenance
} = require("./lib/project-reader");
const {
  diagnoseProjectPath
} = require("./lib/project-path-diagnostics");
const {
  getRuntimeInfo
} = require("./lib/runtime-env");
const {
  WatchManager
} = require("./lib/watch-manager");
const {
  OPERATION_LOG_FILE,
  recordOperationLog
} = require("./lib/operation-log");
const {
  loadWorkbench,
  saveWorkbench
} = require("./lib/intake-workbench");
const {
  buildWorkbenchResponse,
  handleWorkbenchApiRequest,
  removeProjectFromWorkbench
} = require("./lib/server-workbench");
const {
  CACHE_DIR
} = require("./lib/constants");
const { determineOnboardingMode } = require("./lib/superpowers-onboarding");
const {
  cleanupProjectControlFiles
} = require("./lib/project-removal");

const registryState = {
  registry: null,
  snapshots: new Map(),
  diagnosticHistory: null,
  workbench: null
};

let serverInstance = null;
let watchManager = new WatchManager(refreshProjectById);

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function startServer(port = SERVER_PORT) {
  if (serverInstance) {
    return serverInstance;
  }

  registryState.registry = await loadRegistry();
  registryState.diagnosticHistory = await loadDiagnosticHistory();
  registryState.workbench = await loadWorkbench();
  const runtime = getRuntimeInfo();
  watchManager = new WatchManager(refreshProjectById);

  if (runtime.isWindowsNative) {
    for (const projectRecord of registryState.registry.projects) {
      await ensureProjectScaffold(projectRecord);
      await refreshProject(projectRecord, { persist: true });
      await watchManager.attach(projectRecord);
    }
  } else {
    console.error("[runtime] 当前不是 Windows 本机模式，已跳过已注册项目的自动初始化与监听。");
  }

  if (!runtime.isWindowsNative) {
    console.error("[runtime] Windows 本机模式未启用，添加 Windows 本地项目路径将被拒绝。");
  }

  serverInstance = http.createServer(requestListener);
  await new Promise((resolve) => {
    serverInstance.listen(port, resolve);
  });

  console.log(`Codex control dashboard running at http://localhost:${port}`);
  console.log(`Workspace: ${APP_ROOT}`);
  console.log(`Runtime: ${runtime.platform} / ${runtime.nodeRuntimeDescription}`);

  return serverInstance;
}

async function stopServer() {
  if (!serverInstance) {
    return;
  }

  for (const projectRecord of registryState.registry?.projects || []) {
    watchManager.detach(projectRecord.id);
  }

  await new Promise((resolve, reject) => {
    serverInstance.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  serverInstance = null;
  registryState.snapshots.clear();
}

async function requestListener(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, url);
      return;
    }

    await handleStaticRequest(response, url.pathname);
  } catch (error) {
    await recordOperationLog({
      channel: "server",
      action: "request_error",
      status: "error",
      details: {
        message: error.message || "Unexpected error",
        statusCode: error.statusCode || 500,
        path: request.url || null
      }
    }).catch(() => {});
    sendJson(response, error.statusCode || 500, {
      error: error.message || "Unexpected error",
      runtime: getRuntimeInfo(),
      ...(error.payload || {})
    });
  }
}

async function handleApiRequest(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/runtime") {
    sendJson(response, 200, {
      runtime: getRuntimeInfo(),
      operationLogFile: OPERATION_LOG_FILE
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/client-log") {
    const payload = await readJsonBody(request);
    await recordOperationLog({
      channel: "client",
      action: payload.action || "unknown",
      status: payload.status || "info",
      details: payload.details || {},
      runtime: getRuntimeInfo()
    });
    sendJson(response, 200, {
      ok: true,
      operationLogFile: OPERATION_LOG_FILE
    });
    return;
  }

  if (await handleWorkbenchApiRequest(request, response, url, {
    registryState,
    sendJson,
    readJsonBody,
    getRuntimeInfo,
    recordOperationLog,
    refreshProject,
    addProject
  })) {
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/projects") {
    sendJson(response, 200, buildProjectsPayload());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/projects") {
    const payload = await readJsonBody(request);
    const result = await addProject(payload);
    if (!result.ok) {
      sendJson(response, result.statusCode, result);
      return;
    }
    sendJson(response, 201, result);
    return;
  }

  const detailMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]+)$/);
  if (request.method === "GET" && detailMatch) {
    const snapshot = registryState.snapshots.get(detailMatch[1]);
    if (!snapshot) {
      sendJson(response, 404, {
        error: "Project not found",
        runtime: getRuntimeInfo()
      });
      return;
    }
    sendJson(response, 200, {
      ...snapshot,
      diagnostics: getRecentDiagnostics(registryState.diagnosticHistory, 5, snapshot.project),
      runtime: getRuntimeInfo()
    });
    return;
  }

  if (request.method === "DELETE" && detailMatch) {
    const result = await removeProjectById(detailMatch[1]);
    if (!result.ok) {
      sendJson(response, result.statusCode, result);
      return;
    }
    sendJson(response, 200, result);
    return;
  }

  const refreshMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]+)\/refresh$/);
  if (request.method === "POST" && refreshMatch) {
    const snapshot = await refreshProjectById(refreshMatch[1]);
    if (!snapshot) {
      sendJson(response, 404, {
        error: "Project not found",
        runtime: getRuntimeInfo()
      });
      return;
    }
    await recordOperationLog({
      channel: "server",
      action: "project_refresh",
      status: "ok",
      details: {
        projectId: refreshMatch[1]
      }
    });
    sendJson(response, 200, {
      ok: true,
      actionBoundary: "steady_state_readonly",
      message: "项目已刷新。",
      runtime: getRuntimeInfo(),
      ...snapshot
    });
    return;
  }

  const rebuildPreviewMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]+)\/maintenance\/rebuild-profile\/preview$/);
  if (request.method === "POST" && rebuildPreviewMatch) {
    const projectRecord = registryState.registry.projects.find((item) => item.id === rebuildPreviewMatch[1]);
    if (!projectRecord) {
      sendJson(response, 404, {
        error: "Project not found",
        runtime: getRuntimeInfo()
      });
      return;
    }

    const preview = await previewRebuildProfileMaintenance(projectRecord);
    const { _internalPlan, ...clientPreview } = preview;
    await recordOperationLog({
      channel: "server",
      action: "rebuild_profile_preview",
      status: "ok",
      details: {
        projectId: projectRecord.id,
        rootPath: projectRecord.rootPath,
        updatedFiles: clientPreview.updatedFiles || []
      }
    });
    sendJson(response, 200, {
      ok: true,
      actionBoundary: "explicit_maintenance_write",
      maintenanceAction: "rebuild_profile_preview",
      message: "Preview generated. Confirm before writing source-state files.",
      runtime: getRuntimeInfo(),
      preview: clientPreview
    });
    return;
  }

  const rebuildApplyMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]+)\/maintenance\/rebuild-profile\/apply$/);
  if (request.method === "POST" && rebuildApplyMatch) {
    const projectRecord = registryState.registry.projects.find((item) => item.id === rebuildApplyMatch[1]);
    if (!projectRecord) {
      sendJson(response, 404, {
        error: "Project not found",
        runtime: getRuntimeInfo()
      });
      return;
    }

    const result = await applyRebuildProfileMaintenance(projectRecord, { persist: true });
    registryState.snapshots.set(projectRecord.id, result.snapshot);
    await recordOperationLog({
      channel: "server",
      action: "rebuild_profile_apply",
      status: "ok",
      details: {
        projectId: projectRecord.id,
        rootPath: projectRecord.rootPath,
        updatedFiles: result.scan?.updatedFiles || []
      }
    });
    sendJson(response, 200, {
      ok: true,
      actionBoundary: "explicit_maintenance_write",
      maintenanceAction: "rebuild_profile_apply",
      message: "Project profile rebuilt from repo-visible source evidence.",
      runtime: getRuntimeInfo(),
      scan: result.scan,
      ...result.snapshot
    });
    return;
  }

  sendJson(response, 404, {
    error: "Not found",
    runtime: getRuntimeInfo()
  });
}

function buildProjectsPayload() {
  const projects = registryState.registry.projects.map((project) => {
    const snapshot = registryState.snapshots.get(project.id);
    return snapshot
      ? {
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
          addedAt: project.addedAt,
          summary: snapshot.summary,
          detail: {
            conflicts: snapshot.detail.conflicts,
            repoFacts: snapshot.detail.repoFacts
          }
        }
      : {
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
          addedAt: project.addedAt
        };
  });

  return {
    generatedAt: new Date().toISOString(),
    runtime: getRuntimeInfo(),
    operationLogFile: OPERATION_LOG_FILE,
    diagnostics: getRecentDiagnostics(registryState.diagnosticHistory, 8),
    projects
  };
}

async function addProject(payload) {
  const diagnostic = await diagnoseProjectPath(payload && payload.path);
  const runtime = getRuntimeInfo();

  if (!diagnostic.success) {
    recordDiagnosticEntry(registryState.diagnosticHistory, {
      status: "failed",
      rawInput: diagnostic.rawInput,
      normalizedPath: diagnostic.normalizedPath,
      projectId: null,
      projectName: null,
      failureReason: diagnostic.failureReason,
      runtimePlatform: runtime.platform,
      diagnostic
    });
    await saveDiagnosticHistory(registryState.diagnosticHistory);
    await recordOperationLog({
      channel: "server",
      action: "add_project",
      status: "failed",
      details: {
        path: payload?.path || null,
        reason: diagnostic.failureReason || null
      }
    });
    return {
      ok: false,
      statusCode: 400,
      error: diagnostic.failureReason,
      message: diagnostic.failureReason,
      diagnostic,
      runtime
    };
  }

  const rootPath = diagnostic.normalizedPath;
  const existingRecord = registryState.registry.projects.find((item) => item.rootPath.toLowerCase() === rootPath.toLowerCase());
  const name = payload.name && String(payload.name).trim()
    ? String(payload.name).trim()
    : (existingRecord ? existingRecord.name : path.win32.basename(rootPath));

  const projectRecord = {
    id: projectIdFromPath(rootPath),
    name,
    rootPath,
    addedAt: existingRecord ? existingRecord.addedAt : new Date().toISOString(),
    useSuperpowers: Boolean(payload?.useSuperpowers || existingRecord?.useSuperpowers),
    onboardingMode: determineOnboardingMode({
      useSuperpowers: Boolean(payload?.useSuperpowers || existingRecord?.useSuperpowers)
    })
  };

  await ensureProjectScaffold(projectRecord);
  await refreshProject(projectRecord, { persist: true });
  await watchManager.attach(projectRecord);

  upsertRegistryProject(registryState.registry, projectRecord);
  sortRegistry(registryState.registry);
  await saveRegistry(registryState.registry);
  recordDiagnosticEntry(registryState.diagnosticHistory, {
    status: "success",
    rawInput: diagnostic.rawInput,
    normalizedPath: diagnostic.normalizedPath,
    projectId: projectRecord.id,
    projectName: projectRecord.name,
    failureReason: null,
    runtimePlatform: runtime.platform,
    diagnostic
  });
  await saveDiagnosticHistory(registryState.diagnosticHistory);
  await recordOperationLog({
    channel: "server",
    action: "add_project",
    status: "ok",
    details: {
      path: rootPath,
      projectId: projectRecord.id,
      name: projectRecord.name
    }
  });

  return {
    ok: true,
    actionBoundary: "initialization_write",
    message: "项目添加成功。",
    diagnostic,
    runtime,
    ...(registryState.snapshots.get(projectRecord.id)),
    project: {
      ...(registryState.snapshots.get(projectRecord.id)?.project || projectRecord),
      onboardingMode: projectRecord.onboardingMode
    }
  };
}

async function removeProjectById(projectId) {
  const projectRecord = registryState.registry.projects.find((item) => item.id === projectId);
  if (!projectRecord) {
    return {
      ok: false,
      statusCode: 404,
      error: "Project not found",
      runtime: getRuntimeInfo()
    };
  }

  watchManager.detach(projectId);
  const cleanup = await cleanupProjectControlFiles(projectRecord, {
    cacheDir: path.join(CACHE_DIR, projectRecord.id)
  });

  registryState.snapshots.delete(projectId);
  removeRegistryProject(registryState.registry, projectId);
  sortRegistry(registryState.registry);
  await saveRegistry(registryState.registry);

  registryState.workbench = removeProjectFromWorkbench(registryState.workbench, projectId);
  await saveWorkbench(registryState.workbench);

  await recordOperationLog({
    channel: "server",
    action: "remove_project",
    status: "ok",
    details: {
      projectId,
      rootPath: projectRecord.rootPath,
      removedRepoArtifacts: cleanup.removedRepoArtifacts,
      removedLocalArtifacts: cleanup.removedLocalArtifacts
    }
  });

  return {
    ok: true,
    actionBoundary: "explicit_maintenance_write",
    message: "Project removed. Repo control files, AGENTS rules block, local cache, and registry entry were cleaned up.",
    runtime: getRuntimeInfo(),
    removed: {
      project: {
        id: projectRecord.id,
        name: projectRecord.name,
        rootPath: projectRecord.rootPath
      },
      ...cleanup
    },
    projectsPayload: buildProjectsPayload(),
    workbench: buildWorkbenchResponse(registryState)
  };
}
async function refreshProjectById(projectId) {
  const projectRecord = registryState.registry.projects.find((item) => item.id === projectId);
  if (!projectRecord) {
    return null;
  }

  return refreshProject(projectRecord, { persist: true });
}

async function refreshProject(projectRecord, options) {
  const snapshot = await readProjectSnapshot(projectRecord, options);
  registryState.snapshots.set(projectRecord.id, snapshot);
  return snapshot;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleStaticRequest(response, pathname) {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-store"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    throw error;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".js" || ext === ".mjs") {
    return "application/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

module.exports = {
  startServer,
  stopServer
};
