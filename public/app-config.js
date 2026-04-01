import { WORKFLOW_LABELS, WORKFLOW_VIEW_IDS } from "./app-workflow-config.js";

export const VIEW_KEY_BY_ID = {
  overview: "overview",
  "project-panorama": "projectPanorama",
  definition: "definition",
  modules: "modules",
  "module-dependency": "moduleDependency",
  tech: "techArchitecture",
  game: "gameDesign",
  "game-loop": "gameLoop",
  decisions: "decisions",
  "version-cockpit": "versionCockpit",
  "current-slice": "currentSlice",
  "version-slice": "versionSlice",
  "scope-boundary": "scopeBoundary",
  "verification-matrix": "verificationMatrix",
  "risk-blockers": "riskBlockers",
  "instruction-center": "instructionCenter",
  deliverables: "deliverables",
  "recent-changes": "recentChanges",
  "status-sources": "statusSources",
  diagnostics: "diagnostics",
  runtime: "runtime",
  onboarding: "onboarding",
  [WORKFLOW_VIEW_IDS.newProject]: WORKFLOW_VIEW_IDS.newProject,
  [WORKFLOW_VIEW_IDS.existingProject]: WORKFLOW_VIEW_IDS.existingProject,
  [WORKFLOW_VIEW_IDS.gptAssist]: WORKFLOW_VIEW_IDS.gptAssist
};

export const DIAGRAM_VIEW_IDS = new Set([
  "project-panorama",
  "module-dependency",
  "version-slice",
  "game-loop"
]);

export const PENDING_REVIEW_STORAGE_KEY = "codex-control.pending-review.dismissed";

export function buildFallbackNavigation() {
  return [
    {
      id: "entry-workflows",
      label: "接入与整理入口",
      items: [
        { id: WORKFLOW_VIEW_IDS.newProject, label: WORKFLOW_LABELS[WORKFLOW_VIEW_IDS.newProject] },
        { id: WORKFLOW_VIEW_IDS.existingProject, label: WORKFLOW_LABELS[WORKFLOW_VIEW_IDS.existingProject] },
        { id: WORKFLOW_VIEW_IDS.gptAssist, label: WORKFLOW_LABELS[WORKFLOW_VIEW_IDS.gptAssist] }
      ]
    },
    {
      id: "execution-evidence",
      label: "全局视图",
      items: [
        { id: "onboarding", label: "接入与运行" },
        { id: "runtime", label: "运行环境" },
        { id: "diagnostics", label: "接入诊断" },
        { id: "status-sources", label: "状态来源说明" }
      ]
    }
  ];
}

export function isDiagramView(viewId) {
  return DIAGRAM_VIEW_IDS.has(viewId);
}

export function resolveViewKey(viewId) {
  return VIEW_KEY_BY_ID[viewId] || null;
}
