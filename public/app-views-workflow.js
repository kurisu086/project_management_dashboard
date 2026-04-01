import {
  escapeHtml,
  renderKeyValueRows,
  renderStatusPill,
  renderTag
} from "./app-utils.js";
import { renderSuperpowersDriftHint } from "./app-views-superpowers.js";

export function renderOverviewWorkflowGuidance(summary) {
  if (!summary?.workflowStage) {
    return "";
  }

  return `
    <div class="data-row">
      <div>
        <strong>下一步动作</strong>
        <small>${escapeHtml(summary.recommendedNextReason || "No workflow guidance reason is available.")}</small>
      </div>
      <div class="pill-list">
        ${renderStatusPill(summary.workflowStage)}
        ${renderTag(summary.recommendedNextAction || "unknown", "source-neutral")}
        ${summary.recommendedNextSkill ? renderTag(summary.recommendedNextSkill, "source-neutral") : ""}
      </div>
    </div>
  `;
}

export function renderInstructionCenterView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>指令中心</h3>
        <div class="data-list">
          ${renderSuperpowersDriftHint(ctx.state.activeSnapshot?.summary)}
        </div>
        ${renderWorkflowGuidancePanel(view.workflowGuidance, "下一步动作")}
        ${renderKeyValueRows([
          row("当前最适合的指令类型", view.primaryType, [renderStatusPill(view.currentActionState)]),
          row("当前可动作状态", view.currentActionState, [renderStatusPill(view.currentActionState)]),
          htmlRow("状态原因", listToText(view.currentActionReasons)),
          htmlRow("次级条件", listToText(view.secondaryConditions)),
          htmlRow("发指令前应补充的上下文", listToText(view.requiredContext))
        ])}
      </section>
      <section class="content-card">
        <h3>可直接复制的指令模板</h3>
        <div class="data-list">
          ${(view.availableTypes || [])
            .map(
              (item) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(item.type || "template")}</strong>
                    <small>${escapeHtml(item.label || "")}</small>
                    <div class="template-card"><pre>${escapeHtml(item.template || "")}</pre></div>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

export function renderOnboardingView(ctx) {
  const onboarding = ctx.state.activeSnapshot?.detail?.views?.onboarding;
  if (!onboarding) {
    return `
      <section class="content-card">
        <h3>接入与运行</h3>
        ${renderKeyValueRows([
          row("启动命令", "node src/server.js"),
          row("访问地址", "http://localhost:4310"),
          row("支持路径", "C:\\work\\demo / D:\\repo\\my-project")
        ])}
      </section>
    `;
  }

  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>接入与运行</h3>
        ${renderWorkflowGuidancePanel(onboarding.workflowGuidance, "当前流程建议")}
        ${renderKeyValueRows([
          row("Onboarding Mode", onboarding.onboardingMode || "standard", [
            renderTag(onboarding.onboardingMode || "standard", "source-neutral")
          ])
        ])}
        ${renderStringListCard("步骤", onboarding.steps)}
        ${renderStringListCard("支持的路径格式", onboarding.supportedPaths)}
        ${renderStringListCard("不支持的方式", onboarding.unsupportedWays)}
      </section>
      <section class="content-card">
        <h3>动作边界</h3>
        <div class="data-list">
          ${(onboarding.actionBoundaries || [])
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

function renderWorkflowGuidancePanel(guidance, title) {
  if (!guidance?.workflowStage) {
    return "";
  }

  const blockingItems = Array.isArray(guidance.workflowBlockingItems)
    ? guidance.workflowBlockingItems.filter(Boolean)
    : [];

  return `
    <section class="template-card section-spacer">
      <strong>${escapeHtml(title)}</strong>
      ${renderKeyValueRows([
        row("Stage", guidance.workflowStage, [renderStatusPill(guidance.workflowStage)]),
        row("Next Action", guidance.recommendedNextAction || "unknown", guidance.recommendedNextSkill
          ? [renderTag(guidance.recommendedNextSkill, "source-neutral")]
          : []),
        row("Why", guidance.recommendedNextReason || "No reason available."),
        row("After This", guidance.recommendedNextAfter || "Re-evaluate the workflow stage.")
      ])}
      ${blockingItems.length ? renderStringListCard("Blocking Items", blockingItems) : ""}
    </section>
  `;
}

function renderStringListCard(title, items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return `
    <section class="template-card section-spacer">
      <strong>${escapeHtml(title)}</strong>
      ${
        list.length
          ? `<ul>${list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>`
          : `<div class="empty-inline">暂无</div>`
      }
    </section>
  `;
}

function row(label, value, tags = []) {
  return { label, value: value || "暂无", tags };
}

function htmlRow(label, valueHtml, tags = []) {
  return { label, valueHtml: escapeHtml(valueHtml || "暂无"), tags };
}

function listToText(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? list.join(" / ") : "暂无";
}
