const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const EMPTY_REPO_CHANGE_FALLBACK = {
  latestCommitHash: null,
  latestCommitSummary: null,
  latestCommitTimestamp: null,
  latestRepoVisibleUpdateAt: null,
  hasRepoVisibleChanges: false,
  workingTreeDirty: false,
  changedFiles: [],
  fallbackRepoChangeSummary: "No repo-visible fallback evidence is available."
};

async function collectRepoChangeFallback(projectRoot) {
  const gitPath = path.join(projectRoot, ".git");
  if (!(await gitExists(gitPath))) {
    return { ...EMPTY_REPO_CHANGE_FALLBACK, changedFiles: [] };
  }

  const latestCommit = readLatestCommit(projectRoot);
  if (!latestCommit) {
    return { ...EMPTY_REPO_CHANGE_FALLBACK, changedFiles: [] };
  }

  const changedFiles = await collectChangedFiles(projectRoot);
  const workingTreeDirty = changedFiles.length > 0;
  const latestRepoVisibleUpdateAt = computeLatestRepoVisibleUpdateAt(latestCommit.timestamp, changedFiles);

  return {
    latestCommitHash: latestCommit.hash,
    latestCommitSummary: latestCommit.summary,
    latestCommitTimestamp: latestCommit.timestamp,
    latestRepoVisibleUpdateAt,
    hasRepoVisibleChanges: workingTreeDirty,
    workingTreeDirty,
    changedFiles: changedFiles.slice(0, 8),
    fallbackRepoChangeSummary: buildFallbackRepoChangeSummary(latestCommit.summary, workingTreeDirty)
  };
}

async function gitExists(gitPath) {
  try {
    const stat = await fs.stat(gitPath);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

function readLatestCommit(projectRoot) {
  const output = runGit(["log", "-1", "--format=%H%n%s%n%cI", "HEAD"], projectRoot);
  if (!output) {
    return null;
  }

  const [hash, summary = "", timestamp = ""] = output.split(/\r?\n/);
  if (!hash || !timestamp) {
    return null;
  }

  return {
    hash,
    summary,
    timestamp
  };
}

async function collectChangedFiles(projectRoot) {
  const output = runGit(["status", "--porcelain=v1", "--untracked-files=normal"], projectRoot);
  if (!output) {
    return [];
  }

  const entries = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const entry = await parseStatusLine(projectRoot, line);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries.filter(Boolean).sort((left, right) => left.path.localeCompare(right.path));
}

async function parseStatusLine(projectRoot, line) {
  const status = line.slice(0, 2).trim() || line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const pathValue = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
  if (!pathValue) {
    return null;
  }

  const filePath = path.join(projectRoot, pathValue);
  const updatedAt = (await fileExists(filePath))
    ? (await fs.stat(filePath)).mtime.toISOString()
    : null;

  return {
    path: pathValue,
    status,
    updatedAt
  };
}

function computeLatestRepoVisibleUpdateAt(latestCommitTimestamp, changedFiles) {
  const timestamps = [latestCommitTimestamp];
  for (const item of changedFiles) {
    if (item.updatedAt) {
      timestamps.push(item.updatedAt);
    }
  }

  const validTimes = timestamps
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (!validTimes.length) {
    return null;
  }

  return new Date(Math.max(...validTimes)).toISOString();
}

function buildFallbackRepoChangeSummary(latestCommitSummary, workingTreeDirty) {
  if (!workingTreeDirty) {
    return `Latest commit "${latestCommitSummary}" with clean working tree.`;
  }

  return `Latest commit "${latestCommitSummary}" with working tree dirty.`;
}

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

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  collectRepoChangeFallback
};
