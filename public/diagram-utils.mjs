export function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function safeMermaidId(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_]/g, "_");
}

export function escapeMermaidLabel(value) {
  return String(value || "unknown").replaceAll('"', '\\"');
}

export function diagramToMermaid(diagram, selectedNodeId) {
  const lines = ["flowchart LR"];
  (diagram.nodes || []).forEach((node) => {
    lines.push(`  ${safeMermaidId(node.id)}["${escapeMermaidLabel(node.label)}"]`);
  });
  (diagram.edges || []).forEach((edge) => {
    lines.push(`  ${safeMermaidId(edge.from)} -->|${escapeMermaidLabel(edge.relation)}| ${safeMermaidId(edge.to)}`);
  });
  (diagram.nodes || []).forEach((node) => {
    const className = node.id === selectedNodeId
      ? "selected"
      : statusClassForNode(node);
    lines.push(`  class ${safeMermaidId(node.id)} ${className}`);
  });
  lines.push("  classDef done fill:#e8f5ec,stroke:#2b7a45,stroke-width:2px,color:#1f1b17");
  lines.push("  classDef in_progress fill:#e8f1fb,stroke:#1f5a8a,stroke-width:2px,color:#1f1b17");
  lines.push("  classDef pending_validation fill:#fbf1df,stroke:#b67c1d,stroke-width:2px,color:#1f1b17");
  lines.push("  classDef not_started fill:#f4efe6,stroke:#6f6155,stroke-width:2px,color:#1f1b17");
  lines.push("  classDef blocked fill:#fae5e1,stroke:#b44034,stroke-width:2px,color:#1f1b17");
  lines.push("  classDef low fill:#f2ecfb,stroke:#6c4ba6,stroke-width:2px,color:#1f1b17");
  lines.push("  classDef unknown fill:#f4efe6,stroke:#6f6155,stroke-width:2px,color:#1f1b17");
  lines.push("  classDef selected fill:#fff4d6,stroke:#b44034,stroke-width:4px,color:#1f1b17");
  return lines.join("\n");
}

function statusClassForNode(node) {
  const status = normalizeValue(node?.status);
  if (status === "done" || status === "pass" || status === "passed" || status === "implemented" || status === "verified" || status === "ready") {
    return "done";
  }
  if (status === "in_progress" || status === "prototype" || status === "updated" || status === "active") {
    return "in_progress";
  }
  if (status === "pending_validation" || status === "partial" || status === "limited" || status === "ready_with_residual_validation") {
    return "pending_validation";
  }
  if (status === "blocked" || status === "failed" || status === "fail") {
    return "blocked";
  }
  if (status === "not_started" || status === "todo" || status === "not_run") {
    return "not_started";
  }
  if (node?.confidence === "low") {
    return "low";
  }
  return "unknown";
}

export function pickSelectedNode(diagram, selectedNodeId) {
  if (!diagram || !Array.isArray(diagram.nodes) || !diagram.nodes.length) {
    return null;
  }
  return diagram.nodes.find((item) => item.id === selectedNodeId) || diagram.nodes[0];
}

export function nextSelectedDiagramNodes(selectedNodes, diagramId, nodeId) {
  return {
    ...(selectedNodes || {}),
    [diagramId]: nodeId
  };
}

export function buildDiagramNodeDetail(diagram, selectedNodeId) {
  const selectedNode = pickSelectedNode(diagram, selectedNodeId);
  if (!selectedNode) {
    return null;
  }

  const connectedNodes = collectConnectedNodes(diagram, selectedNode.id);
  const relatedModules = uniqueStrings([
    ...(selectedNode.related_modules || []),
    ...connectedNodes.filter((item) => item.kind === "module").map((item) => item.label)
  ]);
  const relatedVersions = uniqueStrings([
    ...(selectedNode.related_versions || []),
    ...connectedNodes.filter((item) => item.kind === "version" || item.kind === "future_version").map((item) => item.label)
  ]);
  const relatedWorkPackages = uniqueStrings([
    ...(selectedNode.related_work_packages || []),
    ...connectedNodes.filter((item) => item.kind === "slice").map((item) => item.label)
  ]);
  const relatedRisks = uniqueStrings([
    ...(selectedNode.related_risks || []),
    ...connectedNodes.filter((item) => item.kind === "risk" || item.kind === "blocker").map((item) => item.label)
  ]);
  const relatedValidationGaps = uniqueStrings([
    ...(selectedNode.related_validation_gaps || []),
    ...connectedNodes
      .filter((item) => item.kind === "verification" && !["done", "pass", "ok"].includes(normalizeValue(item.status)))
      .map((item) => item.label)
  ]);
  const unresolvedItems = uniqueStrings([
    ...(selectedNode.unresolved_items || []),
    ...(diagram.unresolved_items || [])
  ]);

  return {
    name: selectedNode.label,
    type: selectedNode.kind,
    status: selectedNode.status,
    source: selectedNode.source_ref || "unknown",
    relatedSourceRefs: uniqueStrings([selectedNode.source_ref, selectedNode.related_ref]),
    confidence: selectedNode.confidence || "low",
    lastUpdatedAt: selectedNode.last_updated_at || null,
    primarySourceFiles: uniqueStrings([
      ...(selectedNode.source_files || []),
      ...((diagram.traceability && diagram.traceability.primarySourceFiles) || [])
    ]),
    recommendedSourceFiles: uniqueStrings([
      ...(selectedNode.recommended_source_files || []),
      ...((diagram.traceability && diagram.traceability.recommendedSourceFiles) || [])
    ]),
    relatedModules,
    relatedVersions,
    relatedWorkPackages,
    relatedRisks,
    relatedValidationGaps,
    unresolvedItems,
    note: selectedNode.note || ""
  };
}

export function buildDiagramFallbackModel(diagram, selectedNodeId, reason) {
  const selectedNode = pickSelectedNode(diagram, selectedNodeId);
  return {
    reason: reason || "Mermaid is unavailable. Falling back to structured diagram data.",
    definition: diagramToMermaid(diagram, selectedNode?.id || null),
    nodes: (diagram.nodes || []).map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      status: node.status,
      confidence: node.confidence
    })),
    edges: (diagram.edges || []).map((edge) => ({
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      confidence: edge.confidence
    }))
  };
}

function collectConnectedNodes(diagram, nodeId) {
  const touchedIds = new Set();
  (diagram.edges || []).forEach((edge) => {
    if (edge.from === nodeId) {
      touchedIds.add(edge.to);
    }
    if (edge.to === nodeId) {
      touchedIds.add(edge.from);
    }
  });
  return (diagram.nodes || []).filter((node) => touchedIds.has(node.id));
}

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}
