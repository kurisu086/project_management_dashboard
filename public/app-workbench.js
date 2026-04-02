import {
  buildEmptyState,
  buildJsonPreview,
  escapeHtml,
  renderStatusPill,
  renderTag
} from "./app-utils.js";
import { SUPERPOWERS_OPTIONS, WORKFLOW_LABELS, WORKFLOW_VIEW_IDS } from "./app-workflow-config.js";

export function renderNewProjectFilingView(ctx) {
  const {
    draft,
    prompts,
    ownership,
    preview,
    result,
    usingActiveProjectContext
  } = deriveNewProjectFilingState(ctx.state);

  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>${WORKFLOW_LABELS[WORKFLOW_VIEW_IDS.newProject]}</h3>
        ${ctx.renderUsageCallout("这页怎么用", "先补最小建档字段，再确认是否启用 Superpowers 流程；确认后才做显式写入。", [
          "这里只写项目控制源文件，不修改业务代码。",
          "后续进入项目 repo 的 Codex 会话时，会根据这里的选择决定是否严格执行 Superpowers 流程。"
        ])}
        <form id="new-project-draft-form" class="stacked-form">
          ${renderDraftField("projectPath", "Windows 本机 git repo 绝对路径", draft.projectPath)}
          ${renderDraftField("projectName", "项目名称", draft.projectName)}
          ${renderDraftField("oneLineDefinition", "项目一句话定义", draft.oneLineDefinition)}
          ${renderDraftField("finalGoal", "终版目标", draft.finalGoal, true)}
          ${renderDraftField("currentVersionTarget", "当前版本目标", draft.currentVersionTarget, true)}
          ${renderDraftField("currentVersionNonScope", "当前版本不做什么", draft.currentVersionNonScope, true)}
          ${renderSelect("projectType", "项目类型", draft.projectType || "unknown", [
            ["unknown", "unknown"],
            ["game", "game"],
            ["tool", "tool"],
            ["website", "website"],
            ["client", "client"]
          ])}
          ${renderDraftField("targetUsers", "目标用户", draft.targetUsers)}
          ${renderDraftField("targetExperience", "目标体验", draft.targetExperience, true)}
          ${renderDraftField("techPreferences", "技术偏好", draft.techPreferences, true)}
          ${renderDraftField("techConstraints", "技术约束", draft.techConstraints, true)}
          ${renderSelect("useSuperpowers", "是否使用 Superpowers 严格流程", stringifyBoolean(draft.useSuperpowers), SUPERPOWERS_OPTIONS)}
          ${draft.projectType === "game" ? renderDraftField("gameCategory", "游戏分类", draft.gameCategory) : ""}
          ${draft.projectType === "game" ? renderDraftField("coreGameplay", "核心玩法一句话", draft.coreGameplay, true) : ""}
          ${draft.projectType === "game" ? renderDraftField("visualDirection", "画面方向", draft.visualDirection, true) : ""}
          ${renderSelect("backendExpectation", "是否预期有后端", draft.backendExpectation || "unknown", [
            ["unknown", "unknown"],
            ["yes", "yes"],
            ["no", "no"]
          ])}
          ${renderSelect("networkingExpectation", "联网 / 离线预期", draft.networkingExpectation || "unknown", [
            ["unknown", "unknown"],
            ["online_expected", "online_expected"],
            ["offline_supported", "offline_supported"],
            ["offline_only", "offline_only"]
          ])}
        </form>
        ${usingActiveProjectContext ? renderContextResetHint(draft.projectName || draft.projectPath) : ""}
        ${renderSuperpowersHint(Boolean(draft.useSuperpowers))}
        <div class="button-row compact-row">
          <button type="button" class="secondary-action" data-action="save-new-project-draft">保存草稿</button>
          <button type="button" class="secondary-action" data-action="copy-new-project-gpt">生成 GPT 填空方案</button>
          <button type="button" class="secondary-action" data-action="preview-new-project-writeback">预览显式写入</button>
          <button type="button" class="primary-action" data-action="apply-new-project-writeback">确认写入项目侧源文件</button>
        </div>
        ${ctx.state.newProjectStructuredStatus ? `<div class="inline-status ${ctx.state.newProjectStructuredStatus.toneClass}">${escapeHtml(ctx.state.newProjectStructuredStatus.message)}</div>` : ""}
        <div class="sub-block">
          <h4>结构化结果粘贴区</h4>
          <p class="inline-subcopy">把 GPT 返回的 JSON 直接粘到这里，再一键回填到左侧建档表单。</p>
          <textarea id="structured-draft-input" class="structured-draft-input">${escapeHtml(ctx.state.newProjectStructuredInput || "")}</textarea>
          <div class="button-row compact-row">
            <button type="button" class="ghost-button" data-action="fill-new-project-template">填入模板</button>
            <button type="button" class="secondary-action" data-action="apply-structured-draft">应用到建档表单</button>
          </div>
        </div>
      </section>
      <section class="content-card">
        <h3>补全建议与写入承接</h3>
        ${renderOwnershipGuide(ownership)}
        <section class="template-card">
          <strong>GPT 填空方案提示词</strong>
          <p class="inline-subcopy">用于基于已填字段补空字段，并返回可直接回填表单的 JSON。</p>
          <pre>${escapeHtml(prompts.gptDraftPrompt || "请先保存草稿后再生成。")}</pre>
        </section>
        <section class="template-card">
          <strong>Codex Skill-Based Blueprint Prompt</strong>
          <p class="inline-subcopy">这段提示词需要发到目标项目 repo 的 Codex 会话里执行，不在总控台内部执行。</p>
          <pre>${escapeHtml(prompts.codexStructurePrompt || "请先完成建档并保存草稿。")}</pre>
        </section>
        <section class="template-card">
          <strong>字段补全顺序</strong>
          <div class="draft-suggestion-list">
            ${(prompts.fieldSuggestions || []).map((item) => `
              <article class="draft-suggestion-item ${item.status === "missing" ? "is-missing" : "is-filled"}">
                <div class="draft-suggestion-head">
                  <strong>${escapeHtml(item.label)}</strong>
                  ${renderStatusPill(item.status, item.status === "missing" ? "待补" : "已填")}
                </div>
                <div class="draft-suggestion-current">${escapeHtml(item.currentValue || "待补")}</div>
                <small>${escapeHtml(item.guidance || "")}</small>
              </article>
            `).join("")}
          </div>
        </section>
        ${preview ? renderWritebackPreview(preview) : ""}
        ${result ? renderWritebackResult(result) : ""}
      </section>
    </div>
  `;
}

export function deriveNewProjectFilingState(state = {}) {
  const storedDraft = state.workbenchPayload?.workbench?.newProjectDraft || {};
  const storedPrompts = state.workbenchPayload?.prompts?.newProject || {};
  const ownership = state.workbenchPayload?.ownershipGuide || {};
  const preview = state.newProjectWritebackPreview?.preview || null;
  const result = state.newProjectWritebackResult?.scan || null;
  const activeProject = getActiveProjectContext(state);

  if (!activeProject || isDraftBoundToActiveProject(storedDraft, activeProject)) {
    return {
      draft: storedDraft,
      prompts: storedPrompts,
      ownership,
      preview,
      result,
      usingActiveProjectContext: false
    };
  }

  return {
    draft: buildContextualDraft(activeProject),
    prompts: {},
    ownership,
    preview: null,
    result: null,
    usingActiveProjectContext: true
  };
}

export function renderExistingProjectRecoveryView(ctx) {
  const activeProjectId = ctx.state.activeProjectId;
  const recoveryEntry = activeProjectId ? ctx.state.workbenchPayload?.prompts?.recoveryByProjectId?.[activeProjectId] : null;
  const session = recoveryEntry?.session || ctx.state.recoveryForm || {};

  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>${WORKFLOW_LABELS[WORKFLOW_VIEW_IDS.existingProject]}</h3>
        ${ctx.renderUsageCallout("这页怎么用", "用于已有 repo 的建档接入。总控台负责接入、保存你的粗判断，并生成给项目 repo Codex 的扫描补全提示词。", [
          "真正的 repo 扫描要去目标项目 repo 的 Codex 会话里执行。",
          "这里的重点是接入后让 Codex 补齐项目画像；后续待确认项再去 GPT 辅助整理。"
        ])}
        <form id="recovery-form" class="stacked-form">
          ${renderDraftField("path", "项目路径", session.projectPath || session.path || ctx.state.activeSnapshot?.project?.rootPath || "")}
          ${renderDraftField("name", "显示名称（可选）", session.projectName || session.name || ctx.state.activeSnapshot?.project?.name || "")}
          ${renderDraftField("coarseJudgment", "当前粗判断", session.coarseJudgment, true)}
          ${renderDraftField("keyQuestions", "当前最关心的问题（每行一个）", (session.keyQuestions || []).join("\n"), true)}
          ${renderSelect("useSuperpowers", "是否使用 Superpowers 严格流程", stringifyBoolean(session.useSuperpowers), SUPERPOWERS_OPTIONS)}
        </form>
        ${renderSuperpowersHint(Boolean(session.useSuperpowers))}
        <div class="button-row compact-row">
          <button type="button" class="secondary-action" data-action="attach-recovery-project">接入并生成建档提示词</button>
          <button type="button" class="primary-action" data-action="copy-recovery-codex">复制 Codex 扫描补全提示词</button>
        </div>
      </section>
      <section class="content-card">
        <h3>建档结果承接</h3>
        ${recoveryEntry
          ? `
              <section class="template-card">
                <strong>Codex Recovery Skill Prompt</strong>
                <pre>${escapeHtml(recoveryEntry.prompts?.codexScanPrompt || "暂无")}</pre>
              </section>
              <section class="template-card">
                <strong>provisional 摘要</strong>
                <ul>${(recoveryEntry.provisionalSummary?.summary || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </section>
              <section class="template-card">
                <strong>待确认问题</strong>
                <ul>${(recoveryEntry.provisionalSummary?.unresolved || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </section>
            `
          : buildEmptyState("先填写建档信息并点击“接入并生成建档提示词”。")}
      </section>
    </div>
  `;
}

export function renderGptAssistView(ctx) {
  const newProjectPrompt = ctx.state.workbenchPayload?.prompts?.newProject?.gptDraftPrompt;
  const pendingReviewPrompt = ctx.state.activeSnapshot?.detail?.pendingReview?.gptPrompt || "";

  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>${WORKFLOW_LABELS[WORKFLOW_VIEW_IDS.gptAssist]}</h3>
        ${ctx.renderUsageCallout("适合什么时候用", "当你知道大方向，但表述还不够清晰，或者总控台已经列出待确认项时，用 GPT 帮你把答案收敛成结构化结论。", [
          "GPT 负责整理模糊信息，不直接写项目控制文件。",
          "确认后的内容再回总控台，或者交给项目 repo 的 Codex 回写。"
        ])}
        <section class="template-card">
          <strong>新项目补空字段提示词</strong>
          <pre>${escapeHtml(newProjectPrompt || "请先在“新项目建档”里保存草稿。")}</pre>
        </section>
      </section>
      <section class="content-card">
        <h3>当前项目可复制提示词</h3>
        <section class="template-card">
          <strong>Pending Review GPT Prompt</strong>
          <pre>${escapeHtml(pendingReviewPrompt || "当前没有待确认项，或尚未选中项目。")}</pre>
        </section>
      </section>
    </div>
  `;
}

function renderDraftField(key, label, value, multiline = false) {
  if (multiline) {
    return `
      <label>
        <span>${escapeHtml(label)}</span>
        <textarea data-draft-field="${escapeHtml(key)}" rows="4">${escapeHtml(value || "")}</textarea>
      </label>
    `;
  }

  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input data-draft-field="${escapeHtml(key)}" value="${escapeHtml(value || "")}" />
    </label>
  `;
}

function renderSelect(key, label, currentValue, options) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <select data-draft-field="${escapeHtml(key)}">
        ${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${value === currentValue ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderSuperpowersHint(enabled) {
  return `
    <div class="template-card section-spacer">
      <strong>Superpowers 选项说明</strong>
      <p class="inline-subcopy">
        ${enabled
          ? "当前已开启。导入写入时，目标项目 AGENTS.md 会追加稳定规则，要求后续开发严格按 Superpowers 流程执行。"
          : "当前未开启。若后续开发必须严格按 Superpowers specs / plans 流程推进，请在这里改为“是”。"}
      </p>
    </div>
  `;
}

function renderContextResetHint(projectLabel) {
  return `
    <div class="template-card section-spacer">
      <strong>当前项目上下文已刷新</strong>
      <p class="inline-subcopy">已切到 ${escapeHtml(projectLabel || "当前项目")} 的建档上下文。上一项目的草稿、预览和写入结果不会继续沿用到这里。</p>
    </div>
  `;
}

function renderOwnershipGuide(ownership) {
  return `
    <section class="template-card">
      <strong>谁来填</strong>
      <p class="inline-subcopy">由用户 / GPT 整理后确认的字段</p>
      <div class="stack-list">${(ownership.userConfirmed || []).map((item) => renderTag(item, "source-declared")).join("")}</div>
      <p class="inline-subcopy">由 Codex 在项目 repo 中扫描补全的字段</p>
      <div class="stack-list">${(ownership.codexScanned || []).map((item) => renderTag(item, "source-neutral")).join("")}</div>
    </section>
  `;
}

function renderWritebackPreview(preview) {
  return `
    <section class="template-card">
      <strong>显式写入预览</strong>
      <div class="data-list compact-list">
        ${(preview.files || []).map((file) => `
          <div class="data-row">
            <div>
              <strong>${escapeHtml(file.fileName)}</strong>
              <small>${escapeHtml(file.status)} | ${escapeHtml((file.updatedFields || []).join("、") || "无字段变化")}</small>
            </div>
            <div class="pill-list">${(file.sourceKinds || []).map((kind) => renderTag(kind, "source-neutral")).join("")}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderWritebackResult(result) {
  return `
    <section class="template-card">
      <strong>最近一次写入结果</strong>
      ${buildJsonPreview(result)}
    </section>
  `;
}

function stringifyBoolean(value) {
  return value ? "true" : "false";
}

function getActiveProjectContext(state = {}) {
  const activeSnapshot = state.activeSnapshot;
  if (!activeSnapshot?.project) {
    return null;
  }

  return {
    projectId: activeSnapshot.project.id || null,
    projectPath: activeSnapshot.project.rootPath || "",
    projectName: activeSnapshot.project.name || "",
    useSuperpowers: activeSnapshot.project.onboardingMode === "superpowers" || Boolean(activeSnapshot.project.useSuperpowers),
    onboardingMode: activeSnapshot.project.onboardingMode || "standard"
  };
}

function isDraftBoundToActiveProject(draft = {}, activeProject) {
  if (!activeProject) {
    return true;
  }
  if (draft.attachedProjectId && activeProject.projectId) {
    return draft.attachedProjectId === activeProject.projectId;
  }
  if (draft.projectPath && activeProject.projectPath) {
    return normalizePath(draft.projectPath) === normalizePath(activeProject.projectPath);
  }
  return !draft.projectPath && !draft.projectName;
}

function buildContextualDraft(activeProject) {
  return {
    projectPath: activeProject.projectPath || "",
    projectName: activeProject.projectName || "",
    oneLineDefinition: "",
    finalGoal: "",
    currentVersionTarget: "",
    currentVersionNonScope: "",
    projectType: "unknown",
    targetUsers: "",
    targetExperience: "",
    techPreferences: "",
    techConstraints: "",
    useSuperpowers: activeProject.useSuperpowers,
    onboardingMode: activeProject.onboardingMode,
    gameCategory: "",
    coreGameplay: "",
    visualDirection: "",
    backendExpectation: "unknown",
    networkingExpectation: "unknown",
    attachedProjectId: activeProject.projectId || null
  };
}

function normalizePath(value) {
  return String(value || "").trim().replaceAll("/", "\\").toLowerCase();
}
