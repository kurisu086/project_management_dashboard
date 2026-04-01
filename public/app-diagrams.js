import {
  buildDiagramFallbackModel,
  buildDiagramNodeDetail,
  diagramToMermaid as buildMermaidDefinition,
  nextSelectedDiagramNodes,
  normalizeValue,
  pickSelectedNode
} from "./diagram-utils.mjs";
import {
  buildEmptyState,
  escapeHtml,
  formatDateTime,
  renderSourcePill,
  renderStatusPill,
  renderTag
} from "./app-utils.js";

function safeNodeDomId(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_]/g, "_");
}

export function buildDiagramSubcopy(viewId, diagrams) {
  const labels = {
    "project-panorama": "项目整体结构和当前版本落点会集中显示在这里。",
    "module-dependency": "模块结构图和依赖关系图会一起展示，方便你看整体拆分与阻塞传播。",
    "version-slice": "这里会同时展示版本路线图和当前切片位置图。",
    "game-loop": "游戏循环页只在游戏项目中显示，重点看玩法、收益和成长循环。"
  };
  return labels[viewId] || `当前共有 ${diagrams.length} 张图。`;
}

export function renderDiagramCollectionView(ctx, viewId) {
  const view = ctx.getActiveViewData();
  const diagrams = (view?.diagramIds || [])
    .map((diagramId) => ctx.state.activeSnapshot?.detail?.visualizations?.byId?.[diagramId])
    .filter(Boolean);

  if (!diagrams.length) {
    return buildEmptyState("当前图页没有可展示的图数据。");
  }

  return `
    <div class="content-grid single-col">
      <section class="content-card">
        <h3>${escapeHtml(view.title || "图页")}</h3>
        <p class="detail-subcopy">${escapeHtml(buildDiagramSubcopy(viewId, diagrams))}</p>
        <div class="button-row compact-row">
          <button type="button" class="secondary-action" data-action="open-diagram-overlay" data-view-id="${escapeHtml(viewId)}">打开图悬浮页</button>
          <button type="button" class="ghost-button" data-action="copy-diagram-summary" data-view-id="${escapeHtml(viewId)}">复制图摘要</button>
        </div>
      </section>
      ${diagrams.map((diagram) => renderDiagramSummaryCard(diagram)).join("")}
    </div>
  `;
}

function renderDiagramSummaryCard(diagram) {
  return `
    <section class="content-card diagram-card-shell">
      <div class="diagram-header-row">
        <div>
          <h3>${escapeHtml(diagram.title)}</h3>
          <p class="diagram-subcopy">${escapeHtml(diagram.stale_hint || "可在悬浮页里查看完整图与节点详情。")}</p>
        </div>
        <div class="pill-list">
          ${renderStatusPill(diagram.status)}
          ${renderTag(`coverage ${diagram.coverageLevel || "unknown"}`, "source-neutral")}
          ${renderTag(`freshness ${diagram.freshness || "unknown"}`, "source-neutral")}
        </div>
      </div>
      <div class="mini-card">
        <strong>图状态</strong>
        <div class="pill-list">
          ${renderStatusPill(diagram.status)}
          ${renderTag(diagram.sourceMix || "unknown", "source-neutral")}
        </div>
      </div>
    </section>
  `;
}

export function renderDiagramOverlay(ctx) {
  const overlay = ctx.refs.diagramOverlay;
  const content = ctx.refs.diagramOverlayContent;
  const title = ctx.refs.diagramOverlayTitle;
  const copy = ctx.refs.diagramOverlayCopy;
  if (!overlay || !content || !title || !copy) {
    return;
  }
  const viewId = ctx.state.diagramOverlayView;
  const view = ctx.getViewById(viewId);
  const diagrams = (view?.diagramIds || [])
    .map((diagramId) => ctx.state.activeSnapshot?.detail?.visualizations?.byId?.[diagramId])
    .filter(Boolean);

  overlay.hidden = false;
  title.textContent = view?.title || "项目图";
  copy.textContent = buildDiagramSubcopy(viewId, diagrams);

  content.innerHTML = diagrams.length
    ? diagrams.map((diagram) => renderDiagramCard(ctx, diagram)).join("")
    : buildEmptyState("当前没有可用图数据。");

  queueMicrotask(() => {
    diagrams.forEach((diagram) => {
      hydrateDiagramCard(ctx, diagram);
    });
  });
}

export function closeDiagramOverlay(ctx) {
  ctx.state.diagramOverlayView = null;
  if (ctx.refs.diagramOverlay) {
    ctx.refs.diagramOverlay.hidden = true;
  }
  if (ctx.refs.diagramOverlayContent) {
    ctx.refs.diagramOverlayContent.innerHTML = "";
  }
}

function renderDiagramCard(ctx, diagram) {
  const selectedNodeId = ctx.state.selectedDiagramNodes[diagram.id] || diagram.nodes?.[0]?.id || null;
  const detail = buildDiagramNodeDetail(diagram, selectedNodeId);
  const chips = (diagram.nodes || [])
    .slice(0, 16)
    .map((node) => {
      const active = node.id === selectedNodeId ? " active" : "";
      return `<button type="button" class="node-chip${active}" data-action="select-diagram-node" data-diagram-id="${escapeHtml(diagram.id)}" data-node-id="${escapeHtml(node.id)}">${escapeHtml(node.label)}</button>`;
    })
    .join("");

  return `
    <section class="content-card diagram-card-shell" data-diagram-shell="${escapeHtml(diagram.id)}">
      <div class="diagram-header-row">
        <div>
          <h3>${escapeHtml(diagram.title)}</h3>
          <p class="diagram-subcopy">
            状态：${escapeHtml(diagram.status || "unknown")} |
            覆盖度：${escapeHtml(diagram.coverageLevel || "unknown")} |
            新鲜度：${escapeHtml(diagram.freshness || "unknown")} |
            节点/边：${escapeHtml(`${diagram.nodes?.length || 0} / ${diagram.edges?.length || 0}`)}
          </p>
        </div>
        <div class="pill-list">
          ${renderStatusPill(diagram.status)}
          ${renderTag(diagram.type || "diagram", "source-neutral")}
        </div>
      </div>
      <div class="diagram-layout">
        <div class="diagram-canvas-panel">
          <div class="diagram-toolbar">
            <small>${escapeHtml(diagram.stale_hint || "图会根据当前缓存自动刷新。")}</small>
            <div class="diagram-toolbar-actions">
              <button type="button" class="diagram-tool-button" data-action="diagram-zoom-in" data-diagram-id="${escapeHtml(diagram.id)}">放大</button>
              <button type="button" class="diagram-tool-button" data-action="diagram-zoom-out" data-diagram-id="${escapeHtml(diagram.id)}">缩小</button>
              <button type="button" class="diagram-tool-button" data-action="diagram-reset" data-diagram-id="${escapeHtml(diagram.id)}">重置</button>
              <button type="button" class="diagram-tool-button" data-action="diagram-fit" data-diagram-id="${escapeHtml(diagram.id)}">适配</button>
            </div>
          </div>
          <div class="diagram-stage" id="diagram-stage-${escapeHtml(diagram.id)}"></div>
          <div class="stack-list">${chips}</div>
        </div>
        <div class="diagram-side-panel">
          <div class="mini-card">
            <strong>图说明</strong>
            ${buildDiagramMeta(diagram)}
          </div>
          <div class="mini-card">
            <strong>节点详情</strong>
            ${renderNodeDetail(detail)}
          </div>
        </div>
      </div>
    </section>
  `;
}

function buildDiagramMeta(diagram) {
  return `
    <div class="data-list compact-list">
      <div class="data-row"><div><strong>状态</strong><small>${escapeHtml(diagram.status || "unknown")}</small></div><div class="pill-list">${renderStatusPill(diagram.status)}</div></div>
      <div class="data-row"><div><strong>Coverage</strong><small>${escapeHtml(diagram.coverageLevel || "unknown")}</small></div><div class="pill-list">${renderTag(diagram.sourceMix || "unknown", "source-neutral")}</div></div>
      <div class="data-row"><div><strong>Freshness</strong><small>${escapeHtml(diagram.freshness || "unknown")}</small></div><div class="pill-list">${renderTag(formatDateTime(diagram.generated_at), "source-neutral")}</div></div>
      <div class="data-row"><div><strong>数据来源</strong><small>${escapeHtml((diagram.source_summary || []).join(" | ") || "unknown")}</small></div></div>
      <div class="data-row"><div><strong>缺失字段</strong><small>${escapeHtml((diagram.degradation?.missing_fields || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>省略内容</strong><small>${escapeHtml([...(diagram.degradation?.omitted_nodes || []), ...(diagram.degradation?.omitted_edges || [])].join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>主要依赖源文件</strong><small>${escapeHtml((diagram.traceability?.primarySourceFiles || []).join("、") || "unknown")}</small></div></div>
      <div class="data-row"><div><strong>最缺信息的源文件</strong><small>${escapeHtml((diagram.traceability?.weakSourceFiles || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>建议补充的源文件</strong><small>${escapeHtml((diagram.traceability?.recommendedSourceFiles || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>待确认项</strong><small>${escapeHtml((diagram.unresolved_items || []).join("、") || "暂无")}</small></div></div>
    </div>
  `;
}

function renderNodeDetail(detail) {
  if (!detail) {
    return buildEmptyState("当前没有可查看的节点详情。");
  }

  return `
    <div class="data-list compact-list">
      <div class="data-row"><div><strong>名称</strong><small>${escapeHtml(detail.name)}</small></div><div class="pill-list">${renderStatusPill(detail.status)}</div></div>
      <div class="data-row"><div><strong>类型</strong><small>${escapeHtml(detail.type || "unknown")}</small></div><div class="pill-list">${renderSourcePill(detail.source, detail.source || "unknown")}</div></div>
      <div class="data-row"><div><strong>来源</strong><small>${escapeHtml(detail.source || "unknown")}</small></div><div class="pill-list">${renderTag(detail.confidence || "medium", "source-neutral")}</div></div>
      <div class="data-row"><div><strong>最后更新时间</strong><small>${escapeHtml(formatDateTime(detail.lastUpdatedAt))}</small></div></div>
      <div class="data-row"><div><strong>主要来源文件</strong><small>${escapeHtml((detail.primarySourceFiles || []).join("、") || "unknown")}</small></div></div>
      <div class="data-row"><div><strong>相关 source_ref</strong><small>${escapeHtml((detail.relatedSourceRefs || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>推荐补充的源文件</strong><small>${escapeHtml((detail.recommendedSourceFiles || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>关联模块</strong><small>${escapeHtml((detail.relatedModules || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>关联版本</strong><small>${escapeHtml((detail.relatedVersions || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>关联工作包</strong><small>${escapeHtml((detail.relatedWorkPackages || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>相关风险</strong><small>${escapeHtml((detail.relatedRisks || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>相关验证缺口</strong><small>${escapeHtml((detail.relatedValidationGaps || []).join("、") || "暂无")}</small></div></div>
      <div class="data-row"><div><strong>未决项</strong><small>${escapeHtml((detail.unresolvedItems || []).join("、") || "暂无")}</small></div></div>
      ${detail.note ? `<div class="data-row"><div><strong>备注</strong><small>${escapeHtml(detail.note)}</small></div></div>` : ""}
    </div>
  `;
}

async function hydrateDiagramCard(ctx, diagram) {
  const stage = document.getElementById(`diagram-stage-${diagram.id}`);
  if (!stage) {
    return;
  }

  const selectedNodeId = ctx.state.selectedDiagramNodes[diagram.id] || diagram.nodes?.[0]?.id || null;
  const definition = buildMermaidDefinition(diagram, selectedNodeId);

  if (!window.mermaid?.render) {
    renderDiagramFallback(stage, diagram, selectedNodeId, "Mermaid not available.");
    return;
  }

  try {
    const renderResult = await window.mermaid.render(`diagram-${diagram.id}-${Date.now()}`, definition);
    stage.innerHTML = `
      <div class="diagram-viewport" data-diagram-viewport="${escapeHtml(diagram.id)}">
        <div class="diagram-transform" data-diagram-transform="${escapeHtml(diagram.id)}">
          ${renderResult.svg}
        </div>
      </div>
    `;
    bindViewportDrag(ctx, diagram.id, stage);
    bindSvgNodeClicks(ctx, diagram, stage);
    applyViewportTransform(ctx, diagram.id);
  } catch (error) {
    renderDiagramFallback(stage, diagram, selectedNodeId, error?.message || "Mermaid render failed.");
  }
}

function renderDiagramFallback(stage, diagram, selectedNodeId, reason) {
  const fallback = buildDiagramFallbackModel(diagram, selectedNodeId, reason);
  stage.innerHTML = `
    <div class="diagram-fallback-shell">
      <div class="inline-status tone-error">${escapeHtml(fallback.reason)}</div>
      <div class="fallback-grid">
        <div class="mini-card">
          <strong>Nodes</strong>
          <pre class="diagram-fallback">${escapeHtml(JSON.stringify(fallback.nodes, null, 2))}</pre>
        </div>
        <div class="mini-card">
          <strong>Edges</strong>
          <pre class="diagram-fallback">${escapeHtml(JSON.stringify(fallback.edges, null, 2))}</pre>
        </div>
      </div>
      <details class="fallback-details">
        <summary>Mermaid definition</summary>
        <pre class="diagram-fallback">${escapeHtml(fallback.definition)}</pre>
      </details>
    </div>
  `;
}

function bindSvgNodeClicks(ctx, diagram, stage) {
  stage.querySelectorAll("g.node").forEach((nodeEl) => {
    nodeEl.addEventListener("click", () => {
      const match = (diagram.nodes || []).find((node) => safeNodeDomId(node.id) === nodeEl.id);
      if (!match) {
        return;
      }
      ctx.state.selectedDiagramNodes = nextSelectedDiagramNodes(ctx.state.selectedDiagramNodes, diagram.id, match.id);
      renderDiagramOverlay(ctx);
    });
  });
}

function bindViewportDrag(ctx, diagramId, stage) {
  const viewport = stage.querySelector(`[data-diagram-viewport="${diagramId}"]`);
  if (!viewport) {
    return;
  }

  let startX = 0;
  let startY = 0;
  let dragging = false;

  viewport.onpointerdown = (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    viewport.classList.add("dragging");
    viewport.setPointerCapture(event.pointerId);
  };

  viewport.onpointermove = (event) => {
    if (!dragging) {
      return;
    }
    const current = ensureViewportState(ctx, diagramId);
    current.x += event.clientX - startX;
    current.y += event.clientY - startY;
    startX = event.clientX;
    startY = event.clientY;
    applyViewportTransform(ctx, diagramId);
  };

  viewport.onpointerup = (event) => {
    dragging = false;
    viewport.classList.remove("dragging");
    viewport.releasePointerCapture(event.pointerId);
  };

  viewport.onpointercancel = () => {
    dragging = false;
    viewport.classList.remove("dragging");
  };
}

function ensureViewportState(ctx, diagramId) {
  if (!ctx.state.diagramViewportState[diagramId]) {
    ctx.state.diagramViewportState[diagramId] = {
      scale: 1,
      x: 0,
      y: 0
    };
  }
  return ctx.state.diagramViewportState[diagramId];
}

export function applyViewportTransform(ctx, diagramId) {
  const transformEl = document.querySelector(`[data-diagram-transform="${diagramId}"]`);
  if (!transformEl) {
    return;
  }
  const viewportState = ensureViewportState(ctx, diagramId);
  transformEl.style.transform = `translate(${viewportState.x}px, ${viewportState.y}px) scale(${viewportState.scale})`;
}

export function updateViewport(ctx, diagramId, action) {
  const viewportState = ensureViewportState(ctx, diagramId);
  if (action === "zoom-in") {
    viewportState.scale = Math.min(2.5, viewportState.scale + 0.15);
  } else if (action === "zoom-out") {
    viewportState.scale = Math.max(0.5, viewportState.scale - 0.15);
  } else {
    viewportState.scale = 1;
    viewportState.x = 0;
    viewportState.y = 0;
  }
  applyViewportTransform(ctx, diagramId);
}
