const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
    const appShellJs = await fs.readFile(path.join(ROOT, "public", "app-shell.js"), "utf8");
    const appSessionJs = await fs.readFile(path.join(ROOT, "public", "app-session.js"), "utf8");
    const appViewsCoreJs = await fs.readFile(path.join(ROOT, "public", "app-views-core.js"), "utf8");
    const appViewsSharedJs = await fs.readFile(path.join(ROOT, "public", "app-views-shared.js"), "utf8");
    const appViewsSuperpowersJs = await fs.readFile(path.join(ROOT, "public", "app-views-superpowers.js"), "utf8");
    const appViewsWorkflowJs = await fs.readFile(path.join(ROOT, "public", "app-views-workflow.js"), "utf8");
    const appWorkbenchJs = await fs.readFile(path.join(ROOT, "public", "app-workbench.js"), "utf8");
    const appUtilsJs = await fs.readFile(path.join(ROOT, "public", "app-utils.js"), "utf8");
    const combinedClientJs = [
      appJs,
      appMainJs,
      appShellJs,
      appSessionJs,
      appViewsCoreJs,
      appViewsSharedJs,
      appViewsSuperpowersJs,
      appViewsWorkflowJs,
      appWorkbenchJs,
      appUtilsJs
    ].join("\n");

    assert.ok(homeHtml.includes("diagram-overlay"), "home page should include diagram overlay shell");
    assert.ok(homeHtml.includes("pending-review-overlay"), "home page should include pending review overlay shell");
    assert.ok(homeHtml.includes("copy-toast"), "home page should include copy toast shell");
    assert.ok(appJs.includes("createApp"), "app entry should bootstrap createApp");
    assert.ok(combinedClientJs.includes("Codex Skill-Based Blueprint Prompt"), "client should expose skill-based blueprint prompt copy");
    assert.ok(
      combinedClientJs.includes("Codex Recovery Skill Prompt") || combinedClientJs.includes("已有项目恢复"),
      "client should expose recovery skill guidance"
    );
    assert.ok(
      combinedClientJs.includes("workflowGuidance") || combinedClientJs.includes("Next Action") || combinedClientJs.includes("下一步动作"),
      "client should include workflow guidance rendering support"
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
      "detail payload should carry workflow guidance next action or recommended skill for the client"
    );
    await assertWorkflowViewRendering();

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

async function assertWorkflowViewRendering() {
  const moduleRoot = path.join(TEST_DATA_DIR, "frontend-module-sandbox");
  await fs.rm(moduleRoot, { recursive: true, force: true });
  await fs.mkdir(moduleRoot, { recursive: true });
  await fs.cp(path.join(ROOT, "public"), moduleRoot, { recursive: true });
  await fs.writeFile(path.join(moduleRoot, "package.json"), '{\n  "type": "module"\n}\n', "utf8");

  const { renderCurrentView } = await import(`${pathToFileURL(path.join(moduleRoot, "app-views.js")).href}?t=${Date.now()}`);
  const { renderNewProjectFilingView } = await import(`${pathToFileURL(path.join(moduleRoot, "app-workbench.js")).href}?t=${Date.now()}`);
  const guidance = {
    workflowStage: "handoff_needed",
    recommendedNextAction: "prepare the handoff prompt",
    recommendedNextSkill: "codex-project-handoff",
    recommendedNextReason: "Workflow docs are ready enough for a handoff decision.",
    recommendedNextAfter: "Run handoff, then start implementation if it passes.",
    workflowBlockingItems: ["Workflow docs are ready enough for a handoff decision."]
  };
  const snapshot = {
    summary: {
      workflowStage: guidance.workflowStage,
      recommendedNextAction: guidance.recommendedNextAction,
      recommendedNextSkill: guidance.recommendedNextSkill,
      recommendedNextReason: guidance.recommendedNextReason,
      hasUnwrittenRepoChanges: false,
      superpowersWorkflowState: "planned_not_executed",
      latestExecutionEvidenceLabel: "Specs and plans are present, but no formal run was found.",
      latestExecutionEvidenceSource: "none"
    },
    detail: {
      views: {
        instructionCenter: {
          workflowGuidance: guidance,
          primaryType: "准备 handoff",
          currentActionState: "ready_for_implementation",
          currentActionReasons: ["Workflow docs are ready enough for a handoff decision."],
          secondaryConditions: [],
          requiredContext: ["current work package goal"],
          availableTypes: [
            {
              type: "handoff",
              label: "Use handoff before implementation",
              template: "Run codex-project-handoff."
            }
          ]
        },
        onboarding: {
          onboardingMode: "superpowers",
          workflowGuidance: guidance,
          steps: ["Run node src/server.js"],
          supportedPaths: ["D:\\repo\\my-project"],
          unsupportedWays: ["Dragging a folder onto the page"],
          actionBoundaries: [
            {
              label: "steady_state_readonly",
              scope: "watcher / polling only read repo state",
              mode: "repo_read_only"
            }
          ]
        }
      }
    }
  };
  const ctx = {
    state: {
      activeView: "instruction-center",
      activeSnapshot: snapshot
    }
  };

  const instructionHtml = renderCurrentView(ctx);
  assert.ok(instructionHtml.includes("handoff_needed"), "instruction center should render the workflow stage");
  assert.ok(instructionHtml.includes("prepare the handoff prompt"), "instruction center should render the next action");
  assert.ok(instructionHtml.includes("codex-project-handoff"), "instruction center should render the recommended skill");

  ctx.state.activeView = "onboarding";
  const onboardingHtml = renderCurrentView(ctx);
  assert.ok(onboardingHtml.includes("superpowers"), "onboarding should render the onboarding mode");
  assert.ok(onboardingHtml.includes("prepare the handoff prompt"), "onboarding should render the workflow next action");

  ctx.state.activeView = "modules";
  ctx.state.activeSnapshot.detail.views.modules = {
    modules: [
      {
        name: "Shell",
        responsibility: "Render the dashboard shell.",
        status: "active",
        sourceKind: "declared"
      }
    ],
    relations: [],
    currentWorkPackage: { value: "Fix front-end regressions." },
    currentWorkPackageModule: {
      moduleName: "Shell",
      relation: "owned_by"
    },
    unknowns: []
  };
  const modulesHtml = renderCurrentView(ctx);
  assert.ok(modulesHtml.includes("Shell"), "modules view should render module names without runtime import errors");
  assert.ok(modulesHtml.includes("declared"), "modules view should render source pills without runtime import errors");

  ctx.state.activeView = "current-slice";
  ctx.state.activeSnapshot.detail.views.currentSlice = {
    currentVersionTarget: { value: "Stabilize the first monitored workflow." },
    currentStage: { value: "implementation" },
    currentWorkPackage: { value: "Fix recent-changes rendering." },
    currentSliceModule: {
      moduleName: "Shell",
      relation: "owned_by"
    },
    currentSliceGoalLink: "Make the dashboard readable again.",
    completionImpact: "Restore current-slice confidence.",
    recentChangeSummaries: [
      {
        title: "Fix missing recent entries renderer",
        summary: "Re-export the shared recent entries renderer.",
        type: "repo_change_inferred",
        createdAt: "2026-04-02T13:12:23.527Z"
      }
    ]
  };
  const currentSliceHtml = renderCurrentView(ctx);
  assert.ok(currentSliceHtml.includes("Fix missing recent entries renderer"), "current-slice should render recent entries without runtime import errors");

  const filingHtml = renderNewProjectFilingView({
    renderUsageCallout: () => "",
    state: {
      activeSnapshot: {
        project: {
          id: "project-b",
          name: "Project B",
          rootPath: "D:\\repo\\project-b",
          onboardingMode: "superpowers",
          useSuperpowers: true
        }
      },
      workbenchPayload: {
        workbench: {
          newProjectDraft: {
            attachedProjectId: "project-a",
            projectPath: "D:\\repo\\project-a",
            projectName: "Project A",
            oneLineDefinition: "old-definition-marker"
          }
        },
        prompts: {
          newProject: {
            gptDraftPrompt: "old-gpt-marker",
            codexStructurePrompt: "old-codex-marker"
          }
        },
        ownershipGuide: {
          userConfirmed: [],
          codexScanned: []
        }
      },
      newProjectWritebackPreview: {
        preview: {
          files: [
            { fileName: "project_brief.json", status: "update", updatedFields: ["old-preview-marker"], sourceKinds: [] }
          ]
        }
      },
      newProjectWritebackResult: {
        scan: {
          summary: "old-result-marker"
        }
      },
      newProjectStructuredInput: "",
      newProjectStructuredStatus: null
    }
  });
  assert.ok(filingHtml.includes("Project B"), "new-project filing should rebind to the active project name");
  assert.ok(filingHtml.includes("D:\\repo\\project-b"), "new-project filing should rebind to the active project path");
  assert.ok(!filingHtml.includes("Project A"), "new-project filing should not leak the previous project name");
  assert.ok(!filingHtml.includes("old-definition-marker"), "new-project filing should clear stale draft fields from another project");
  assert.ok(!filingHtml.includes("old-gpt-marker"), "new-project filing should not reuse stale prompts from another project");
  assert.ok(!filingHtml.includes("old-preview-marker"), "new-project filing should clear stale preview data from another project");
  assert.ok(!filingHtml.includes("old-result-marker"), "new-project filing should clear stale writeback results from another project");
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
