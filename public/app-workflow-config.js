export const WORKFLOW_VIEW_IDS = {
  newProject: "new-project-filing",
  existingProject: "existing-project-recovery",
  gptAssist: "gpt-assist"
};

export const WORKFLOW_LABELS = {
  [WORKFLOW_VIEW_IDS.newProject]: "新项目建档",
  [WORKFLOW_VIEW_IDS.existingProject]: "已有项目建档",
  [WORKFLOW_VIEW_IDS.gptAssist]: "GPT 辅助整理"
};

export const SUPERPOWERS_OPTIONS = [
  ["false", "否"],
  ["true", "是，后续开发严格按 Superpowers 流程执行"]
];

export function getWorkflowLabel(viewId, fallbackLabel = "") {
  return WORKFLOW_LABELS[viewId] || fallbackLabel;
}
