const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TEST_DATA_DIR = path.join(ROOT, "tmp", "frontend-smoke-data");
process.env.CODEX_CONTROL_DATA_DIR = TEST_DATA_DIR;
const { startServer, stopServer } = require("../src/server");
const { createGitFixtureRepo } = require("./test-helpers/git-fixture");
const REGISTRY_FILE = path.join(TEST_DATA_DIR, "project-registry.json");
const CACHE_DIR = path.join(TEST_DATA_DIR, "cache");
const FIXTURE_ROOT = path.join(ROOT, "tmp", "frontend-smoke-fixtures");
const TEST_PORT = 4316;

async function main() {
  assert.equal(process.platform, "win32", "frontend smoke only runs on Windows native Node.");

  const createdProjectIds = new Set();

  try {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    await fs.writeFile(REGISTRY_FILE, '{\n  "schemaVersion": "1.0.0",\n  "projects": []\n}\n', "utf8");

    const server = await startServer(TEST_PORT);
    const serverUrl = `http://localhost:${server.address().port}`;

    const homeHtml = await fetch(`${serverUrl}/`).then((response) => response.text());
    const appJs = await fs.readFile(path.join(ROOT, "public", "app.js"), "utf8");
    const appMainJs = await fs.readFile(path.join(ROOT, "public", "app-main.js"), "utf8");
    const appSessionJs = await fs.readFile(path.join(ROOT, "public", "app-session.js"), "utf8");
    const appWorkbenchJs = await fs.readFile(path.join(ROOT, "public", "app-workbench.js"), "utf8");
    const appUtilsJs = await fs.readFile(path.join(ROOT, "public", "app-utils.js"), "utf8");
    const combinedClientJs = [appJs, appMainJs, appSessionJs, appWorkbenchJs, appUtilsJs].join("\n");

    assert.ok(homeHtml.includes("diagram-overlay"), "home page should include diagram overlay shell");
    assert.ok(homeHtml.includes("pending-review-overlay"), "home page should include pending review overlay shell");
    assert.ok(homeHtml.includes("copy-toast"), "home page should include copy toast shell");
    assert.ok(appJs.includes("createApp"), "app entry should bootstrap createApp");
    assert.ok(combinedClientJs.includes("Codex Skill-Based Blueprint Prompt"), "client should expose skill-based blueprint prompt copy");
    assert.ok(
      combinedClientJs.includes("Codex Recovery Skill Prompt") || combinedClientJs.includes("已有项目恢复"),
      "client should expose recovery skill guidance"
    );
    assert.ok(combinedClientJs.includes("function maybeOpenPendingReviewOverlay"), "client should define pending review overlay helpers");
    assert.ok(combinedClientJs.includes("function renderConflictPill"), "client should keep source inconsistency pill renderer");
    assert.ok(
      combinedClientJs.includes('refs.pendingReviewContent?.addEventListener("click", onDetailActionClick)'),
      "pending review overlay should delegate click actions to the shared action handler"
    );

    const repoPath = path.join(FIXTURE_ROOT, "new-project-smoke-repo");
    await createGitFixtureRepo(repoPath);
    const newProjectPreview = await requestJson(serverUrl, "/api/workbench/new-project/writeback/preview", {
      method: "POST",
      body: JSON.stringify({
        projectPath: repoPath,
        projectName: "Smoke New Project",
        oneLineDefinition: "A smoke-tested project filing flow",
        finalGoal: "Ship a usable first version",
        currentVersionTarget: "Create the first playable / usable baseline",
        currentVersionNonScope: "No advanced optimization yet",
        projectType: "tool",
        targetUsers: "internal team",
        targetExperience: "clear and low-friction",
        techPreferences: "Node.js",
        techConstraints: "Keep the current stack"
      })
    });

    assert.ok(Array.isArray(newProjectPreview.preview.files), "new project preview should include file plans");
    assert.ok(typeof newProjectPreview.prompts.newProject.structuredDraftTemplate === "string", "new project prompts should include a structured draft template");
    assert.ok(Array.isArray(newProjectPreview.prompts.newProject.fieldSuggestions), "new project prompts should include ordered field suggestions");
    assert.ok(
      newProjectPreview.prompts.newProject.gptDraftPrompt.includes("Return JSON"),
      "new project GPT prompt should ask for structured JSON output"
    );
    assert.ok(
      newProjectPreview.prompts.newProject.gptDraftPrompt.includes("recommended_options"),
      "new project GPT prompt should ask for concentrated recommendation options"
    );
    assert.ok(
      newProjectPreview.prompts.newProject.gptDraftPrompt.includes("needs_confirmation"),
      "new project GPT prompt should discourage needs_confirmation in primary fields"
    );
    assert.ok(
      newProjectPreview.prompts.newProject.codexStructurePrompt.includes("first control-plane blueprint"),
      "new project Codex prompt should describe first-version blueprint work"
    );
    assert.ok(
      newProjectPreview.prompts.newProject.codexStructurePrompt.includes("codex-project-handoff"),
      "new project Codex prompt should require handoff skill usage"
    );

    const recoveryRepoPath = path.join(FIXTURE_ROOT, "recovery-smoke-repo");
    await createGitFixtureRepo(recoveryRepoPath);
    const recovery = await requestJson(serverUrl, "/api/workbench/recovery/attach", {
      method: "POST",
      body: JSON.stringify({
        path: recoveryRepoPath,
        name: "Recovery Smoke Repo",
        coarseJudgment: "Looks like a half-finished internal tool",
        keyQuestions: ["What is the real current version target?", "Which module is the current slice in?"]
      })
    });
    createdProjectIds.add(recovery.project.id);

    assert.ok(
      recovery.recovery.prompts.codexScanPrompt.includes("codex-project-recovery-scan"),
      "recovery flow should return a skill-based recovery prompt"
    );
    assert.ok(Array.isArray(recovery.recovery.provisionalSummary.unresolved), "recovery flow should expose unresolved items");

    const guidanceRepoPath = path.join(FIXTURE_ROOT, "workflow-guidance-smoke-repo");
    await createGitFixtureRepo(guidanceRepoPath);
    await fs.mkdir(path.join(guidanceRepoPath, "docs", "superpowers", "specs"), { recursive: true });
    await fs.mkdir(path.join(guidanceRepoPath, "docs", "superpowers", "plans"), { recursive: true });
    await fs.writeFile(path.join(guidanceRepoPath, "docs", "superpowers", "specs", "2026-04-02-smoke-spec.md"), "# Smoke Spec\n\nSmoke summary.\n", "utf8");
    await fs.writeFile(path.join(guidanceRepoPath, "docs", "superpowers", "plans", "2026-04-02-smoke-plan.md"), "# Smoke Plan\n\nSmoke summary.\n", "utf8");
    const guidanceProject = await requestJson(serverUrl, "/api/projects", {
      method: "POST",
      body: JSON.stringify({
        path: guidanceRepoPath,
        name: "Workflow Guidance Smoke Repo",
        useSuperpowers: true
      }),
      expectStatus: 201
    });
    createdProjectIds.add(guidanceProject.project.id);
    const guidanceRefresh = await requestJson(serverUrl, `/api/projects/${guidanceProject.project.id}/refresh`, {
      method: "POST"
    });
    assert.ok(
      guidanceRefresh.summary.recommendedNextAction || guidanceRefresh.summary.recommendedNextSkill,
      "frontend should surface workflow guidance next action or recommended skill"
    );

    const removed = await requestJson(serverUrl, `/api/projects/${recovery.project.id}`, {
      method: "DELETE"
    });
    createdProjectIds.delete(recovery.project.id);
    assert.equal(removed.actionBoundary, "explicit_maintenance_write");
    assert.ok(
      !removed.projectsPayload.projects.some((item) => item.id === recovery.project.id),
      "removed project should disappear from project list payload"
    );

    console.log("PASS frontend.smoke.js");
  } finally {
    await stopServer();
    for (const projectId of createdProjectIds) {
      await fs.rm(path.join(CACHE_DIR, projectId), { recursive: true, force: true });
    }
    await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

async function requestJson(serverUrl, route, options = {}) {
  const expectStatus = options.expectStatus || 200;
  const response = await fetch(`${serverUrl}${route}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json"
    },
    body: options.body
  });
  const payload = await response.json();
  assert.equal(response.status, expectStatus, `Unexpected status for ${route}`);
  return payload;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
