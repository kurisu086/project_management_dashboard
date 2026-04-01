import { isDiagramView, resolveViewKey } from "./app-config.js";
import { renderDiagramCollectionView } from "./app-diagrams.js";
import { renderExistingProjectRecoveryView, renderGptAssistView, renderNewProjectFilingView } from "./app-workbench.js";
import {
  buildEmptyState,
  buildJsonPreview,
  displayRiskTitle,
  displayValidationLabel,
  escapeHtml,
  formatDateTime,
  formatMultiline,
  getFieldConfidence,
  getFieldSourceKind,
  getFieldUpdatedAt,
  getFieldValue,
  renderFieldRow,
  renderKeyValueRows,
  renderRiskPill,
  renderSourcePill,
  renderStatusPill,
  renderTag
} from "./app-utils.js";

export function renderCurrentView(ctx) {
  const viewId = ctx.state.activeView;
  if (viewId === "new-project-filing") return renderNewProjectFilingView(ctx);
  if (viewId === "existing-project-recovery") return renderExistingProjectRecoveryView(ctx);
  if (viewId === "gpt-assist") return renderGptAssistView(ctx);
  if (viewId === "diagnostics") return renderDiagnosticsView(ctx);
  if (viewId === "runtime") return renderRuntimeView(ctx);
  if (viewId === "onboarding") return renderOnboardingView(ctx);

  if (!ctx.state.activeSnapshot) {
    return buildEmptyState("请先接入一个项目。");
  }

  if (isDiagramView(viewId)) {
    return renderDiagramCollectionView(ctx, viewId);
  }

  const viewKey = resolveViewKey(viewId);
  const view = ctx.state.activeSnapshot.detail?.views?.[viewKey];
  if (!view) {
    return buildEmptyState("当前页面数据暂不可用。");
  }

  const renderers = {
    overview: renderOverviewView,
    definition: renderDefinitionView,
    modules: renderModulesView,
    tech: renderTechArchitectureView,
    game: renderGameDesignView,
    decisions: renderDecisionsView,
    "version-cockpit": renderVersionCockpitView,
    "current-slice": renderCurrentSliceView,
    "scope-boundary": renderScopeBoundaryView,
    "verification-matrix": renderVerificationMatrixView,
    "risk-blockers": renderRiskBlockersView,
    "instruction-center": renderInstructionCenterView,
    deliverables: renderDeliverablesView,
    "recent-changes": renderRecentChangesView,
    "status-sources": renderStatusSourcesView
  };

  return (renderers[viewId] || renderGenericView)(ctx, view);
}

function normalizeList(items) {
  if (Array.isArray(items)) {
    return items.filter(Boolean);
  }
  if (items && typeof items === "object") {
    const value = getFieldValue(items);
    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }
    if (value === undefined || value === null || value === "") {
      return [];
    }
    return [value];
  }
  if (items === undefined || items === null || items === "") {
    return [];
  }
  return [items];
}

function renderOverviewView(ctx, view) {
  const snapshot = ctx.state.activeSnapshot;
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>${escapeHtml(view.title || "项目总览")}</h3>
        ${ctx.renderUsageCallout("先看这里", "项目总览用于快速回答项目是什么、做到哪里、下一步最适合推进什么。", [
          "如果待确认项还很多，先别急着直接让 Codex 实现。",
          "优先看头部的“待确认 X”入口。"
        ])}
        ${renderKeyValueRows([
          simpleRow("项目名称", view.projectName || snapshot.project.name),
          fieldRow("一句话定义", view.oneLineDefinition, { multiline: true }),
          fieldRow("项目类型", view.projectType),
          simpleRow("整体完成度", view.overallCompletion || "阶段性推进中"),
          fieldRow("终版目标", view.finalGoal, { multiline: true }),
          fieldRow("当前版本目标", view.versionTarget, { multiline: true }),
          fieldRow("当前阶段", view.currentStage),
          fieldRow("当前工作包", view.currentWorkPackage, { multiline: true })
        ])}
      </section>
      <section class="content-card">
        <h3>当前控制摘要</h3>
        ${renderKeyValueRows([
          simpleRow("Primary State", snapshot.summary.currentActionState, [renderStatusPill(snapshot.summary.currentActionState)]),
          simpleHtmlRow("状态原因", listToText(snapshot.summary.currentActionReasons)),
          simpleHtmlRow("次级条件", listToText(snapshot.summary.secondaryConditions)),
          simpleRow("待确认项", String(snapshot.summary.pendingReviewCount || 0), [renderTag("点击头部按钮查看", "source-pending")]),
          simpleRow("来源不一致", String(snapshot.summary.sourceConflictCount || 0), [renderTag("不同来源对同一字段说法不一致", "risk-medium")]),
          simpleRow("技术栈摘要", snapshot.summary.techStackSummary || "暂无")
        ])}
      </section>
    </div>
  `;
}

function renderDefinitionView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>项目定义</h3>
        ${renderKeyValueRows([
          fieldRow("一句话定义", view.oneLineDefinition, { multiline: true }),
          fieldRow("终版目标", view.finalGoal, { multiline: true }),
          fieldRow("当前版本目标", view.currentVersionTarget, { multiline: true }),
          simpleHtmlRow("目标效果", listToText(view.targetOutcome)),
          simpleHtmlRow("面向对象 / 体验", listToText(view.audienceExperience)),
          simpleHtmlRow("当前做什么", listToText(view.scopeIn)),
          simpleHtmlRow("当前不做什么", listToText(view.scopeOut))
        ])}
      </section>
      <section class="content-card">
        <h3>事实 / 声明 / 待确认</h3>
        ${renderStringListCard("已知事实", view.knownFacts)}
        ${renderStringListCard("项目声明", view.declaredItems)}
        ${renderStringListCard("补充来源", view.supplementalItems)}
        ${renderStringListCard("待确认项", view.needsConfirmation, "source-pending")}
      </section>
    </div>
  `;
}

function renderModulesView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>模块地图</h3>
        <div class="data-list">
          ${(view.modules || [])
            .map(
              (module, index) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(module.name || `模块 ${index + 1}`)}</strong>
                    <small>${escapeHtml(module.responsibility || "暂无职责描述")}</small>
                  </div>
                  <div class="pill-list">
                    ${renderStatusPill(module.status || "unknown")}
                    ${renderSourcePill(module.sourceKind || "declared", module.sourceKind || "declared")}
                  </div>
                </div>
              `
            )
            .join("") || buildEmptyState("当前还没有模块数据。")}
        </div>
      </section>
      <section class="content-card">
        <h3>模块关系与当前工作包</h3>
        ${renderStringListCard(
          "模块之间关系",
          (view.relations || []).map((item) => `${item.from} -> ${item.to} (${item.relation})`)
        )}
        ${renderKeyValueRows([
          simpleRow("当前工作包", getFieldValue(view.currentWorkPackage) || "暂无"),
          simpleRow(
            "当前切片所属模块",
            view.currentWorkPackageModule?.moduleName || "unknown",
            [renderStatusPill(view.currentWorkPackageModule?.relation || "unknown")]
          )
        ])}
        ${renderStringListCard("未知项", view.unknowns, "source-pending")}
      </section>
    </div>
  `;
}

function renderTechArchitectureView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>技术架构</h3>
        ${renderKeyValueRows([
          fieldRow("前端 / 客户端", view.frontendClient, { multiline: true }),
          fieldRow("画面显示方式", view.rendering, { multiline: true }),
          fieldRow("UI 技术", view.uiTech, { multiline: true }),
          fieldRow("状态管理 / 数据流", view.stateManagement, { multiline: true }),
          fieldRow("存档方式", view.storage, { multiline: true }),
          fieldRow("构建与启动方式", view.buildRun, { multiline: true })
        ])}
      </section>
      <section class="content-card">
        <h3>后端与基础设施</h3>
        ${renderKeyValueRows([
          fieldRow("是否有后端", view.backend?.exists || { value: "unknown" }),
          fieldRow("后端技术", view.backend?.tech || { value: "unknown" }, { multiline: true }),
          fieldRow("后端职责", view.backend?.responsibility || { value: "unknown" }, { multiline: true }),
          simpleHtmlRow("关键基础设施", listToText(view.infrastructure))
        ])}
        ${renderStringListCard("待确认项", view.needsConfirmation, "source-pending")}
      </section>
    </div>
  `;
}

function renderGameDesignView(ctx, view) {
  if (view.visible === false) {
    return buildEmptyState("当前项目不是游戏项目，或尚未识别为游戏。");
  }
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>游戏设计</h3>
        ${renderKeyValueRows([
          fieldRow("游戏分类", view.gameCategory),
          fieldRow("核心玩法循环", view.coreLoop, { multiline: true }),
          fieldRow("成长循环", view.progressionLoop, { multiline: true }),
          fieldRow("收益循环", view.economyLoop, { multiline: true }),
          fieldRow("离线收益 / 自动化", view.automation, { multiline: true })
        ])}
      </section>
      <section class="content-card">
        <h3>体验目标</h3>
        ${renderKeyValueRows([
          fieldRow("画面方向", view.visualDirection, { multiline: true }),
          simpleHtmlRow("主要界面", listToText(view.primaryScreens)),
          fieldRow("玩家最终体验目标", view.playerExperienceGoal, { multiline: true }),
          fieldRow("当前可玩程度", view.playableState, { multiline: true })
        ])}
        ${renderStringListCard("待确认项", view.needsConfirmation, "source-pending")}
      </section>
    </div>
  `;
}

function renderDecisionsView(ctx, view) {
  return `
    <div class="content-grid single-col">
      <section class="content-card">
        <h3>决策记录</h3>
        ${ctx.renderUsageCallout("这里怎么用", "这里只记录会改变项目方向、版本边界、架构路线的重大决定。", [
          "例如：是否保留 Boss 战、当前版本是否只做离线闭环、是否需要后端。",
          "普通实现细节不需要放进这里。"
        ])}
        ${
          (view.decisions || []).length
            ? `<div class="data-list">${view.decisions
                .map(
                  (decision) => `
                    <div class="data-row">
                      <div>
                        <strong>${escapeHtml(decision.title || decision.decision_id || "decision")}</strong>
                        <small>${escapeHtml(decision.summary || "暂无摘要")}</small>
                      </div>
                      <div class="pill-list">
                        ${renderStatusPill(decision.status || "unknown")}
                        ${renderTag((decision.relatedVersions || []).join("、") || "无版本关联", "source-neutral")}
                      </div>
                    </div>
                  `
                )
                .join("")}</div>`
            : buildEmptyState("当前还没有可展示的决策记录。")
        }
      </section>
    </div>
  `;
}

function renderVersionCockpitView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>版本驾驶舱</h3>
        ${ctx.renderUsageCallout("这里怎么读", "Primary State 表示现在最适合推进什么；Go / No-Go 表示当前版本是否已经具备放行条件。", [
          "能开始实现，不等于已经 Go。",
          "ready_with_residual_validation 通常表示可以继续做，但验证还没完全收口。"
        ])}
        ${renderKeyValueRows([
          fieldRow("当前版本目标", view.versionTarget, { multiline: true }),
          simpleHtmlRow("当前版本非范围", listToText((view.versionNonScope || []).map((item) => item.value || item.label || item))),
          simpleHtmlRow("完成定义（DoD）", listToText(view.definitionOfDone)),
          fieldRow("当前阶段", view.currentStage),
          fieldRow("当前工作包", view.currentWorkPackage, { multiline: true }),
          simpleRow("当前切片所属模块", view.currentSliceModule?.moduleName || "unknown", [
            renderStatusPill(view.currentSliceModule?.relation || "unknown")
          ]),
          simpleRow("Primary State", view.currentActionState, [renderStatusPill(view.currentActionState)]),
          simpleHtmlRow("状态原因", listToText(view.currentActionReasons)),
          simpleHtmlRow("次级条件", listToText(view.secondaryConditions)),
          simpleRow("Go / No-Go 状态", view.goNoGoStatus?.value || "unknown", [
            renderStatusPill(view.goNoGoStatus?.value || "unknown")
          ])
        ])}
      </section>
      <section class="content-card">
        <h3>版本风险</h3>
        ${renderStringListCard("关键风险", (view.keyRisks || []).map((item, index) => displayRiskTitle(item, index)))}
        ${renderStringListCard("当前 blockers", (view.blockers || []).map((item) => item.label || item.value))}
        ${renderStringListCard("待确认项", (view.pendingReview?.items || []).map((item) => item.label), "source-pending")}
      </section>
    </div>
  `;
}

function renderCurrentSliceView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>当前阶段与当前切片</h3>
        ${renderKeyValueRows([
          fieldRow("当前版本目标", view.currentVersionTarget, { multiline: true }),
          fieldRow("当前阶段", view.currentStage),
          fieldRow("当前工作包", view.currentWorkPackage, { multiline: true }),
          simpleRow("所属模块", view.currentSliceModule?.moduleName || "unknown", [
            renderStatusPill(view.currentSliceModule?.relation || "unknown")
          ]),
          simpleRow("服务整体目标的哪一段", view.currentSliceGoalLink || "暂无"),
          simpleRow("完成后会推动什么前进", view.completionImpact || "暂无")
        ])}
      </section>
      <section class="content-card">
        <h3>最近两次变更摘要</h3>
        ${renderRecentEntries(view.recentChangeSummaries || [])}
      </section>
    </div>
  `;
}

function renderScopeBoundaryView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>范围边界</h3>
        ${renderFieldSection("终版目标", view.finalGoal)}
        ${renderStringListCard("当前做什么", view.scopeIn)}
      </section>
      <section class="content-card">
        <h3>当前版本不做什么</h3>
        ${renderStringListCard("项目整体不做", view.scopeOut)}
        ${renderStringListCard("当前版本非范围", (view.versionNonScope || []).map((item) => item.value || item.label || item))}
        ${renderFieldSection("当前版本目标", view.currentVersionTarget)}
      </section>
    </div>
  `;
}

function renderVerificationMatrixView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>验证矩阵</h3>
        ${ctx.renderUsageCallout("这里怎么用", "这页不是看做了哪些功能，而是看哪些验证已经覆盖、哪些还没覆盖。", [
          "如果验证项名字很泛，先把名字补清楚。",
          "Go / No-Go 状态也要结合这里一起读。"
        ])}
        ${renderKeyValueRows([
          fieldRow("验证口径 / 摘要", view.verificationSummary, { multiline: true }),
          simpleRow("Go / No-Go 状态", view.goNoGoStatus?.value || "unknown", [
            renderStatusPill(view.goNoGoStatus?.value || "unknown")
          ])
        ])}
        <div class="data-list">
          ${(view.verificationMatrix || [])
            .map(
              (item, index) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(displayValidationLabel(item, index))}</strong>
                    <small>${escapeHtml(item.note || item.source_ref || "暂无备注")}</small>
                  </div>
                  <div class="pill-list">
                    ${renderStatusPill(item.status || "unknown")}
                    ${renderSourcePill(item.sourceKind || "declared", item.sourceKind || "declared")}
                  </div>
                </div>
              `
            )
            .join("") || buildEmptyState("当前没有验证项。")}
        </div>
      </section>
      <section class="content-card">
        <h3>一致性状态</h3>
        ${renderConsistencyBlock(view.consistency)}
      </section>
    </div>
  `;
}

function renderRiskBlockersView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>风险与阻塞</h3>
        ${ctx.renderUsageCallout("这里怎么读", "这里展示的是风险、blocker 和来源不一致。来源不一致不是修改文件数量，而是不同来源对同一字段说法不一致。", [
          "如果来源不一致很多，优先回到待确认项和 GPT 提示词。",
          "未命名风险最好尽快补成可读标题。"
        ])}
        <div class="data-list">
          ${(view.risks || [])
            .map(
              (risk, index) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(displayRiskTitle(risk, index))}</strong>
                    <small>${escapeHtml(risk.detail || risk.source || "暂无说明")}</small>
                  </div>
                  <div class="pill-list">${renderRiskPill(risk.level || "medium", `风险 ${risk.level || "unknown"}`)}</div>
                </div>
              `
            )
            .join("") || buildEmptyState("当前没有关键风险。")}
        </div>
        ${renderStringListCard("当前 blockers", (view.blockers || []).map((item) => item.label || item.value))}
        ${renderStringListCard("待决决策", (view.pendingDecisions || []).map((item) => item.title || item.decision_id))}
      </section>
      <section class="content-card">
        <h3>来源不一致与 declared / verified 边界</h3>
        <div class="data-list">
          ${(view.conflicts || [])
            .map(
              (conflict) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(conflict.type || "source_conflict")}</strong>
                    <small>${escapeHtml(conflict.message || "暂无说明")}</small>
                  </div>
                  <div class="pill-list">${renderRiskPill(conflict.level || "medium", conflict.level || "medium")}</div>
                </div>
              `
            )
            .join("") || buildEmptyState("当前没有来源不一致。")}
        </div>
        ${renderStringListCard("declared 但未 verified", view.declaredNotVerified)}
      </section>
    </div>
  `;
}

function renderInstructionCenterView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>指令中心</h3>
        ${renderKeyValueRows([
          simpleRow("当前最适合的指令类型", view.primaryType, [renderStatusPill(view.currentActionState)]),
          simpleRow("当前可动作状态", view.currentActionState, [renderStatusPill(view.currentActionState)]),
          simpleHtmlRow("状态原因", listToText(view.currentActionReasons)),
          simpleHtmlRow("次级条件", listToText(view.secondaryConditions)),
          simpleHtmlRow("发指令前应补充的上下文", listToText(view.requiredContext))
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

function renderDeliverablesView(ctx, view) {
  return `
    <div class="content-grid single-col">
      <section class="content-card">
        <h3>固定交付 10 项</h3>
        <div class="data-list">
          ${(view.fixedDeliverables || [])
            .map(
              (item) => `
                <div class="data-row">
                  <div>
                    <strong>${escapeHtml(item.title || item.key || "deliverable")}</strong>
                    <small>${escapeHtml(item.value || item.note || "暂无")}</small>
                  </div>
                  <div class="pill-list">${renderStatusPill(item.status || "unknown")}</div>
                </div>
              `
            )
            .join("") || buildEmptyState("当前没有固定交付记录。")}
        </div>
      </section>
    </div>
  `;
}

function renderRecentChangesView(ctx, view) {
  return `
    <div class="content-grid single-col">
      <section class="content-card">
        <h3>${escapeHtml(view.title || "最近两次变更摘要")}</h3>
        ${renderRecentEntries(view.entries || [])}
      </section>
    </div>
  `;
}

function renderStatusSourcesView(ctx, view) {
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>状态来源说明</h3>
        <div class="data-list">
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

function renderDiagnosticsView(ctx) {
  const diagnostics = ctx.state.activeSnapshot?.diagnostics || ctx.state.diagnostics || [];
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>最近一次诊断</h3>
        ${ctx.renderUsageCallout("这页是干嘛的", "接入诊断只用于排查“为什么项目接不进来”，不是日常开发进度页。", [
          "如果添加项目失败，就来这里看路径、git repo、写入权限哪里没通过。",
          "如果日常开发正常，这页通常不需要频繁看。"
        ])}
        ${diagnostics[0] ? renderDiagnosticCard(diagnostics[0]) : buildEmptyState("当前没有诊断记录。")}
      </section>
      <section class="content-card">
        <h3>最近几次接入诊断</h3>
        ${diagnostics.length ? diagnostics.slice(0, 5).map(renderDiagnosticCard).join("") : buildEmptyState("暂无历史。")}
      </section>
    </div>
  `;
}

function renderRuntimeView(ctx) {
  const runtime = ctx.state.runtime || ctx.state.projectsPayload?.runtime || {};
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>当前运行环境</h3>
        ${renderKeyValueRows([
          simpleRow("process.platform", runtime.platform || "unknown"),
          simpleRow("Node 运行环境说明", runtime.nodeRuntimeDescription || "unknown"),
          simpleRow("Windows 本机模式", runtime.isWindowsNative ? "yes" : "no", [
            renderStatusPill(runtime.isWindowsNative ? "ready" : "blocked", runtime.isWindowsNative ? "启用" : "未启用")
          ])
        ])}
      </section>
      <section class="content-card">
        <h3>目录选择器</h3>
        ${renderKeyValueRows([
          simpleRow("是否支持", runtime.directoryPicker?.supported ? "yes" : "no"),
          simpleRow("原因", runtime.directoryPicker?.reason || "unknown")
        ])}
      </section>
    </div>
  `;
}

function renderOnboardingView(ctx) {
  const onboarding = ctx.state.activeSnapshot?.detail?.views?.onboarding;
  if (!onboarding) {
    return `
      <section class="content-card">
        <h3>接入与运行</h3>
        ${renderKeyValueRows([
          simpleRow("启动命令", "node src/server.js"),
          simpleRow("访问地址", "http://localhost:4310"),
          simpleRow("支持路径", "C:\\work\\demo / D:\\repo\\my-project")
        ])}
      </section>
    `;
  }
  return `
    <div class="content-grid two-col">
      <section class="content-card">
        <h3>接入与运行</h3>
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

function renderGenericView(ctx, view) {
  return `
    <div class="content-grid single-col">
      <section class="content-card">
        <h3>${escapeHtml(view.title || "View")}</h3>
        ${buildJsonPreview(view)}
      </section>
    </div>
  `;
}

function fieldRow(label, field, options = {}) {
  return renderFieldRow(label, field, { includeUpdated: true, ...options });
}

function simpleRow(label, value, tags = []) {
  return { label, value: value || "暂无", tags };
}

function simpleHtmlRow(label, valueHtml, tags = []) {
  return { label, valueHtml: escapeHtml(valueHtml || "暂无"), tags };
}

function renderFieldSection(title, field) {
  return `
    <section class="template-card section-spacer">
      <strong>${escapeHtml(title)}</strong>
      <p>${formatMultiline(getFieldValue(field) || "暂无")}</p>
      <div class="pill-list">
        ${renderSourcePill(getFieldSourceKind(field), getFieldSourceKind(field))}
        ${renderTag(formatDateTime(getFieldUpdatedAt(field)), "source-neutral")}
        ${renderTag(getFieldConfidence(field), "source-neutral")}
      </div>
    </section>
  `;
}

function renderStringListCard(title, items, tagClass = "") {
  const list = normalizeList(items);
  return `
    <section class="template-card section-spacer">
      <strong>${escapeHtml(title)}</strong>
      ${
        list.length
          ? `<ul>${list
              .map((item) => {
                const text = typeof item === "string" ? item : item?.label || item?.title || String(item);
                return `<li>${tagClass ? renderTag(text, tagClass) : escapeHtml(text)}</li>`;
              })
              .join("")}</ul>`
          : `<div class="empty-inline">暂无</div>`
      }
    </section>
  `;
}

function renderConsistencyBlock(consistency) {
  if (!consistency) {
    return buildEmptyState("当前没有一致性数据。");
  }
  return `
    <div class="data-list">
      ${["docs", "code", "tests"]
        .map(
          (key) => `
            <div class="data-row">
              <div>
                <strong>${escapeHtml(key)}</strong>
                <small>${escapeHtml(consistency.declared?.[key]?.note || "暂无")}</small>
              </div>
              <div class="pill-list">
                ${renderStatusPill(consistency.declared?.[key]?.status || "unknown")}
                ${renderSourcePill("declared", "declared")}
              </div>
            </div>
          `
        )
        .join("")}
      <div class="data-row"><div><strong>模式</strong><small>${escapeHtml(consistency.mode || "unknown")}</small></div></div>
      <div class="data-row"><div><strong>verified</strong><small>${escapeHtml(consistency.verified ? "available" : "not available")}</small></div></div>
    </div>
  `;
}

function renderRecentEntries(entries) {
  const list = normalizeList(entries);
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

function renderDiagnosticCard(item) {
  return `
    <article class="diagnostic-card">
      <strong>${escapeHtml(item.status === "success" ? "接入成功" : "接入失败")}</strong>
      <p class="inline-subcopy">${escapeHtml(item.rawInput || "unknown path")}</p>
      <div class="stack-list">
        ${renderStatusPill(item.status === "success" ? "ready" : "blocked", item.status)}
        ${renderTag(item.runtimePlatform || "unknown", "source-neutral")}
      </div>
      <div class="template-card"><pre>${escapeHtml(JSON.stringify(item.diagnostic || item, null, 2))}</pre></div>
    </article>
  `;
}

function listToText(items) {
  const list = normalizeList(items).map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      return item.label || item.title || item.value || JSON.stringify(item);
    }
    return String(item);
  });
  return list.length ? list.join("、") : "暂无";
}
