import {
  buildEmptyState,
  escapeHtml,
  formatDateTime,
  renderStatusPill,
  renderTag
} from "./app-utils.js";

export function renderSuperpowersWorkflowSummary(summary) {
  if (!summary?.superpowersWorkflowState || summary.superpowersWorkflowState === "not_used") {
    return "";
  }

  return `
    <div class="data-row">
      <div>
        <strong>Superpowers Workflow</strong>
        <small>${escapeHtml(summary.latestExecutionEvidenceLabel || "No recent execution evidence")}</small>
      </div>
      <div class="pill-list">
        ${renderStatusPill(summary.superpowersWorkflowState)}
        ${renderTag(summary.latestExecutionEvidenceSource || "none", summary.latestExecutionEvidenceSource === "formal_run" ? "source-verified" : "source-pending")}
      </div>
    </div>
  `;
}

export function renderSuperpowersDriftHint(summary) {
  if (!summary?.hasUnwrittenRepoChanges) {
    return "";
  }

  return `
    <div class="data-row">
      <div>
        <strong>Writeback Drift</strong>
        <small>${escapeHtml(summary.fallbackRepoChangeSummary || "Repo-visible changes are newer than the latest formal closeout run.")}</small>
      </div>
      <div class="pill-list">${renderTag(summary.writebackDrift || "repo_ahead_of_writeback", "risk-medium")}</div>
    </div>
  `;
}

export function renderSuperpowersEvidenceMeta(summary) {
  if (!summary?.superpowersWorkflowState || summary.superpowersWorkflowState === "not_used") {
    return "";
  }

  return `
    <div class="data-row">
      <div>
        <strong>Evidence Source</strong>
        <small>${escapeHtml(summary.latestExecutionEvidenceLabel || "No recent execution evidence")}</small>
      </div>
      <div class="pill-list">${renderTag(summary.latestExecutionEvidenceSource || "none", "source-neutral")}</div>
    </div>
  `;
}

export function renderRecentChangesView(ctx, view) {
  return `
    <div class="content-grid single-col">
      <section class="content-card">
        <h3>${escapeHtml(view.title || "最近两次变更摘要")}</h3>
        <div class="data-list">
          ${renderSuperpowersEvidenceMeta(ctx.state.activeSnapshot?.summary)}
          ${renderSuperpowersDriftHint(ctx.state.activeSnapshot?.summary)}
        </div>
        ${renderRecentEntries(view.entries || [])}
      </section>
    </div>
  `;
}

export function renderStatusSourcesView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>状态来源说明</h3>
        <div class="data-list">
          ${renderSuperpowersEvidenceMeta(ctx.state.activeSnapshot?.summary)}
          ${(view.markers || [])
            .map(
              (item) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(item.label || "marker")}</strong>
                    <small>${escapeHtml(item.meaning || "")}</small>
                  </div>
                  <div class="pill-list">${(item.files || []).slice(0, 3).map((file) => renderTag(file, "source-neutral")).join("")}</div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
      <section class="content-card">
        <h3>动作边界</h3>
        <div class="data-list">
          ${(view.actionBoundaries || [])
            .map(
              (item) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(item.label || "boundary")}</strong>
                    <small>${escapeHtml(item.scope || "")}</small>
                  </div>
                  <div class="pill-list">${renderTag(item.mode || "unknown", "source-neutral")}</div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

export function renderRecentEntries(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) {
    return buildEmptyState("当前没有最近变更摘要。");
  }

  return `
    <div class="data-list">
      ${list
        .map(
          (item) => `
            <div class="data-row">
              <div>
                <strong>${escapeHtml(item.title || item.id || "entry")}</strong>
                <small>${escapeHtml(item.summary || "暂无摘要")}</small>
              </div>
              <div class="pill-list">
                ${renderStatusPill(item.type || "run")}
                ${renderTag(formatDateTime(item.createdAt), "source-neutral")}
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}
