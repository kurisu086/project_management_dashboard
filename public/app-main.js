import {
  addProject,
  applyNewProjectWriteback,
  applyRebuildProfile,
  attachRecoveryProject,
  fetchProjectDetail,
  fetchProjectsPayload,
  fetchWorkbenchPayload,
  logClientEvent,
  previewNewProjectWriteback,
  previewRebuildProfile,
  refreshProject,
  removeProject,
  saveNewProjectDraft
} from "./app-api.js";
import { buildFallbackNavigation, isDiagramView, PENDING_REVIEW_STORAGE_KEY, resolveViewKey } from "./app-config.js";
import { closeDiagramOverlay, renderDiagramOverlay, updateViewport } from "./app-diagrams.js";
import {
  closePendingReviewOverlay as closePendingReviewOverlayState,
  loadDismissedPendingReview,
  maybeOpenPendingReviewOverlay as maybeOpenPendingReviewOverlayState,
  prefillAddFormFromQuery,
  renderPendingReviewOverlay as renderPendingReviewOverlayState
} from "./app-session.js";
import { WORKFLOW_VIEW_IDS } from "./app-workflow-config.js";
import {
  renderDetailHeader,
  renderImportGuideContent,
  renderOverviewStrip,
  renderPendingReviewOverlayContent,
  renderProjectList,
  renderViewNav
} from "./app-shell.js";
import { copyText, parseLooseJson, renderConflictPill, renderUsageCallout } from "./app-utils.js";
import { renderCurrentView } from "./app-views.js";

export function createApp() {
  const state = {
    runtime: null,
    projectsPayload: null,
    projects: [],
    diagnostics: [],
    activeProjectId: null,
    activeSnapshot: null,
    activeView: "new-project-filing",
    addForm: { path: "", name: "" },
    formStatus: { tone: "neutral", message: "" },
    workbenchPayload: null,
    newProjectStructuredInput: "",
    newProjectStructuredStatus: null,
    newProjectWritebackPreview: null,
    newProjectWritebackResult: null,
    recoveryResult: null,
    diagramOverlayView: null,
    selectedDiagramNodes: {},
    diagramViewportState: {},
    copyPayloads: {},
    copyPayloadCounter: 0,
    copyToast: { visible: false, message: "" },
    pendingReviewOpen: false,
    dismissedPendingReview: loadDismissedPendingReview(PENDING_REVIEW_STORAGE_KEY)
  };

  const refs = {
    overviewStrip: document.getElementById("overview-strip"),
    projectList: document.getElementById("project-list"),
    projectForm: document.getElementById("project-form"),
    projectPath: document.getElementById("project-path"),
    projectName: document.getElementById("project-name"),
    formStatus: document.getElementById("form-status"),
    refreshAll: document.getElementById("refresh-all"),
    detailHeader: document.getElementById("detail-header"),
    viewNav: document.getElementById("view-nav"),
    detailContent: document.getElementById("detail-content"),
    importGuideOverlay: document.getElementById("import-guide-overlay"),
    openImportGuide: document.getElementById("open-import-guide"),
    diagramOverlay: document.getElementById("diagram-overlay"),
    diagramOverlayTitle: document.getElementById("diagram-overlay-title"),
    diagramOverlayCopy: document.getElementById("diagram-overlay-copy"),
    diagramOverlayContent: document.getElementById("diagram-overlay-content"),
    pendingReviewOverlay: document.getElementById("pending-review-overlay"),
    pendingReviewContent: document.getElementById("pending-review-content"),
    copyToast: document.getElementById("copy-toast")
  };

  let copyToastTimer = null;

  const ctx = {
    state,
    refs,
    renderUsageCallout,
    assignCopyPayload,
    getActiveViewData,
    getViewById
  };

  async function boot() {
    hydrateStaticCopy();
    const guideContent = refs.importGuideOverlay.querySelector(".import-guide-content");
    if (guideContent) {
      guideContent.innerHTML = renderImportGuideContent();
    }
    bindStaticEvents();
    prefillAddFormFromQuery(state);
    await Promise.all([reloadWorkbench(), reloadProjects()]);
    if (state.projects.length) {
      await selectProject(state.activeProjectId || state.projects[0].id, { preserveView: true });
    } else {
      renderAll();
    }
    window.__appTestHooks__ = { state, maybeOpenPendingReviewOverlay, renderConflictPill };
    await logClientEvent("app_ready", "ok", { projects: state.projects.length });
  }

  function hydrateStaticCopy() {
    document.title = "多项目只读型 Codex 总控模块";
    const title = document.querySelector(".app-header h1");
    const copy = document.querySelector(".app-header .header-copy");
    if (title) {
      title.textContent = "多项目只读型 Codex 总控模块";
    }
    if (copy) {
      copy.textContent = "这里不只看当前切片，也集中呈现项目整体定义、模块地图、技术架构、游戏设计、当前阶段，以及下一条该如何给 Codex 下指令。";
    }
    if (refs.openImportGuide) {
      refs.openImportGuide.textContent = "导入说明";
    }
  }

  function bindStaticEvents() {
    refs.projectForm?.addEventListener("submit", onAddProjectSubmit);
    refs.refreshAll?.addEventListener("click", onRefreshCurrentProject);
    refs.projectPath?.addEventListener("input", (event) => {
      state.addForm.path = event.target.value;
    });
    refs.projectName?.addEventListener("input", (event) => {
      state.addForm.name = event.target.value;
    });
    refs.projectList?.addEventListener("click", onProjectListClick);
    refs.viewNav?.addEventListener("click", onNavClick);
    refs.detailHeader?.addEventListener("click", onDetailActionClick);
    refs.detailContent?.addEventListener("click", onDetailActionClick);
    refs.pendingReviewContent?.addEventListener("click", onDetailActionClick);
    refs.detailContent?.addEventListener("input", onDetailInput);
    refs.openImportGuide?.addEventListener("click", openImportGuide);
    document.querySelectorAll("[data-import-guide-close]").forEach((node) => {
      node.addEventListener("click", closeImportGuide);
    });
    document.querySelectorAll("[data-diagram-overlay-close]").forEach((node) => {
      node.addEventListener("click", () => closeDiagramOverlay(ctx));
    });
    document.querySelectorAll("[data-pending-review-close]").forEach((node) => {
      node.addEventListener("click", () => closePendingReviewOverlay());
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      closeImportGuide();
      closeDiagramOverlay(ctx);
      closePendingReviewOverlay();
    });
  }

  async function reloadProjects() {
    const payload = await fetchProjectsPayload();
    state.projectsPayload = payload;
    state.projects = payload.projects || [];
    state.diagnostics = payload.diagnostics || [];
    state.runtime = payload.runtime || state.runtime;
    if (!state.activeProjectId && state.projects[0]) {
      state.activeProjectId = state.projects[0].id;
    }
  }

  async function reloadWorkbench() {
    state.workbenchPayload = await fetchWorkbenchPayload();
  }

  async function selectProject(projectId, options = {}) {
    state.activeProjectId = projectId;
    state.activeSnapshot = await fetchProjectDetail(projectId);
    state.runtime = state.activeSnapshot.runtime || state.runtime;
    if (!options.preserveView || !isViewVisible(state.activeView)) {
      state.activeView = "overview";
    }
    renderAll();
    renderPendingReviewOverlay();
  }

  function isViewVisible(viewId) {
    const navigation = state.activeSnapshot?.detail?.navigation || buildFallbackNavigation();
    return navigation.some((group) => (group.items || []).some((item) => item.id === viewId));
  }

  function renderAll() {
    syncStaticFormValues();
    resetCopyPayloads();
    refs.overviewStrip.innerHTML = renderOverviewStrip(ctx);
    refs.projectList.innerHTML = renderProjectList(ctx);
    refs.detailHeader.innerHTML = renderDetailHeader(ctx);
    refs.viewNav.innerHTML = renderViewNav(ctx);
    refs.detailContent.innerHTML = renderCurrentView(ctx);
    renderPendingReviewOverlay();
    if (state.diagramOverlayView) {
      renderDiagramOverlay(ctx);
    }
  }

  function syncStaticFormValues() {
    if (refs.projectPath) refs.projectPath.value = state.addForm.path || "";
    if (refs.projectName) refs.projectName.value = state.addForm.name || "";
    if (!refs.formStatus) return;
    refs.formStatus.className = `form-status ${toneClass(state.formStatus.tone)}`;
    refs.formStatus.textContent = state.formStatus.message || "";
  }

  async function onAddProjectSubmit(event) {
    event.preventDefault();
    const payload = {
      path: refs.projectPath?.value.trim() || "",
      name: refs.projectName?.value.trim() || ""
    };
    state.addForm = payload;
    if (!payload.path) {
      setFormStatus("error", "项目路径不能为空。");
      return;
    }
    try {
      const result = await addProject(payload);
      setFormStatus("success", result.message || "项目添加成功。");
      await Promise.all([reloadProjects(), reloadWorkbench()]);
      if (result.project?.id) {
        await selectProject(result.project.id, { preserveView: false });
      } else {
        renderAll();
      }
    } catch (error) {
      setFormStatus("error", error.message || "添加项目失败。");
      await logClientEvent("add_project_failed", "error", {
        message: error.message || "unknown",
        diagnostic: error.payload?.diagnostic || null
      });
    }
  }

  async function onRefreshCurrentProject() {
    if (!state.activeProjectId) {
      setFormStatus("error", "请先接入一个项目。");
      return;
    }
    try {
      state.activeSnapshot = await refreshProject(state.activeProjectId);
      await reloadProjects();
      setFormStatus("success", state.activeSnapshot.message || "当前项目已刷新。");
      renderAll();
      renderPendingReviewOverlay();
    } catch (error) {
      setFormStatus("error", error.message || "刷新当前项目失败。");
    }
  }

  async function onProjectListClick(event) {
    const removeButton = event.target.closest('[data-action="remove-project"]');
    if (removeButton) {
      event.stopPropagation();
      await handleRemoveProject(removeButton.dataset.projectId);
      return;
    }
    const card = event.target.closest('[data-action="select-project"]');
    if (card) {
      await selectProject(card.dataset.projectId, { preserveView: true });
    }
  }

  async function onNavClick(event) {
    const button = event.target.closest('[data-action="change-view"]');
    if (!button) return;
    state.activeView = button.dataset.viewId;
    renderAll();
    if (isDiagramView(state.activeView) && state.activeSnapshot) {
      state.diagramOverlayView = state.activeView;
      renderDiagramOverlay(ctx);
    }
  }

  async function onDetailActionClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "refresh-project") return onRefreshCurrentProject();
    if (action === "preview-rebuild-profile") return handlePreviewRebuildProfile();
    if (action === "apply-rebuild-profile") return handleApplyRebuildProfile();
    if (action === "remove-project") return handleRemoveProject(button.dataset.projectId || state.activeProjectId);
    if (action === "open-pending-review") {
      state.pendingReviewOpen = true;
      return renderPendingReviewOverlay();
    }
    if (action === "jump-to-view") {
      closePendingReviewOverlay(false);
      state.activeView = button.dataset.viewId || "overview";
      renderAll();
      if (isDiagramView(state.activeView) && state.activeSnapshot) {
        state.diagramOverlayView = state.activeView;
        renderDiagramOverlay(ctx);
      }
      return;
    }
    if (action === "copy-payload") {
      return handleCopyText(state.copyPayloads[button.dataset.copyId] || "");
    }
    if (action === "open-diagram-overlay") {
      state.diagramOverlayView = button.dataset.viewId || state.activeView;
      return renderDiagramOverlay(ctx);
    }
    if (action === "copy-diagram-summary") return handleCopyDiagramSummary(button.dataset.viewId || state.activeView);
    if (action === "select-diagram-node") {
      state.selectedDiagramNodes[button.dataset.diagramId] = button.dataset.nodeId;
      return renderDiagramOverlay(ctx);
    }
    if (action === "diagram-zoom-in") return updateViewport(ctx, button.dataset.diagramId, "zoom-in");
    if (action === "diagram-zoom-out") return updateViewport(ctx, button.dataset.diagramId, "zoom-out");
    if (action === "diagram-reset" || action === "diagram-fit") return updateViewport(ctx, button.dataset.diagramId, "reset");
    if (action === "save-new-project-draft") return handleSaveNewProjectDraft(false);
    if (action === "copy-new-project-gpt") return handleCopyNewProjectPrompt("gpt");
    if (action === "copy-new-project-codex") return handleCopyNewProjectPrompt("codex");
    if (action === "fill-new-project-template") {
      state.newProjectStructuredInput = state.workbenchPayload?.prompts?.newProject?.structuredDraftTemplate || "";
      return renderAll();
    }
    if (action === "apply-structured-draft") return handleApplyStructuredDraft();
    if (action === "preview-new-project-writeback") return handlePreviewNewProjectWriteback();
    if (action === "apply-new-project-writeback") return handleApplyNewProjectWriteback();
    if (action === "attach-recovery-project") return handleAttachRecoveryProject();
    if (action === "copy-recovery-codex") return handleCopyRecoveryPrompt();
  }

  function onDetailInput(event) {
    if (event.target.closest("[data-draft-field]") && state.activeView === "new-project-filing") {
      state.newProjectWritebackPreview = null;
      state.newProjectWritebackResult = null;
      state.newProjectStructuredStatus = null;
      return;
    }
    if (event.target.id === "structured-draft-input") {
      state.newProjectStructuredInput = event.target.value;
    }
  }

  async function handlePreviewRebuildProfile() {
    if (!state.activeProjectId) return;
    const result = await previewRebuildProfile(state.activeProjectId);
    setFormStatus("success", `已生成重建预览：${(result.preview?.updatedFiles || []).join("、") || "无文件变化"}`);
    renderAll();
    alert(result.preview?.summary || JSON.stringify(result.preview, null, 2));
  }

  async function handleApplyRebuildProfile() {
    if (!state.activeProjectId) return;
    if (!window.confirm("确认执行“重建项目画像”吗？这属于用户显式维护写入，会更新项目控制源文件。")) return;
    state.activeSnapshot = await applyRebuildProfile(state.activeProjectId);
    await reloadProjects();
    renderAll();
    maybeOpenPendingReviewOverlay(state.activeSnapshot);
    renderPendingReviewOverlay();
  }

  async function handleRemoveProject(projectId) {
    if (!projectId) return;
    const project = state.projects.find((item) => item.id === projectId);
    const targetName = project?.name || projectId;
    if (!window.confirm(`确认移除项目“${targetName}”吗？这会清理 repo 中的控制文件、AGENTS 规则块、本地 skills 与总控缓存。`)) return;
    await removeProject(projectId);
    if (state.activeProjectId === projectId) {
      state.activeProjectId = null;
      state.activeSnapshot = null;
      state.activeView = "new-project-filing";
    }
    await Promise.all([reloadProjects(), reloadWorkbench()]);
    if (state.projects[0]) {
      await selectProject(state.projects[0].id, { preserveView: false });
    } else {
      renderAll();
    }
  }

  async function handleCopyDiagramSummary(viewId) {
    const view = getViewById(viewId);
    const diagrams = (view?.diagramIds || [])
      .map((diagramId) => state.activeSnapshot?.detail?.visualizations?.byId?.[diagramId])
      .filter(Boolean);
    const text = diagrams
      .map((diagram) =>
        [
          `# ${diagram.title}`,
          `status: ${diagram.status}`,
          `coverage: ${diagram.coverageLevel}`,
          `freshness: ${diagram.freshness}`,
          `sourceMix: ${diagram.sourceMix}`,
          `missing: ${(diagram.degradation?.missing_fields || []).join("、") || "none"}`,
          `omitted: ${[...(diagram.degradation?.omitted_nodes || []), ...(diagram.degradation?.omitted_edges || [])].join("、") || "none"}`
        ].join("\n")
      )
      .join("\n\n");
    await handleCopyText(text, "图摘要已复制");
  }

  async function handleSaveNewProjectDraft(markGptPrompt) {
    const draft = readNewProjectDraftFromDom();
    state.workbenchPayload = await saveNewProjectDraft(draft, markGptPrompt);
    state.newProjectStructuredStatus = { toneClass: "tone-success", message: state.workbenchPayload.message || "新项目草稿已保存。" };
    renderAll();
    return state.workbenchPayload;
  }

  async function handleCopyNewProjectPrompt(kind) {
    const result = await handleSaveNewProjectDraft(kind === "gpt");
    const prompts = result.prompts?.newProject || state.workbenchPayload?.prompts?.newProject || {};
    await handleCopyText(
      kind === "gpt" ? prompts.gptDraftPrompt : prompts.codexStructurePrompt || "",
      kind === "gpt" ? "GPT 提示词已复制" : "Codex 提示词已复制"
    );
  }

  function handleApplyStructuredDraft() {
    try {
      const parsed = parseLooseJson(document.getElementById("structured-draft-input")?.value || "");
      const draft = state.workbenchPayload?.workbench?.newProjectDraft || {};
      state.workbenchPayload.workbench.newProjectDraft = { ...draft, ...parsed };
      state.newProjectStructuredStatus = { toneClass: "tone-success", message: "已把结构化结果回填到建档表单。" };
    } catch (error) {
      state.newProjectStructuredStatus = { toneClass: "tone-error", message: error.message || "结构化结果解析失败。" };
    }
    renderAll();
  }

  async function handlePreviewNewProjectWriteback() {
    await handleSaveNewProjectDraft(false);
    state.newProjectWritebackPreview = await previewNewProjectWriteback(readNewProjectDraftFromDom());
    state.newProjectWritebackResult = null;
    renderAll();
  }

  async function handleApplyNewProjectWriteback() {
    await handleSaveNewProjectDraft(false);
    if (!window.confirm("确认把第一版项目控制源文件写入目标 repo 吗？这属于用户显式维护写入。")) return;
    state.newProjectWritebackResult = await applyNewProjectWriteback(readNewProjectDraftFromDom());
    state.newProjectWritebackPreview = null;
    await Promise.all([reloadProjects(), reloadWorkbench()]);
    if (state.newProjectWritebackResult.project?.id) {
      await selectProject(state.newProjectWritebackResult.project.id, { preserveView: false });
      maybeOpenPendingReviewOverlay(state.activeSnapshot);
      renderPendingReviewOverlay();
    } else {
      renderAll();
    }
  }

  async function handleAttachRecoveryProject() {
    state.recoveryResult = await attachRecoveryProject(readRecoveryFormFromDom());
    await Promise.all([reloadProjects(), reloadWorkbench()]);
    if (state.recoveryResult.project?.id) {
      await selectProject(state.recoveryResult.project.id, { preserveView: true });
      state.activeView = WORKFLOW_VIEW_IDS.existingProject;
      renderAll();
      maybeOpenPendingReviewOverlay(state.activeSnapshot);
      renderPendingReviewOverlay();
    }
  }

  async function handleCopyRecoveryPrompt() {
    if (!state.activeProjectId) {
      await handleAttachRecoveryProject();
    }
    const recoveryEntry = state.workbenchPayload?.prompts?.recoveryByProjectId?.[state.activeProjectId];
    const text = recoveryEntry?.prompts?.codexScanPrompt;
    await handleCopyText(text || "", "Codex 提示词已复制");
  }

  function readNewProjectDraftFromDom() {
    const form = refs.detailContent.querySelector("#new-project-draft-form");
    const draft = { ...(state.workbenchPayload?.workbench?.newProjectDraft || {}) };
    form?.querySelectorAll("[data-draft-field]").forEach((input) => {
      draft[input.dataset.draftField] = input.value;
    });
    return draft;
  }

  function readRecoveryFormFromDom() {
    const form = refs.detailContent.querySelector("#recovery-form");
    const payload = {};
    form?.querySelectorAll("[data-draft-field]").forEach((input) => {
      payload[input.dataset.draftField] = input.value;
    });
    return {
      path: payload.path || "",
      name: payload.name || "",
      coarseJudgment: payload.coarseJudgment || "",
      keyQuestions: String(payload.keyQuestions || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      useSuperpowers: payload.useSuperpowers === "true"
    };
  }

  function setFormStatus(tone, message) {
    state.formStatus = { tone, message };
    renderAll();
  }

  function getViewById(viewId) {
    if (!state.activeSnapshot) return null;
    const viewKey = resolveViewKey(viewId);
    return viewKey ? state.activeSnapshot.detail?.views?.[viewKey] || null : null;
  }

  function getActiveViewData() {
    return getViewById(state.diagramOverlayView || state.activeView);
  }

  function resetCopyPayloads() {
    state.copyPayloads = {};
    state.copyPayloadCounter = 0;
  }

  function assignCopyPayload(text) {
    const id = `copy-${++state.copyPayloadCounter}`;
    state.copyPayloads[id] = text;
    return id;
  }

  function openImportGuide() {
    refs.importGuideOverlay.hidden = false;
  }

  function closeImportGuide() {
    refs.importGuideOverlay.hidden = true;
  }

  function closePendingReviewOverlay(recordDismissal = true) {
    closePendingReviewOverlayState(state, refs, PENDING_REVIEW_STORAGE_KEY, recordDismissal);
  }

  function renderPendingReviewOverlay() {
    renderPendingReviewOverlayState(refs, renderPendingReviewOverlayContent(ctx), state.pendingReviewOpen);
  }

  function maybeOpenPendingReviewOverlay(snapshot) {
    maybeOpenPendingReviewOverlayState(state, snapshot);
  }

  async function handleCopyText(text, successMessage = "已复制") {
    try {
      await copyText(text);
      showCopyToast(successMessage);
    } catch (error) {
      showCopyToast(error?.message || "复制失败");
    }
  }

  function showCopyToast(message) {
    if (copyToastTimer) {
      clearTimeout(copyToastTimer);
    }
    state.copyToast = { visible: true, message };
    if (refs.copyToast) {
      refs.copyToast.textContent = message;
      refs.copyToast.hidden = false;
      refs.copyToast.classList.add("visible");
    }
    copyToastTimer = window.setTimeout(() => {
      state.copyToast = { visible: false, message: "" };
      if (refs.copyToast) {
        refs.copyToast.hidden = true;
        refs.copyToast.classList.remove("visible");
      }
    }, 900);
  }

  return { boot, state, refs };
}

function toneClass(tone) {
  if (tone === "error") return "tone-error";
  if (tone === "success") return "tone-success";
  return "tone-neutral";
}
