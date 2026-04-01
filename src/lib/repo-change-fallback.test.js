const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createGitFixtureRepo,
  writeWorkingTreeChange
} = require("../../scripts/test-helpers/git-fixture");
const { collectRepoChangeFallback } = require("./repo-change-fallback");

async function createTempRepo(name, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `repo-change-fallback-${name}-`));
  const repoPath = path.join(root, name);
  await createGitFixtureRepo(repoPath, files);
  return { root, repoPath };
}

test("collectRepoChangeFallback returns commit metadata for a clean repo", async () => {
  const { root, repoPath } = await createTempRepo("clean", {
    "README.md": "# Clean fixture\n",
    "src/index.js": "module.exports = { value: 1 };\n"
  });

  try {
    const result = await collectRepoChangeFallback(repoPath);

    assert.equal(result.workingTreeDirty, false);
    assert.equal(result.hasRepoVisibleChanges, false);
    assert.ok(result.latestCommitHash, "latest commit hash should be present");
    assert.match(result.latestCommitSummary, /seed fixture/i);
    assert.ok(result.latestCommitAt, "latest commit timestamp should be present");
    assert.ok(result.latestRepoVisibleUpdateAt, "latest repo-visible update timestamp should be present");
    assert.deepEqual(result.changedFiles, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("collectRepoChangeFallback reports a dirty tracked file as repo-visible change", async () => {
  const { root, repoPath } = await createTempRepo("dirty", {
    "README.md": "# Dirty fixture\n",
    "src/index.js": "module.exports = { value: 1 };\n"
  });

  try {
    await writeWorkingTreeChange(repoPath, "src/index.js", "module.exports = { value: 2 };\n");

    const result = await collectRepoChangeFallback(repoPath);

    assert.equal(result.workingTreeDirty, true);
    assert.equal(result.hasRepoVisibleChanges, true);
    assert.ok(result.latestRepoVisibleUpdateAt, "latest repo-visible update timestamp should be present");
    assert.ok(Array.isArray(result.changedFiles));
    assert.equal(result.changedFiles[0].path, "src/index.js");
    assert.ok(result.changedFiles[0].status, "changed file status should be present");
    assert.ok(result.changedFiles[0].updatedAt, "changed file update timestamp should be present");
    assert.match(result.fallbackRepoChangeSummary, /working tree/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
