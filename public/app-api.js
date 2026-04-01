async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error || `Request failed: ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function fetchProjectsPayload() {
  return requestJson("/api/projects");
}

export function fetchWorkbenchPayload() {
  return requestJson("/api/workbench");
}

export function fetchProjectDetail(projectId) {
  return requestJson(`/api/projects/${projectId}`);
}

export function addProject(payload) {
  return requestJson("/api/projects", {
    method: "POST",
    body: payload
  });
}

export function refreshProject(projectId) {
  return requestJson(`/api/projects/${projectId}/refresh`, {
    method: "POST"
  });
}

export function removeProject(projectId) {
  return requestJson(`/api/projects/${projectId}`, {
    method: "DELETE"
  });
}

export function previewRebuildProfile(projectId) {
  return requestJson(`/api/projects/${projectId}/maintenance/rebuild-profile/preview`, {
    method: "POST"
  });
}

export function applyRebuildProfile(projectId) {
  return requestJson(`/api/projects/${projectId}/maintenance/rebuild-profile/apply`, {
    method: "POST"
  });
}

export function saveNewProjectDraft(payload, markGptPrompt = false) {
  return requestJson("/api/workbench/new-project/draft", {
    method: "POST",
    body: {
      ...payload,
      markGptPrompt
    }
  });
}

export function previewNewProjectWriteback(payload) {
  return requestJson("/api/workbench/new-project/writeback/preview", {
    method: "POST",
    body: payload
  });
}

export function applyNewProjectWriteback(payload) {
  return requestJson("/api/workbench/new-project/writeback/apply", {
    method: "POST",
    body: payload
  });
}

export function attachRecoveryProject(payload) {
  return requestJson("/api/workbench/recovery/attach", {
    method: "POST",
    body: payload
  });
}

export function logClientEvent(action, status, details = {}) {
  return requestJson("/api/client-log", {
    method: "POST",
    body: {
      action,
      status,
      details
    }
  }).catch(() => null);
}
