const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  determineOnboardingMode,
  buildSuperpowersScaffoldOwnership,
  collectDashboardOwnedSuperpowersPaths
} = require("./superpowers-onboarding");

test("determineOnboardingMode returns superpowers when dashboard enables useSuperpowers", () => {
  assert.equal(
    determineOnboardingMode({ useSuperpowers: true }),
    "superpowers"
  );
  assert.equal(
    determineOnboardingMode({ useSuperpowers: false }),
    "standard"
  );
});

test("buildSuperpowersScaffoldOwnership marks dashboard-created docs paths", () => {
  const result = buildSuperpowersScaffoldOwnership({
    docsReadmeCreated: true,
    specsPlaceholderCreated: true,
    plansPlaceholderCreated: false
  });

  assert.equal(result.docsReadmeCreated, true);
  assert.equal(result.specsPlaceholderCreated, true);
  assert.equal(result.plansPlaceholderCreated, false);
});

test("collectDashboardOwnedSuperpowersPaths returns only owned docs files", () => {
  const result = collectDashboardOwnedSuperpowersPaths("D:\\repo\\demo", {
    docsReadmeCreated: true,
    specsPlaceholderCreated: true,
    plansPlaceholderCreated: false
  });

  assert.deepEqual(result, [
    path.join("D:\\repo\\demo", "docs", "superpowers", "README.md"),
    path.join("D:\\repo\\demo", "docs", "superpowers", "specs", ".gitkeep")
  ]);
});
