const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_FIXTURE_FILES = {
  "README.md": "# Fixture Repo\n"
};

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });

  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${formatGitFailure(result)}`);
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${formatGitFailure(result)}`);
  }

  return (result.stdout || "").trim();
}

function formatGitFailure(result) {
  const details = [
    result.error?.message,
    result.stderr,
    result.stdout
  ]
    .map((value) => value && value.trim())
    .filter(Boolean);

  return details.join("\n") || "Unknown git failure.";
}

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
  }
}

async function createGitFixtureRepo(repoPath, files = DEFAULT_FIXTURE_FILES) {
  await fs.mkdir(repoPath, { recursive: true });
  runGit(["init"], repoPath);
  runGit(["config", "user.name", "Codex Fixture"], repoPath);
  runGit(["config", "user.email", "fixture@example.com"], repoPath);
  await writeFiles(repoPath, files);
  runGit(["add", "-A"], repoPath);
  runGit(["commit", "-m", "chore: seed fixture"], repoPath);
}

async function commitFileChange(repoPath, relativePath, content, message) {
  await writeFiles(repoPath, { [relativePath]: content });
  runGit(["add", relativePath], repoPath);
  runGit(["commit", "-m", message], repoPath);
}

async function writeWorkingTreeChange(repoPath, relativePath, content) {
  await writeFiles(repoPath, { [relativePath]: content });
}

module.exports = {
  createGitFixtureRepo,
  commitFileChange,
  writeWorkingTreeChange
};
