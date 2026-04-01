const fs = require("node:fs/promises");
const path = require("node:path");
const {
  AGENTS_DIR_NAME,
  AGENTS_FILE_NAME,
  CACHE_DIR,
  CONTROL_DIR_NAME,
  DOCS_DIR_NAME,
  GITIGNORE_FILE_NAME,
  META_DIR_NAME,
  PROJECT_CONFIG_FILE_NAME,
  SKILLS_DIR_NAME,
  SUPERPOWERS_DIR_NAME,
  SUPERPOWERS_PLANS_DIR_NAME,
  SUPERPOWERS_SPECS_DIR_NAME
} = require("./constants");
const {
  readJsonIfExists
} = require("./fs-utils");
const {
  removeControlRules
} = require("./agents-rules");
const {
  removeControlGitignore
} = require("./gitignore-rules");
const {
  getRepoLocalSkillPaths
} = require("./repo-skill-templates");
const {
  collectDashboardOwnedSuperpowersPaths
} = require("./superpowers-onboarding");

async function cleanupProjectControlFiles(projectRecord, options = {}) {
  const removedRepoArtifacts = [];
  const removedLocalArtifacts = [];
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const agentsPath = path.join(projectRecord.rootPath, AGENTS_FILE_NAME);
  const gitignorePath = path.join(projectRecord.rootPath, GITIGNORE_FILE_NAME);
  const projectConfigPath = path.join(controlDir, META_DIR_NAME, PROJECT_CONFIG_FILE_NAME);
  const cacheDir = options.cacheDir || path.join(CACHE_DIR, projectRecord.id);
  const localSkills = getRepoLocalSkillPaths(projectRecord.rootPath);
  const projectConfig = await readJsonIfExists(projectConfigPath);
  const ownedSuperpowersPaths = collectDashboardOwnedSuperpowersPaths(
    projectRecord.rootPath,
    projectConfig?.dashboardOwnedSuperpowers || {}
  );

  await cleanupAgentsFile(agentsPath, removedRepoArtifacts);
  await cleanupGitignoreFile(gitignorePath, removedRepoArtifacts);
  await removePathIfPresent(controlDir, removedRepoArtifacts, "control_dir_deleted", { recursive: true });
  await removeRepoLocalSkills(localSkills, removedRepoArtifacts);
  await removeEmptyRepoSkillParents(projectRecord.rootPath, removedRepoArtifacts);
  await cleanupDashboardOwnedSuperpowersFiles(projectRecord.rootPath, ownedSuperpowersPaths, removedRepoArtifacts);
  await removePathIfPresent(cacheDir, removedLocalArtifacts, "cache_deleted", { recursive: true });

  return {
    removedRepoArtifacts,
    removedLocalArtifacts
  };
}

async function cleanupAgentsFile(agentsPath, removedRepoArtifacts) {
  const agentsText = await fs.readFile(agentsPath, "utf8").catch(() => null);
  if (agentsText === null) {
    return;
  }

  const nextAgents = removeControlRules(agentsText);
  if (nextAgents === agentsText.trim()) {
    return;
  }

  if (nextAgents) {
    await fs.writeFile(agentsPath, `${nextAgents}\n`, "utf8");
    removedRepoArtifacts.push({
      path: agentsPath,
      action: "rules_block_removed"
    });
    return;
  }

  await fs.rm(agentsPath, { force: true });
  removedRepoArtifacts.push({
    path: agentsPath,
    action: "empty_agents_deleted"
  });
}

async function cleanupGitignoreFile(gitignorePath, removedRepoArtifacts) {
  const gitignoreText = await fs.readFile(gitignorePath, "utf8").catch(() => null);
  if (gitignoreText === null) {
    return;
  }

  const nextGitignore = removeControlGitignore(gitignoreText);
  if (nextGitignore === gitignoreText.trim()) {
    return;
  }

  if (nextGitignore) {
    await fs.writeFile(gitignorePath, `${nextGitignore}\n`, "utf8");
    removedRepoArtifacts.push({
      path: gitignorePath,
      action: "gitignore_control_block_removed"
    });
    return;
  }

  await fs.rm(gitignorePath, { force: true });
  removedRepoArtifacts.push({
    path: gitignorePath,
    action: "empty_gitignore_deleted"
  });
}

async function removeRepoLocalSkills(localSkills, removedRepoArtifacts) {
  for (const skill of localSkills) {
    await removePathIfPresent(skill.rootDir, removedRepoArtifacts, "local_skill_deleted", {
      recursive: true
    });
  }
}

async function cleanupDashboardOwnedSuperpowersFiles(projectRoot, ownedSuperpowersPaths, removedRepoArtifacts) {
  for (const ownedPath of ownedSuperpowersPaths) {
    await removePathIfPresent(ownedPath, removedRepoArtifacts, "dashboard_owned_superpowers_file_deleted");
  }

  const superpowersRoot = path.join(projectRoot, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME);
  await removeEmptyIfExists(path.join(superpowersRoot, SUPERPOWERS_SPECS_DIR_NAME), removedRepoArtifacts);
  await removeEmptyIfExists(path.join(superpowersRoot, SUPERPOWERS_PLANS_DIR_NAME), removedRepoArtifacts);
  await removeEmptyIfExists(superpowersRoot, removedRepoArtifacts);
  await removeEmptyIfExists(path.join(projectRoot, DOCS_DIR_NAME), removedRepoArtifacts);
}

async function removeEmptyRepoSkillParents(projectRoot, removedRepoArtifacts) {
  const skillsDir = path.join(projectRoot, AGENTS_DIR_NAME, SKILLS_DIR_NAME);
  const agentsDir = path.join(projectRoot, AGENTS_DIR_NAME);

  await removeEmptyIfExists(skillsDir, removedRepoArtifacts, "empty_skills_dir_deleted");
  await removeEmptyIfExists(agentsDir, removedRepoArtifacts, "empty_agents_dir_deleted");
}

async function removeEmptyIfExists(targetPath, removedArtifacts, action = "dashboard_owned_superpowers_dir_deleted") {
  if (!(await isDirEmpty(targetPath))) {
    return false;
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  removedArtifacts.push({
    path: targetPath,
    action
  });
  return true;
}

async function removePathIfPresent(targetPath, removedArtifacts, action, options = {}) {
  if (!(await pathExists(targetPath))) {
    return false;
  }

  await fs.rm(targetPath, {
    force: true,
    recursive: Boolean(options.recursive)
  });
  removedArtifacts.push({
    path: targetPath,
    action
  });
  return true;
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirEmpty(targetPath) {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

module.exports = {
  cleanupProjectControlFiles
};
