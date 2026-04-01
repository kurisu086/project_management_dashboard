const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const DEFAULT_FIXTURE_FILES = {
  "README.md": "# Fixture Repo\n"
};

async function createGitFixtureRepo(repoPath, files = DEFAULT_FIXTURE_FILES) {
  await fs.mkdir(repoPath, { recursive: true });
  await ensureGitDirectories(repoPath);
  await writeFiles(repoPath, files);
  await commitSnapshot(repoPath, "chore: seed fixture");
}

async function commitFileChange(repoPath, relativePath, content, message) {
  await writeFiles(repoPath, { [relativePath]: content });
  await commitSnapshot(repoPath, message);
}

async function writeWorkingTreeChange(repoPath, relativePath, content) {
  await writeFiles(repoPath, { [relativePath]: content });
}

async function ensureGitDirectories(repoPath) {
  await fs.mkdir(path.join(repoPath, ".git", "objects"), { recursive: true });
  await fs.mkdir(path.join(repoPath, ".git", "refs", "heads"), { recursive: true });
  await fs.writeFile(path.join(repoPath, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await fs.writeFile(
    path.join(repoPath, ".git", "config"),
    [
      "[core]",
      "\trepositoryformatversion = 0",
      "\tfilemode = false",
      "\tbare = false",
      "[user]",
      "\tname = Codex Fixture",
      "\temail = fixture@example.com"
    ].join("\n") + "\n",
    "utf8"
  );
}

async function commitSnapshot(repoPath, message) {
  const now = Math.floor(Date.now() / 1000);
  const trackedFiles = await listWorkingTreeFiles(repoPath);
  const treeHash = await writeTreeFromWorkingTree(repoPath, trackedFiles);
  const parentHash = await readHeadHash(repoPath);
  const commitHash = await writeCommitObject(repoPath, {
    treeHash,
    parentHash,
    message,
    timestamp: now
  });

  await fs.writeFile(path.join(repoPath, ".git", "refs", "heads", "main"), `${commitHash}\n`, "utf8");
  return commitHash;
}

async function readHeadHash(repoPath) {
  const headPath = path.join(repoPath, ".git", "refs", "heads", "main");
  try {
    const hash = (await fs.readFile(headPath, "utf8")).trim();
    return hash || null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCommitObject(repoPath, { treeHash, parentHash, message, timestamp }) {
  const lines = [
    `tree ${treeHash}`
  ];

  if (parentHash) {
    lines.push(`parent ${parentHash}`);
  }

  const authorLine = `author Codex Fixture <fixture@example.com> ${timestamp} +0000`;
  const committerLine = `committer Codex Fixture <fixture@example.com> ${timestamp} +0000`;
  lines.push(authorLine, committerLine, "", message, "");
  return writeGitObject(repoPath, "commit", Buffer.from(lines.join("\n"), "utf8"));
}

async function writeTreeFromWorkingTree(repoPath, trackedFiles) {
  const root = createTreeNode();

  for (const filePath of trackedFiles) {
    const relativePath = toGitPath(path.relative(repoPath, filePath));
    if (!relativePath || relativePath.startsWith(".git/")) {
      continue;
    }

    const content = await fs.readFile(filePath);
    const blobHash = await writeGitObject(repoPath, "blob", content);
    insertTreeEntry(root, relativePath.split("/"), blobHash);
  }

  return writeTreeNode(repoPath, root);
}

function createTreeNode() {
  return {
    files: [],
    directories: new Map()
  };
}

function insertTreeEntry(node, parts, blobHash) {
  const [head, ...rest] = parts;

  if (rest.length === 0) {
    node.files.push({ name: head, hash: blobHash });
    return;
  }

  if (!node.directories.has(head)) {
    node.directories.set(head, createTreeNode());
  }

  insertTreeEntry(node.directories.get(head), rest, blobHash);
}

async function writeTreeNode(repoPath, node) {
  const entries = [];

  for (const [name, childNode] of [...node.directories.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const hash = await writeTreeNode(repoPath, childNode);
    entries.push({ mode: "40000", name, hash });
  }

  for (const fileEntry of [...node.files].sort((left, right) => left.name.localeCompare(right.name))) {
    entries.push({ mode: "100644", name: fileEntry.name, hash: fileEntry.hash });
  }

  const bodyParts = [];
  for (const entry of entries) {
    bodyParts.push(Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"));
    bodyParts.push(Buffer.from(entry.hash, "hex"));
  }

  return writeGitObject(repoPath, "tree", Buffer.concat(bodyParts));
}

async function writeGitObject(repoPath, type, body) {
  const header = Buffer.from(`${type} ${body.length}\0`, "utf8");
  const store = Buffer.concat([header, body]);
  const hash = crypto.createHash("sha1").update(store).digest("hex");
  const objectDir = path.join(repoPath, ".git", "objects", hash.slice(0, 2));
  const objectPath = path.join(objectDir, hash.slice(2));

  await fs.mkdir(objectDir, { recursive: true });

  try {
    await fs.writeFile(objectPath, zlib.deflateSync(store), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }

  return hash;
}

async function listWorkingTreeFiles(repoPath) {
  const results = [];
  await walk(repoPath, results);
  results.sort((left, right) => left.localeCompare(right));
  return results;
}

async function walk(currentPath, results) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, results);
      continue;
    }

    if (entry.isFile()) {
      results.push(entryPath);
    }
  }
}

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
  }
}

function toGitPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

module.exports = {
  createGitFixtureRepo,
  commitFileChange,
  writeWorkingTreeChange
};
