const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const { formatTimestamp } = require("./fs-utils");

async function collectRepoChangeFallback(projectRoot) {
  const gitDir = await resolveGitDir(projectRoot);
  if (!gitDir) {
    return {};
  }

  const headHash = await readHeadHash(gitDir);
  if (!headHash) {
    return {};
  }

  const commitObject = await readCommitObject(gitDir, headHash);
  if (!commitObject) {
    return {};
  }

  const trackedFiles = await readTreeEntries(gitDir, commitObject.treeHash);
  const workingTreeEntries = await scanWorkingTree(projectRoot);
  const workingTreeMap = new Map(workingTreeEntries.map((entry) => [entry.path, entry]));

  const changedFiles = [];
  for (const [relativePath, trackedHash] of trackedFiles.entries()) {
    const workingTreeEntry = workingTreeMap.get(relativePath);
    if (!workingTreeEntry) {
      changedFiles.push({
        path: relativePath,
        status: "D",
        updatedAt: null
      });
      continue;
    }

    const currentHash = await hashFileObject(workingTreeEntry.absolutePath);
    if (currentHash !== trackedHash) {
      changedFiles.push({
        path: relativePath,
        status: "M",
        updatedAt: workingTreeEntry.updatedAt
      });
    }
  }

  for (const workingTreeEntry of workingTreeEntries) {
    if (!trackedFiles.has(workingTreeEntry.path)) {
      changedFiles.push({
        path: workingTreeEntry.path,
        status: "??",
        updatedAt: workingTreeEntry.updatedAt
      });
    }
  }

  changedFiles.sort((left, right) => left.path.localeCompare(right.path));
  const cappedChangedFiles = changedFiles.slice(0, 8);
  const workingTreeDirty = changedFiles.length > 0;
  const latestRepoVisibleUpdateAt = computeLatestRepoVisibleUpdateAt([
    commitObject.committedAt,
    ...changedFiles.map((entry) => entry.updatedAt).filter(Boolean)
  ]);

  return {
    latestCommitHash: headHash,
    latestCommitSummary: commitObject.summary,
    latestCommitAt: commitObject.committedAt,
    latestRepoVisibleUpdateAt,
    hasRepoVisibleChanges: workingTreeDirty,
    workingTreeDirty,
    changedFiles: cappedChangedFiles,
    fallbackRepoChangeSummary: buildFallbackRepoChangeSummary(commitObject.summary, workingTreeDirty, cappedChangedFiles)
  };
}

async function resolveGitDir(projectRoot) {
  const gitPath = path.join(projectRoot, ".git");
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }

    if (stat.isFile()) {
      const raw = await fs.readFile(gitPath, "utf8");
      const match = raw.match(/^gitdir:\s*(.+)$/m);
      if (!match) {
        return null;
      }
      return path.resolve(projectRoot, match[1].trim());
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  return null;
}

async function readHeadHash(gitDir) {
  const headPath = path.join(gitDir, "HEAD");
  const headText = await fs.readFile(headPath, "utf8");
  const trimmed = headText.trim();
  if (trimmed.startsWith("ref:")) {
    const refPath = path.join(gitDir, trimmed.slice(4).trim());
    return (await fs.readFile(refPath, "utf8")).trim();
  }
  return trimmed || null;
}

async function readCommitObject(gitDir, commitHash) {
  const raw = await readGitObject(gitDir, commitHash);
  if (!raw || raw.type !== "commit") {
    return null;
  }

  const text = raw.body.toString("utf8");
  const separatorIndex = text.indexOf("\n\n");
  const headerText = separatorIndex === -1 ? text : text.slice(0, separatorIndex);
  const messageText = separatorIndex === -1 ? "" : text.slice(separatorIndex + 2);
  const headerLines = headerText.split("\n");

  const treeLine = headerLines.find((line) => line.startsWith("tree "));
  const committerLine = headerLines.find((line) => line.startsWith("committer "));
  const treeHash = treeLine ? treeLine.slice(5).trim() : null;
  const committedAt = parseGitTimestamp(committerLine) || null;
  const summary = messageText.split("\n").find((line) => line.trim()) || "";

  if (!treeHash || !committedAt) {
    return null;
  }

  return {
    treeHash,
    committedAt,
    summary
  };
}

async function readTreeEntries(gitDir, treeHash, prefix = "") {
  const raw = await readGitObject(gitDir, treeHash);
  if (!raw || raw.type !== "tree") {
    return new Map();
  }

  const entries = new Map();
  let offset = 0;

  while (offset < raw.body.length) {
    const spaceIndex = raw.body.indexOf(0x20, offset);
    const mode = raw.body.toString("utf8", offset, spaceIndex);
    const nulIndex = raw.body.indexOf(0x00, spaceIndex + 1);
    const name = raw.body.toString("utf8", spaceIndex + 1, nulIndex);
    const hash = raw.body.subarray(nulIndex + 1, nulIndex + 21).toString("hex");
    const relativePath = prefix ? `${prefix}/${name}` : name;
    offset = nulIndex + 21;

    if (mode === "40000") {
      const nestedEntries = await readTreeEntries(gitDir, hash, relativePath);
      for (const [nestedPath, nestedHash] of nestedEntries.entries()) {
        entries.set(nestedPath, nestedHash);
      }
      continue;
    }

    entries.set(relativePath, hash);
  }

  return entries;
}

async function readGitObject(gitDir, objectHash) {
  const objectPath = path.join(gitDir, "objects", objectHash.slice(0, 2), objectHash.slice(2));
  let compressed;
  try {
    compressed = await fs.readFile(objectPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const raw = zlib.inflateSync(compressed);
  const nulIndex = raw.indexOf(0x00);
  const header = raw.toString("utf8", 0, nulIndex);
  const [type, sizeText] = header.split(" ");
  const size = Number(sizeText);
  return {
    type,
    size,
    body: raw.subarray(nulIndex + 1)
  };
}

async function scanWorkingTree(projectRoot) {
  const results = [];
  await walkWorkingTree(projectRoot, results);
  results.sort((left, right) => left.path.localeCompare(right.path));
  return results;
}

async function walkWorkingTree(currentPath, results, relativePrefix = "") {
  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await walkWorkingTree(absolutePath, results, relativePath);
      continue;
    }

    if (entry.isFile()) {
      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch (error) {
        if (error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
      results.push({
        path: relativePath,
        absolutePath,
        updatedAt: formatTimestamp(stat.mtime)
      });
    }
  }
}

async function hashFileObject(filePath) {
  const content = await fs.readFile(filePath);
  const header = Buffer.from(`blob ${content.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, content])).digest("hex");
}

function parseGitTimestamp(committerLine) {
  if (!committerLine) {
    return null;
  }

  const match = committerLine.match(/^(?:committer)\s+.+?\s+(\d+)\s+[+-]\d{4}$/);
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]) * 1000).toISOString();
}

function computeLatestRepoVisibleUpdateAt(timestamps) {
  const values = timestamps.filter(Boolean).map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return new Date(Math.max(...values)).toISOString();
}

function buildFallbackRepoChangeSummary(latestCommitSummary, workingTreeDirty, changedFiles) {
  if (!workingTreeDirty) {
    return `Latest commit "${latestCommitSummary}" with clean working tree.`;
  }

  const firstChangedFile = changedFiles[0]?.path || "working tree";
  return `Latest commit "${latestCommitSummary}" with working tree dirty; first change at ${firstChangedFile}.`;
}

module.exports = {
  collectRepoChangeFallback
};
