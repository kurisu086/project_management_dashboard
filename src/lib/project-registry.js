const fs = require("node:fs/promises");
const path = require("node:path");
const {
  APP_ROOT,
  CACHE_DIR,
  REGISTRY_FILE,
  SCHEMA_VERSION
} = require("./constants");
const {
  ensureDir,
  fileExists,
  readJsonIfExists,
  writeJsonAtomic
} = require("./fs-utils");

async function loadRegistry() {
  const registry = await readJsonIfExists(REGISTRY_FILE);
  if (!registry || !Array.isArray(registry.projects)) {
    return recoverRegistryFromCache();
  }

  if (registry.projects.length === 0) {
    const recoveredRegistry = await recoverRegistryFromCache();
    if (recoveredRegistry.projects.length > 0) {
      return recoveredRegistry;
    }
  }

  return registry;
}

async function recoverRegistryFromCache() {
  const recoveredProjects = await collectRecoverableProjectsFromCache();
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: recoveredProjects
  };
}

async function collectRecoverableProjectsFromCache() {
  try {
    const cacheEntries = await fs.readdir(CACHE_DIR, { withFileTypes: true });
    const projects = [];

    for (const entry of cacheEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const currentStatePath = path.join(CACHE_DIR, entry.name, "current_state.json");
      const snapshot = await readJsonIfExists(currentStatePath);
      const project = snapshot?.project;
      if (!project?.id || !project?.name || !project?.rootPath) {
        continue;
      }

      if (isTemporaryProjectPath(project.rootPath)) {
        continue;
      }

      if (!(await fileExists(project.rootPath))) {
        continue;
      }

      if (!(await fileExists(path.join(project.rootPath, ".git")))) {
        continue;
      }

      projects.push({
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        addedAt: snapshot.generatedAt || new Date().toISOString()
      });
    }

    projects.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
    return projects;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isTemporaryProjectPath(projectPath) {
  const normalizedRoot = path.normalize(APP_ROOT).toLowerCase();
  const normalizedProjectPath = path.normalize(projectPath).toLowerCase();
  const tempRoot = path.join(normalizedRoot, "tmp");
  return normalizedProjectPath === tempRoot || normalizedProjectPath.startsWith(`${tempRoot}${path.sep}`);
}

async function saveRegistry(registry) {
  await ensureDir(path.dirname(REGISTRY_FILE));
  await writeJsonAtomic(REGISTRY_FILE, registry);
}

function upsertRegistryProject(registry, projectRecord) {
  const existingIndex = registry.projects.findIndex((entry) => entry.id === projectRecord.id);
  if (existingIndex === -1) {
    registry.projects.push(projectRecord);
    return;
  }

  registry.projects[existingIndex] = {
    ...registry.projects[existingIndex],
    ...projectRecord
  };
}

function removeRegistryProject(registry, projectId) {
  registry.projects = registry.projects.filter((entry) => entry.id !== projectId);
}

function sortRegistry(registry) {
  registry.projects.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

module.exports = {
  loadRegistry,
  removeRegistryProject,
  saveRegistry,
  sortRegistry,
  upsertRegistryProject
};
