const path = require("node:path");

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
  collectDashboardOwnedSuperpowersPaths
};
