const path = require("node:path");
const {
  ensureDir,
  fileExists,
  writeTextAtomic
} = require("./fs-utils");

const DASHBOARD_SUPERPOWERS_README = [
  "# Dashboard-managed Superpowers Entry",
  "",
  "This minimal scaffold was created by the dashboard because Superpowers onboarding is enabled for this repo.",
  "Use `docs/superpowers/specs/` for approved designs and `docs/superpowers/plans/` for implementation plans before boundary-changing work."
].join("\n");

function determineOnboardingMode(input = {}) {
  return input.useSuperpowers ? "superpowers" : "standard";
}

function buildSuperpowersScaffoldOwnership(flags = {}) {
  return {
    docsReadmeCreated: Boolean(flags.docsReadmeCreated),
    specsPlaceholderCreated: Boolean(flags.specsPlaceholderCreated),
    plansPlaceholderCreated: Boolean(flags.plansPlaceholderCreated)
  };
}

function mergeSuperpowersScaffoldOwnership(...items) {
  return items.reduce((merged, item) => ({
    docsReadmeCreated: merged.docsReadmeCreated || Boolean(item && item.docsReadmeCreated),
    specsPlaceholderCreated: merged.specsPlaceholderCreated || Boolean(item && item.specsPlaceholderCreated),
    plansPlaceholderCreated: merged.plansPlaceholderCreated || Boolean(item && item.plansPlaceholderCreated)
  }), buildSuperpowersScaffoldOwnership({}));
}

async function ensureDashboardOwnedSuperpowersScaffold(projectRoot) {
  const docsDir = path.join(projectRoot, "docs", "superpowers");
  const specsDir = path.join(docsDir, "specs");
  const plansDir = path.join(docsDir, "plans");
  const readmePath = path.join(docsDir, "README.md");
  const specsKeepPath = path.join(specsDir, ".gitkeep");
  const plansKeepPath = path.join(plansDir, ".gitkeep");
  const ownership = buildSuperpowersScaffoldOwnership({});

  await ensureDir(specsDir);
  await ensureDir(plansDir);

  if (!(await fileExists(readmePath))) {
    await writeTextAtomic(readmePath, `${DASHBOARD_SUPERPOWERS_README}\n`);
    ownership.docsReadmeCreated = true;
  }

  if (!(await fileExists(specsKeepPath))) {
    await writeTextAtomic(specsKeepPath, "");
    ownership.specsPlaceholderCreated = true;
  }

  if (!(await fileExists(plansKeepPath))) {
    await writeTextAtomic(plansKeepPath, "");
    ownership.plansPlaceholderCreated = true;
  }

  return ownership;
}

function collectDashboardOwnedSuperpowersPaths(projectRoot, ownership = {}) {
  const results = [];
  if (ownership.docsReadmeCreated) {
    results.push(path.join(projectRoot, "docs", "superpowers", "README.md"));
  }
  if (ownership.specsPlaceholderCreated) {
    results.push(path.join(projectRoot, "docs", "superpowers", "specs", ".gitkeep"));
  }
  if (ownership.plansPlaceholderCreated) {
    results.push(path.join(projectRoot, "docs", "superpowers", "plans", ".gitkeep"));
  }
  return results;
}

module.exports = {
  determineOnboardingMode,
  buildSuperpowersScaffoldOwnership,
  ensureDashboardOwnedSuperpowersScaffold,
  mergeSuperpowersScaffoldOwnership,
  collectDashboardOwnedSuperpowersPaths
};
