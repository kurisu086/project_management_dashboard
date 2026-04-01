const path = require("node:path");
const {
  AGENTS_FILE_NAME,
  CONTROL_DIR_NAME,
  DECISION_LOG_FILE_NAME,
  DOCS_DIR_NAME,
  GAME_DESIGN_FILE_NAME,
  MODULE_MAP_FILE_NAME,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  RUNS_DIR_NAME,
  SCHEMA_VERSION,
  SUPERPOWERS_DIR_NAME,
  SUPERPOWERS_PLANS_DIR_NAME,
  SUPERPOWERS_SPECS_DIR_NAME,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME,
  WATCH_MANIFEST_FILE_NAME
} = require("./constants");
const {
  getRepoLocalSkillPaths
} = require("./repo-skill-templates");
const {
  buildSuperpowersScaffoldOwnership,
  determineOnboardingMode
} = require("./superpowers-onboarding");

function buildProjectConfig(projectRecord, dashboardOwnedSuperpowers = {}) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const onboardingMode = projectRecord.onboardingMode || determineOnboardingMode(projectRecord);
  const localSkills = getRepoLocalSkillPaths(projectRecord.rootPath);

  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: projectRecord.id,
    name: projectRecord.name,
    rootPath: projectRecord.rootPath,
    controlDir,
    layers: {
      baseline: {
        projectBrief: path.join(controlDir, PROJECT_BRIEF_FILE_NAME),
        moduleMap: path.join(controlDir, MODULE_MAP_FILE_NAME),
        techStack: path.join(controlDir, TECH_STACK_FILE_NAME),
        gameDesign: path.join(controlDir, GAME_DESIGN_FILE_NAME),
        decisionLog: path.join(controlDir, DECISION_LOG_FILE_NAME)
      },
      versionControl: {
        versionState: path.join(controlDir, VERSION_STATE_FILE_NAME)
      },
      execution: {
        projectState: path.join(controlDir, PROJECT_STATE_FILE_NAME),
        runsDir: path.join(controlDir, RUNS_DIR_NAME)
      }
    },
    supplementalSources: {
      superpowersSpecsDir: path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_SPECS_DIR_NAME),
      superpowersPlansDir: path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_PLANS_DIR_NAME)
    },
    workflow: {
      useSuperpowers: onboardingMode === "superpowers",
      onboardingMode
    },
    dashboardOwnedSuperpowers: buildSuperpowersScaffoldOwnership(dashboardOwnedSuperpowers),
    localSkills: localSkills.map((item) => ({
      name: item.name,
      rootDir: item.rootDir,
      files: item.files
    })),
    boundary: {
      repoRole: "source-state-only",
      derivedArtifacts: "dashboard-local-cache-only"
    }
  };
}

function buildWatchManifest(projectRecord) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: "repo-source-only",
    watchTargets: [
      path.join(projectRecord.rootPath, AGENTS_FILE_NAME),
      path.join(controlDir, PROJECT_STATE_FILE_NAME),
      path.join(controlDir, PROJECT_BRIEF_FILE_NAME),
      path.join(controlDir, MODULE_MAP_FILE_NAME),
      path.join(controlDir, TECH_STACK_FILE_NAME),
      path.join(controlDir, GAME_DESIGN_FILE_NAME),
      path.join(controlDir, VERSION_STATE_FILE_NAME),
      path.join(controlDir, DECISION_LOG_FILE_NAME),
      path.join(controlDir, RUNS_DIR_NAME, "*.json"),
      path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_SPECS_DIR_NAME),
      path.join(projectRecord.rootPath, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME, SUPERPOWERS_PLANS_DIR_NAME)
    ],
    note: "Steady-state aggregation only reads AGENTS.md, .codex-control/**, and optional docs/superpowers/specs|plans. Repo-local skills live under .agents/skills/** but are not watched as project state. Derived current_state artifacts are generated under the dashboard local cache."
  };
}

module.exports = {
  buildProjectConfig,
  buildWatchManifest
};
