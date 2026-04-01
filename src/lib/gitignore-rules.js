const {
  LOCAL_SKILL_NAMES,
  CONTROL_GITIGNORE_END,
  CONTROL_GITIGNORE_START
} = require("./constants");

function buildControlGitignoreBlock() {
  return [
    CONTROL_GITIGNORE_START,
    ".codex-control/",
    ...LOCAL_SKILL_NAMES.map((name) => `.agents/skills/${name}/`),
    CONTROL_GITIGNORE_END
  ].join("\n");
}

function upsertControlGitignore(existingText) {
  const block = buildControlGitignoreBlock();
  const pattern = new RegExp(
    `${escapeRegExp(CONTROL_GITIGNORE_START)}[\\s\\S]*?${escapeRegExp(CONTROL_GITIGNORE_END)}`,
    "m"
  );

  if (!existingText || !existingText.trim()) {
    return `${block}\n`;
  }

  if (pattern.test(existingText)) {
    return `${existingText.replace(pattern, block).trimEnd()}\n`;
  }

  return `${existingText.trimEnd()}\n\n${block}\n`;
}

function removeControlGitignore(existingText) {
  if (!existingText) {
    return "";
  }

  const pattern = new RegExp(
    `\\n?${escapeRegExp(CONTROL_GITIGNORE_START)}[\\s\\S]*?${escapeRegExp(CONTROL_GITIGNORE_END)}\\n?`,
    "m"
  );

  return existingText
    .replace(pattern, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  buildControlGitignoreBlock,
  removeControlGitignore,
  upsertControlGitignore
};
