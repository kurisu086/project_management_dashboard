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

const GIT_FIXTURE_MODULE_PATH = "../../scripts/test-helpers/git-fixture";
const REPO_CHANGE_FALLBACK_MODULE_PATH = "./repo-change-fallback";

async function createTempRepo(name, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `repo-change-fallback-${name}-`));
  const repoPath = path.join(root, name);
  await createGitFixtureRepo(repoPath, files);
  return { root, repoPath };
}

async function withMockedSpawnSync(mockSpawnSync, callback) {
  const childProcess = require("node:child_process");
  const originalSpawnSync = childProcess.spawnSync;

  childProcess.spawnSync = mockSpawnSync;
  delete require.cache[require.resolve(GIT_FIXTURE_MODULE_PATH)];
  delete require.cache[require.resolve(REPO_CHANGE_FALLBACK_MODULE_PATH)];

  try {
    return await callback({
      gitFixture: require(GIT_FIXTURE_MODULE_PATH),
      repoChangeFallback: require(REPO_CHANGE_FALLBACK_MODULE_PATH)
    });
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    delete require.cache[require.resolve(GIT_FIXTURE_MODULE_PATH)];
    delete require.cache[require.resolve(REPO_CHANGE_FALLBACK_MODULE_PATH)];
  }
}

function createGitSpawnErrorResult() {
  return {
    status: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error("spawnSync git EPERM"), {
      code: "EPERM",
      errno: -4048,
      path: "git",
      syscall: "spawnSync git"
    })
  };
}

test("collectRepoChangeFallback returns an empty fallback shape when .git is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-change-fallback-empty-"));

  try {
    const result = await collectRepoChangeFallback(root);

    assert.deepEqual(result, {
      latestCommitHash: null,
      latestCommitSummary: null,
      latestCommitTimestamp: null,
      latestRepoVisibleUpdateAt: null,
      hasRepoVisibleChanges: false,
      workingTreeDirty: false,
      changedFiles: [],
      fallbackRepoChangeSummary: "No repo-visible fallback evidence is available."
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("createGitFixtureRepo includes spawnSync git errors in fixture setup failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-change-fallback-fixture-error-"));

  try {
    await assert.rejects(
      withMockedSpawnSync(() => createGitSpawnErrorResult(), async ({ gitFixture }) => {
        await gitFixture.createGitFixtureRepo(path.join(root, "fixture"));
      }),
      /spawnSync git EPERM/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("collectRepoChangeFallback includes spawnSync git errors in fallback failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-change-fallback-git-error-"));

  try {
    await fs.mkdir(path.join(root, ".git"), { recursive: true });

    await assert.rejects(
      withMockedSpawnSync(() => createGitSpawnErrorResult(), async ({ repoChangeFallback }) => {
        await repoChangeFallback.collectRepoChangeFallback(root);
      }),
      /spawnSync git EPERM/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

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
    assert.ok(result.latestCommitTimestamp, "latest commit timestamp should be present");
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

test("collectRepoChangeFallback ignores dashboard-managed control-plane paths", async () => {
  const { root, repoPath } = await createTempRepo("dashboard-owned", {
    "README.md": "# Dashboard-owned fixture\n",
    "src/index.js": "module.exports = { value: 1 };\n"
  });

  try {
    await writeWorkingTreeChange(repoPath, ".codex-control/project_state.json", "{\n  \"status\": \"draft\"\n}\n");
    await writeWorkingTreeChange(repoPath, ".agents/skills/codex-project-handoff/SKILL.md", "# Skill\n");
    await writeWorkingTreeChange(repoPath, "docs/superpowers/README.md", "# Dashboard-owned\n");
    await writeWorkingTreeChange(repoPath, "AGENTS.md", "Dashboard-managed block\n");
    await writeWorkingTreeChange(repoPath, ".gitignore", ".codex-control/\n");

    const result = await collectRepoChangeFallback(repoPath);

    assert.equal(result.workingTreeDirty, false);
    assert.equal(result.hasRepoVisibleChanges, false);
    assert.deepEqual(result.changedFiles, []);
    assert.match(result.fallbackRepoChangeSummary, /clean working tree/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
