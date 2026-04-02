import { buildFallbackNavigation } from "./app-config.js";
import { getWorkflowLabel, WORKFLOW_VIEW_IDS } from "./app-workflow-config.js";
import {
  buildEmptyState,
  escapeHtml,
  renderConflictPill,
  renderRiskPill,
  renderTag
} from "./app-utils.js";

export function renderImportGuideContent() {
  return `
    <section class="guide-section">
      <h3>导入项目说明</h3>
      <p>先用左侧“添加项目”把 repo 接入总控台，再根据项目阶段选择“新项目建档”或“已有项目建档”。</p>
      <ul>
        <li>新项目建档：先明确项目定义、终版目标、当前版本目标和边界。</li>
        <li>已有项目建档：先接入 repo，再把建档提示词发到项目 repo 的 Codex 会话里做扫描补全。</li>
        <li>GPT 辅助整理：只用于收敛模糊信息，不直接写库。</li>
      </ul>
    </section>
    <section class="guide-section">
      <h3>三类动作边界</h3>
      <ul>
        <li>初始化接入写入：创建 <code>.codex-control/</code>、稳定规则块和 repo-local skills。</li>
        <li>用户显式维护写入：例如重建项目画像、确认写入建档源文件。</li>
        <li>日常自动聚合只读：watcher / polling / 刷新当前项目，只读 repo。</li>
      </ul>
    </section>
    <section class="guide-section">
      <h3>建档完成后怎么推进</h3>
      <ul>
        <li>不要只说一句“开始做”。</li>
        <li>先把右侧的 Codex 蓝图或恢复提示词发到目标项目 repo 的 Codex 会话。</li>
        <li>让它先用 repo-local skills 收紧蓝图、模块状态、验证矩阵和风险命名。</li>
        <li>回总控台刷新确认后，再进入当前工作包实现。</li>
      </ul>
    </section>
  `;
}

export function renderOverviewStrip(ctx) {
  const projects = ctx.state.projects || [];
  const metrics = [
    ["接入项目", projects.length],
    ["高风险项目", projects.filter((item) => ["high", "critical"].includes((item.summary?.riskLevel || "").toLowerCase())).length],
    ["游戏项目", projects.filter((item) => (item.summary?.projectType || "").toLowerCase() === "game").length],
    ["Superpowers 已检测", projects.filter((item) => (item.summary?.superpowersStatus || "") !== "not_used").length],
    ["来源不一致总数", projects.reduce((sum, item) => sum + Number(item.summary?.sourceConflictCount || 0), 0)]
  ];

  return metrics
    .map(
      ([label, value]) => `
        <article class="overview-metric">
          <p>${escapeHtml(label)}</p>
          <strong>${escapeHtml(String(value))}</strong>
        </article>
      `
    )
    .join("");
}

export function renderProjectList(ctx) {
  const projects = ctx.state.projects || [];
  if (!projects.length) {
    return buildEmptyState("当前没有已接入项目。");
  }

  return projects
    .map((project) => {
      const active = project.id === ctx.state.activeProjectId ? " active" : "";
      return `
        <button type="button" class="project-card${active}" data-action="select-project" data-project-id="${escapeHtml(project.id)}">
          <div class="project-card-header">
            <strong class="project-card-name">${escapeHtml(project.name)}</strong>
            <span class="card-remove-trigger" data-action="remove-project" data-project-id="${escapeHtml(project.id)}">移除</span>
          </div>
          <p class="project-card-path">${escapeHtml(project.rootPath)}</p>
          <p class="project-card-definition">${escapeHtml(project.summary?.oneLineDefinition || "暂无项目定义")}</p>
          <dl class="project-card-meta">
            <div><dt>类型</dt><dd>${escapeHtml(project.summary?.projectType || "unknown")}</dd></div>
            <div><dt>阶段</dt><dd>${escapeHtml(project.summary?.currentStage || "unknown")}</dd></div>
            <div><dt>模块数</dt><dd>${escapeHtml(String(project.summary?.moduleCount || 0))}</dd></div>
            <div><dt>来源不一致</dt><dd>${escapeHtml(String(project.summary?.sourceConflictCount || 0))}</dd></div>
          </dl>
        </button>
      `;
    })
    .join("");
}

export function renderDetailHeader(ctx) {
  const snapshot = ctx.state.activeSnapshot;
  if (!snapshot) {
    return `
      <div class="detail-header-main">
        <div>
          <p class="eyebrow">Project Center</p>
          <h2>先接入一个项目，再进入整体认知层与当前控制层</h2>
          <p class="detail-subcopy">即使还没有项目，也可以先查看接入与运行、运行环境、接入诊断和状态来源说明。</p>
        </div>
      </div>
    `;
  }

  const summary = snapshot.summary;
  return `
    <div class="detail-header-main">
      <div>
        <p class="eyebrow">Project Center</p>
        <h2>${escapeHtml(snapshot.project.name)}</h2>
        <p class="detail-subcopy">${escapeHtml(summary.oneLineDefinition || "暂无项目定义")}</p>
        <p class="detail-path">${escapeHtml(snapshot.project.rootPath)}</p>
      </div>
      <div class="detail-header-side">
        <div class="badge-list">
          ${renderTag(summary.projectType || "unknown", "source-declared")}
          ${renderTag(`Superpowers ${summary.superpowersStatus || "not_used"}`, "source-supplemental")}
          ${renderRiskPill(summary.riskLevel || "medium", `风险 ${summary.riskLevel || "unknown"}`)}
          ${renderConflictPill(summary.sourceConflictCount || 0)}
          ${summary.pendingReviewCount ? renderTag(`待确认 ${summary.pendingReviewCount}`, "source-pending") : ""}
        </div>
        <div class="header-actions">
          <button type="button" class="secondary-action" data-action="refresh-project">刷新聚合缓存</button>
          <button type="button" class="secondary-action" data-action="preview-rebuild-profile">预览重建项目画像</button>
          <button type="button" class="primary-action" data-action="apply-rebuild-profile">确认显式维护写入</button>
          ${summary.pendingReviewCount ? `<button type="button" class="secondary-action" data-action="open-pending-review">待确认 ${summary.pendingReviewCount}</button>` : ""}
          <button type="button" class="danger-action" data-action="remove-project" data-project-id="${escapeHtml(snapshot.project.id)}">移除项目</button>
        </div>
      </div>
    </div>
  `;
}

export function renderViewNav(ctx) {
  const navigation = ctx.state.activeSnapshot?.detail?.navigation || buildFallbackNavigation();
  const activeView = ctx.state.activeView;
  return navigation
    .map((group) => `
      <section class="view-group">
        <p class="view-group-label">${escapeHtml(group.label)}</p>
        <div class="view-group-tabs">
          ${group.items
            .map((item) => {
              const active = item.id === activeView ? " active" : "";
              const label = getWorkflowLabel(item.id, item.label);
              return `<button type="button" class="view-tab${active}" data-action="change-view" data-view-id="${escapeHtml(item.id)}">${escapeHtml(label)}</button>`;
            })
            .join("")}
        </div>
      </section>
    `)
    .join("");
}

export function renderPendingReviewOverlayContent(ctx) {
  const pending = ctx.state.activeSnapshot?.detail?.pendingReview;
  if (!pending || !pending.count) {
    return buildEmptyState("当前没有待确认项。");
  }

  const gptPromptId = ctx.assignCopyPayload(pending.gptPrompt || "");
  const codexPromptId = ctx.assignCopyPayload(pending.codexCleanupPrompt || "");

  return `
    <section class="guide-section pending-review-summary">
      <h3>当前待确认与待清理项</h3>
      <p>这里把问题拆成三类：需要你确认的方向问题、需要项目内 Codex 清理的控制文件质量问题，以及来源不一致的字段审查项。</p>
      <div class="pill-list">
        ${renderTag(`总数 ${pending.count}`, "source-pending")}
        ${renderTag(`你需确认 ${pending.userCount || 0}`, "source-pending")}
        ${renderTag(`Codex 清理 ${pending.cleanupCount || 0}`, "source-supplemental")}
        ${renderTag(`来源不一致 ${pending.conflictCount || 0}`, "risk-medium")}
      </div>
    </section>

    <section class="guide-section">
      <h3>需要你确认</h3>
      <p class="inline-subcopy">这部分适合发给 GPT 帮你收敛答案。它们会影响项目方向、版本边界或目标体验。</p>
      <div class="button-row compact-row">
        <button type="button" class="secondary-action" data-action="copy-payload" data-copy-id="${escapeHtml(gptPromptId)}">复制 GPT 确认提示词</button>
      </div>
      <div class="data-list">
        ${(pending.userItems || [])
          .map(
            (item) => `
              <div class="data-row pending-review-row">
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <small>${escapeHtml(item.detail || "")}</small>
                </div>
                <div class="pill-list">
                  ${renderTag(item.severity || "medium", "source-pending")}
                  <button type="button" class="secondary-action mini-action" data-action="jump-to-view" data-view-id="${escapeHtml(item.viewId || "overview")}">跳到相关页面</button>
                </div>
              </div>
            `
          )
          .join("") || `<div class="empty-inline">当前没有需要你确认的方向项。</div>`}
      </div>
      <pre>${escapeHtml(pending.gptPrompt || "暂无")}</pre>
    </section>

    <section class="guide-section">
      <h3>需要 Codex 清理的控制文件质量问题</h3>
      <p class="inline-subcopy">这部分不是让你拍板产品方向，而是让项目 repo 里的 Codex 去收紧验证项命名、风险命名和控制文件语义。</p>
      <div class="button-row compact-row">
        <button type="button" class="secondary-action" data-action="copy-payload" data-copy-id="${escapeHtml(codexPromptId)}">复制 Codex 控制文件回写提示词</button>
      </div>
      <div class="data-list">
        ${(pending.cleanupItems || [])
          .map(
            (item) => `
              <div class="data-row pending-review-row">
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <small>${escapeHtml(item.detail || "")}</small>
                </div>
                <div class="pill-list">
                  ${renderTag(item.severity || "medium", "source-supplemental")}
                  <button type="button" class="secondary-action mini-action" data-action="jump-to-view" data-view-id="${escapeHtml(item.viewId || "overview")}">跳到相关页面</button>
                </div>
              </div>
            `
          )
          .join("") || `<div class="empty-inline">当前没有需要 Codex 清理的控制文件质量问题。</div>`}
      </div>
      <pre>${escapeHtml(pending.codexCleanupPrompt || "暂无")}</pre>
    </section>

    <section class="guide-section">
      <h3>字段来源不一致是什么意思</h3>
      <p class="inline-subcopy">这不是修改文件数量。它表示不同来源对同一个字段说法不一致，比如“终版规划有后端”，但“当前 repo 还没看到后端实现”。</p>
      <p class="inline-subcopy">如果暂时不处理，总控台会更保守地解读图、版本驾驶舱和当前可动作状态，但不一定直接阻塞开发。</p>
      <div class="data-list">
        ${(pending.conflictItems || [])
          .map(
            (item) => `
              <div class="data-row pending-review-row">
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <small>${escapeHtml(item.detail || "")}</small>
                </div>
                <div class="pill-list">
                  ${renderTag(item.severity || "medium", "risk-medium")}
                  <button type="button" class="secondary-action mini-action" data-action="jump-to-view" data-view-id="${escapeHtml(item.viewId || "risk-blockers")}">跳到风险与阻塞</button>
                </div>
              </div>
            `
          )
          .join("") || `<div class="empty-inline">当前没有来源不一致项。</div>`}
      </div>
    </section>
  `;
}
