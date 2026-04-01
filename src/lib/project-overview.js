const fs = require("node:fs/promises");
const path = require("node:path");
const {
  CONTROL_DIR_NAME,
  DECISION_LOG_FILE_NAME,
  DOCS_DIR_NAME,
  GAME_DESIGN_FILE_NAME,
  MODULE_MAP_FILE_NAME,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  SCHEMA_VERSION,
  SUPERPOWERS_DIR_NAME,
  SUPERPOWERS_PLANS_DIR_NAME,
  SUPERPOWERS_SPECS_DIR_NAME,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME
} = require("./constants");
const {
  fileExists,
  readJsonIfExists,
  readTextIfExists,
  safeStat,
  writeJsonAtomic
} = require("./fs-utils");

const FIELD_GROUPS = {
  FACT: "fact",
  DECLARED: "declared",
  SUPPLEMENTAL: "supplemental",
  NEEDS_CONFIRMATION: "needs_confirmation"
};

const MODULE_STATUSES = new Set(["not_started", "prototype", "in_progress", "pending_validation", "done", "unknown"]);

async function ensureOverviewSourceFiles(projectRecord) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const scanResult = await scanProjectLayers(projectRecord.rootPath, projectRecord.name);
  const writes = [
    [PROJECT_BRIEF_FILE_NAME, scanResult.sourceFiles.projectBrief],
    [MODULE_MAP_FILE_NAME, scanResult.sourceFiles.moduleMap],
    [TECH_STACK_FILE_NAME, scanResult.sourceFiles.techStack],
    [VERSION_STATE_FILE_NAME, scanResult.sourceFiles.versionState],
    [DECISION_LOG_FILE_NAME, scanResult.sourceFiles.decisionLog]
  ];

  if (scanResult.sourceFiles.gameDesign) {
    writes.push([GAME_DESIGN_FILE_NAME, scanResult.sourceFiles.gameDesign]);
  }

  for (const [fileName, payload] of writes) {
    const filePath = path.join(controlDir, fileName);
    if (!(await fileExists(filePath))) {
      await writeJsonAtomic(filePath, payload);
    }
  }
}

async function rebuildOverviewSourceFiles(projectRecord) {
  const preview = await previewOverviewSourceFiles(projectRecord);
  return applyOverviewPreview(preview, projectRecord);
}

async function previewOverviewSourceFiles(projectRecord) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const scanResult = await scanProjectLayers(projectRecord.rootPath, projectRecord.name);
  const projectState = normalizeProjectStateSeed(
    await readJsonIfExists(path.join(controlDir, PROJECT_STATE_FILE_NAME)),
    projectRecord.name
  );
  const writes = [
    [PROJECT_BRIEF_FILE_NAME, scanResult.sourceFiles.projectBrief],
    [MODULE_MAP_FILE_NAME, scanResult.sourceFiles.moduleMap],
    [TECH_STACK_FILE_NAME, scanResult.sourceFiles.techStack],
    [VERSION_STATE_FILE_NAME, scanResult.sourceFiles.versionState],
    [DECISION_LOG_FILE_NAME, scanResult.sourceFiles.decisionLog]
  ];

  if (scanResult.sourceFiles.gameDesign) {
    writes.push([GAME_DESIGN_FILE_NAME, scanResult.sourceFiles.gameDesign]);
  }

  const fileResults = [];
  for (const [fileName, generatedPayload] of writes) {
    const filePath = path.join(controlDir, fileName);
    const existingPayload = await readJsonIfExists(filePath);
    const nextPayload = existingPayload
      ? mergeScanPayload(existingPayload, generatedPayload)
      : generatedPayload;
    const filledFields = countFilledScanFields(existingPayload, nextPayload);
    const updatedFields = collectChangedLeafPaths(existingPayload, nextPayload);
    const overwrittenFields = collectOverwrittenLeafPaths(existingPayload, nextPayload);
    const changed = !existingPayload || JSON.stringify(existingPayload) !== JSON.stringify(nextPayload);
    const status = existingPayload ? (changed ? "updated" : "unchanged") : "created";

    fileResults.push({
      fileName,
      filePath,
      status,
      filledFields,
      updatedFields,
      overwrittenFields,
      willOverwriteOldValues: overwrittenFields.length > 0,
      sourceKinds: collectSourceKinds(nextPayload),
      nextPayload
    });
  }

  const overviewSources = await readOverviewSources(projectRecord, projectState);

  return {
    generatedAt: new Date().toISOString(),
    actionBoundary: "explicit_maintenance_write",
    previewOnly: true,
    files: fileResults.map(stripPreviewPayload),
    _internalPlan: Object.fromEntries(fileResults.map((item) => [item.fileName, item.nextPayload])),
    updatedFiles: fileResults.filter((item) => item.status !== "unchanged").map((item) => item.fileName),
    stillUnknown: overviewSources.needsConfirmation.slice(0, 12),
    minimumQuestions: buildMinimumQuestions(overviewSources.needsConfirmation)
  };
}

async function applyOverviewPreview(preview, projectRecord) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const fileResults = [];

  for (const item of preview.files) {
    const filePath = path.join(controlDir, item.fileName);
    const existingPayload = await readJsonIfExists(filePath);
    const nextPayload = preview._internalPlan[item.fileName];
    const changed = !existingPayload || JSON.stringify(existingPayload) !== JSON.stringify(nextPayload);
    if (changed) {
      await writeJsonAtomic(filePath, nextPayload);
    }
    fileResults.push({
      ...item,
      status: existingPayload ? (changed ? "updated" : "unchanged") : "created"
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    actionBoundary: "explicit_maintenance_write",
    previewOnly: false,
    files: fileResults,
    updatedFiles: fileResults.filter((item) => item.status !== "unchanged").map((item) => item.fileName),
    stillUnknown: preview.stillUnknown,
    minimumQuestions: preview.minimumQuestions
  };
}

async function readOverviewSources(projectRecord, projectState) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  const filePaths = {
    projectBrief: path.join(controlDir, PROJECT_BRIEF_FILE_NAME),
    moduleMap: path.join(controlDir, MODULE_MAP_FILE_NAME),
    techStack: path.join(controlDir, TECH_STACK_FILE_NAME),
    gameDesign: path.join(controlDir, GAME_DESIGN_FILE_NAME),
    versionState: path.join(controlDir, VERSION_STATE_FILE_NAME),
    decisionLog: path.join(controlDir, DECISION_LOG_FILE_NAME)
  };

  const [rawProjectBrief, rawModuleMap, rawTechStack, rawGameDesign, rawVersionState, rawDecisionLog, scanResult] = await Promise.all([
    readJsonIfExists(filePaths.projectBrief),
    readJsonIfExists(filePaths.moduleMap),
    readJsonIfExists(filePaths.techStack),
    readJsonIfExists(filePaths.gameDesign),
    readJsonIfExists(filePaths.versionState),
    readJsonIfExists(filePaths.decisionLog),
    scanProjectLayers(projectRecord.rootPath, projectRecord.name)
  ]);

  const sourceProjectBrief = normalizeProjectBrief(rawProjectBrief, projectRecord.name);
  const sourceModuleMap = normalizeModuleMap(rawModuleMap);
  const sourceTechStack = normalizeTechStack(rawTechStack);
  const sourceGameDesign = normalizeGameDesign(rawGameDesign);
  const sourceVersionState = normalizeVersionState(rawVersionState, projectState);
  const decisionLog = normalizeDecisionLog(rawDecisionLog);
  const repoDerived = scanResult.repoDerived;
  const superpowers = scanResult.superpowers;
  const conflicts = [];

  const projectBrief = mergeProjectBrief(sourceProjectBrief, repoDerived.projectBrief, superpowers.derived.projectBrief, conflicts);
  const moduleMap = mergeModuleMap(sourceModuleMap, repoDerived.moduleMap, superpowers.derived.moduleMap);
  const techStack = mergeTechStack(sourceTechStack, repoDerived.techStack, superpowers.derived.techStack, conflicts);
  const isGameProject = detectGameFlag(projectBrief, repoDerived, superpowers);
  const gameDesign = mergeGameDesign(sourceGameDesign, repoDerived.gameDesign, superpowers.derived.gameDesign, isGameProject, conflicts);
  const versionState = mergeVersionState(sourceVersionState, projectState, repoDerived.versionState, superpowers.derived.versionState, moduleMap, conflicts);

  return {
    files: await buildSourceFileFacts(filePaths),
    sourcePriority: [
      "1. 项目侧源状态文件 (.codex-control/*.json)",
      "2. repo 可验证文档与代码结构",
      "3. Superpowers specs/plans",
      "4. 其他说明性文档",
      "5. 用户手工补充信息"
    ],
    repoDerived,
    superpowers,
    projectBrief,
    moduleMap,
    techStack,
    gameDesign,
    versionState,
    decisionLog,
    conflicts,
    knownFacts: uniqueEntries([
      ...projectBrief.knownFacts,
      ...moduleMap.knownFacts,
      ...techStack.knownFacts,
      ...versionState.knownFacts
    ]),
    declaredItems: uniqueEntries([
      ...projectBrief.declaredItems,
      ...moduleMap.declaredItems,
      ...techStack.declaredItems,
      ...versionState.declaredItems
    ]),
    supplementalItems: uniqueEntries([
      ...projectBrief.supplementalItems,
      ...moduleMap.supplementalItems,
      ...techStack.supplementalItems,
      ...versionState.supplementalItems
    ]),
    needsConfirmation: filterResolvedNeedsConfirmation(uniqueStrings([
      ...projectBrief.needsConfirmation,
      ...moduleMap.needsConfirmation,
      ...techStack.needsConfirmation,
      ...gameDesign.needsConfirmation,
      ...versionState.needsConfirmation
    ]), { projectBrief, moduleMap, techStack, gameDesign, versionState }),
    isGameProject
  };
}

async function scanProjectLayers(projectRoot, displayName) {
  const repoSnapshot = await readRepoSnapshot(projectRoot);
  const sourceProjectState = normalizeProjectStateSeed(
    await readJsonIfExists(path.join(projectRoot, CONTROL_DIR_NAME, PROJECT_STATE_FILE_NAME)),
    displayName
  );
  const superpowers = await scanSuperpowers(projectRoot);
  const repoDerived = buildRepoDerived(projectRoot, displayName, repoSnapshot, sourceProjectState, superpowers);

  return {
    repoSnapshot,
    repoDerived,
    superpowers,
    sourceFiles: {
      projectBrief: buildDefaultProjectBrief(displayName, repoDerived.projectBrief),
      moduleMap: buildDefaultModuleMap(repoDerived.moduleMap),
      techStack: buildDefaultTechStack(repoDerived.techStack),
      gameDesign: repoDerived.isGameProject ? buildDefaultGameDesign(repoDerived.gameDesign) : null,
      versionState: buildDefaultVersionState(sourceProjectState, repoDerived.versionState, repoDerived.moduleMap),
      decisionLog: buildDefaultDecisionLog()
    }
  };
}

async function readRepoSnapshot(projectRoot) {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const files = entries.filter((item) => item.isFile()).map((item) => item.name);
  const directories = entries.filter((item) => item.isDirectory()).map((item) => item.name);
  const packageJson = await safeReadJson(path.join(projectRoot, "package.json"));
  const readme = await readProjectReadme(projectRoot);

  return {
    projectRoot,
    files,
    directories,
    packageJson,
    readme
  };
}

async function scanSuperpowers(projectRoot) {
  const baseDir = path.join(projectRoot, DOCS_DIR_NAME, SUPERPOWERS_DIR_NAME);
  const specsDir = path.join(baseDir, SUPERPOWERS_SPECS_DIR_NAME);
  const plansDir = path.join(baseDir, SUPERPOWERS_PLANS_DIR_NAME);
  const [baseStat, specs, plans] = await Promise.all([
    safeStat(baseDir),
    collectSupplementalDocs(specsDir),
    collectSupplementalDocs(plansDir)
  ]);

  const latestUpdatedAt = [specs.latestUpdatedAt, plans.latestUpdatedAt]
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  const status = !baseStat
    ? "not_used"
    : (specs.items.length || plans.items.length)
      ? "detected"
      : "connected_but_insufficient";

  return {
    status,
    hasDirectory: !!baseStat,
    hasSpecs: specs.items.length > 0,
    hasPlans: plans.items.length > 0,
    latestUpdatedAt,
    evidence: {
      specs: specs.items,
      plans: plans.items
    },
    derived: buildSuperpowersDerived(specs.items, plans.items)
  };
}

async function collectSupplementalDocs(rootDir) {
  const rootStat = await safeStat(rootDir);
  if (!rootStat || !rootStat.isDirectory()) {
    return {
      items: [],
      latestUpdatedAt: null
    };
  }

  const items = [];
  await walkDir(rootDir, async (filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    if (![".md", ".txt", ".json"].includes(extension)) {
      return;
    }

    const stat = await safeStat(filePath);
    const raw = await readTextIfExists(filePath);
    if (raw === null) {
      return;
    }

    items.push({
      file: path.relative(path.dirname(rootDir), filePath),
      title: extractDocTitle(filePath, raw),
      summary: extractDocSummary(raw),
      updatedAt: stat ? stat.mtime.toISOString() : null
    });
  });

  const latestUpdatedAt = items
    .map((item) => item.updatedAt)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  return {
    items,
    latestUpdatedAt
  };
}

async function walkDir(rootDir, onFile) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const targetPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(targetPath, onFile);
    } else if (entry.isFile()) {
      await onFile(targetPath);
    }
  }
}

function buildSuperpowersDerived(specs, plans) {
  const firstSpec = specs[0];
  const firstPlan = plans[0];
  const derivedModules = uniqueStrings(plans.map((item) => normalizeModuleName(path.basename(item.file, path.extname(item.file)))));

  return {
    projectBrief: {
      oneLineDefinition: firstSpec ? supplementalField(firstSpec.summary || firstSpec.title, `docs/superpowers/specs/${firstSpec.file}`) : unknownField(),
      finalGoal: firstSpec ? supplementalField(firstSpec.title, `docs/superpowers/specs/${firstSpec.file}`) : unknownField(),
      projectType: unknownField(),
      targetUsers: unknownField(),
      targetExperience: unknownField(),
      targetOutcome: unknownField(),
      scopeIn: unknownField(),
      scopeOut: unknownField(),
      supplementalItems: [
        ...specs.map((item) => namedEntry(`Spec: ${item.title}`, item.summary || item.file, `docs/superpowers/specs/${item.file}`, FIELD_GROUPS.SUPPLEMENTAL))
      ],
      needsConfirmation: []
    },
    moduleMap: {
      modules: derivedModules.map((name) => ({
        id: normalizeId(name),
        name,
        responsibility: "由 Superpowers plan 文件名推断，待确认",
        status: "unknown",
        source: "docs/superpowers/plans filename",
        sourceKind: FIELD_GROUPS.SUPPLEMENTAL,
        relatedModules: []
      }))
    },
    techStack: {
      supplementalItems: []
    },
    gameDesign: {},
    versionState: {
      versionTarget: firstPlan ? supplementalField(firstPlan.title, `docs/superpowers/plans/${firstPlan.file}`) : unknownField(),
      verificationSummary: firstPlan ? supplementalField(firstPlan.summary || firstPlan.title, `docs/superpowers/plans/${firstPlan.file}`) : unknownField(),
      supplementalItems: [
        ...plans.map((item) => namedEntry(`Plan: ${item.title}`, item.summary || item.file, `docs/superpowers/plans/${item.file}`, FIELD_GROUPS.SUPPLEMENTAL))
      ]
    }
  };
}

function buildRepoDerived(projectRoot, displayName, repoSnapshot, projectState, superpowers) {
  const packageJson = repoSnapshot.packageJson || {};
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };
  const description = String(packageJson.description || "").trim();
  const keywords = Array.isArray(packageJson.keywords) ? packageJson.keywords.map(String) : [];
  const readmeText = repoSnapshot.readme.text;
  const combinedText = [description, ...keywords, readmeText].join(" ").toLowerCase();
  const moduleMap = deriveRepoModuleMap(repoSnapshot.directories, projectState.status.currentWorkPackage.value, superpowers.derived.moduleMap.modules);
  const projectType = deriveProjectType(combinedText, repoSnapshot, dependencies);
  const frontendClient = deriveFrontendClient(repoSnapshot, dependencies);
  const rendering = deriveRenderingMode(combinedText, repoSnapshot, dependencies);
  const uiTech = deriveUiTech(repoSnapshot, dependencies);
  const stateManagement = deriveStateManagement(dependencies);
  const storage = deriveStorage(combinedText, dependencies);
  const buildRun = deriveBuildRun(packageJson.scripts || {});
  const backend = deriveBackend(combinedText, repoSnapshot, dependencies);
  const isGameProject = projectType.value === "game";

  return {
    isGameProject,
    projectBrief: {
      projectName: displayName,
      oneLineDefinition: description
        ? declaredField(description, "package.json description")
        : (repoSnapshot.readme.summary
          ? declaredField(repoSnapshot.readme.summary, repoSnapshot.readme.fileName || "README")
          : unknownField()),
      finalGoal: unknownField(),
      projectType,
      targetUsers: unknownField(),
      targetExperience: unknownField(),
      targetOutcome: unknownField(),
      scopeIn: unknownField(),
      scopeOut: unknownField(),
      knownFacts: uniqueEntries([
        packageJson.name ? namedEntry("package name", packageJson.name, "package.json name", FIELD_GROUPS.FACT) : null,
        repoSnapshot.files.includes("package.json") ? namedEntry("package.json", "存在", "repo root", FIELD_GROUPS.FACT) : null,
        buildRun.value !== "unknown" ? namedEntry("构建与启动", buildRun.value, buildRun.source, buildRun.sourceKind) : null,
        namedEntry("后端识别", backend.exists.value, backend.exists.source, backend.exists.sourceKind)
      ]),
      declaredItems: uniqueEntries([
        description ? namedEntry("项目一句话定义", description, "package.json description", FIELD_GROUPS.DECLARED) : null,
        keywords.length ? namedEntry("keywords", keywords.join(", "), "package.json keywords", FIELD_GROUPS.DECLARED) : null
      ]),
      supplementalItems: [],
      needsConfirmation: [
        "终版目标 / 目标形态",
        "目标效果",
        "面向对象 / 目标体验",
        "项目边界（当前做什么 / 不做什么）"
      ]
    },
    moduleMap,
    techStack: {
      frontendClient,
      rendering,
      uiTech,
      stateManagement,
      storage,
      buildRun,
      backend,
      infrastructure: deriveInfrastructure(dependencies),
      knownFacts: uniqueEntries([
        namedEntry("前端 / 客户端", frontendClient.value, frontendClient.source, frontendClient.sourceKind),
        namedEntry("画面显示方式", rendering.value, rendering.source, rendering.sourceKind),
        namedEntry("UI 技术", uiTech.value, uiTech.source, uiTech.sourceKind),
        namedEntry("状态管理", stateManagement.value, stateManagement.source, stateManagement.sourceKind),
        namedEntry("存档方式", storage.value, storage.source, storage.sourceKind),
        namedEntry("后端存在性", backend.exists.value, backend.exists.source, backend.exists.sourceKind)
      ]),
      declaredItems: [],
      supplementalItems: [],
      needsConfirmation: uniqueStrings([
        frontendClient.value === "unknown" ? "前端 / 客户端技术" : null,
        rendering.value === "unknown" ? "画面显示方式" : null,
        uiTech.value === "unknown" ? "UI 技术" : null,
        stateManagement.value === "unknown" ? "状态管理 / 数据流" : null,
        storage.value === "unknown" ? "存档方式" : null,
        backend.responsibility.value === "unknown" ? "后端职责" : null
      ])
    },
    gameDesign: {
      gameCategory: deriveGameCategory(combinedText),
      coreGameplayLoop: unknownField(),
      progressionLoop: unknownField(),
      rewardLoop: unknownField(),
      offlineProgression: unknownField(),
      automation: unknownField(),
      visualDirection: deriveVisualDirection(combinedText),
      primaryScreens: derivePrimaryScreens(combinedText),
      playerExperienceGoal: unknownField(),
      currentPlayableState: projectState.status.currentStage.value !== "unknown"
        ? declaredField(`当前阶段：${projectState.status.currentStage.value}`, "project_state.json status.currentStage")
        : unknownField(),
      needsConfirmation: [
        "核心玩法循环",
        "成长循环",
        "收益循环",
        "离线收益 / 自动化",
        "玩家最终体验目标"
      ]
    },
    versionState: {
      versionTarget: projectState.status.versionTarget.value !== "unknown"
        ? declaredField(projectState.status.versionTarget.value, "project_state.json status.versionTarget")
        : unknownField(),
      currentStage: projectState.status.currentStage.value !== "unknown"
        ? declaredField(projectState.status.currentStage.value, "project_state.json status.currentStage")
        : unknownField(),
      currentWorkPackage: projectState.status.currentWorkPackage.value !== "unknown"
        ? declaredField(projectState.status.currentWorkPackage.value, "project_state.json status.currentWorkPackage")
        : unknownField(),
      currentSliceModule: mapWorkPackageToModule(projectState.status.currentWorkPackage.value, moduleMap.modules),
      verificationSummary: projectState.status.consistency.summary
        ? declaredField(projectState.status.consistency.summary, "project_state.json status.consistency.summary")
        : unknownField(),
      knownFacts: [],
      declaredItems: [],
      supplementalItems: [],
      needsConfirmation: []
    }
  };
}

function buildDefaultProjectBrief(displayName, derived) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "project_brief",
    projectName: displayName,
    oneLineDefinition: fallbackField(derived.oneLineDefinition),
    finalGoal: unknownField("manual"),
    projectType: fallbackField(derived.projectType),
    targetUsers: unknownField("manual"),
    targetExperience: unknownField("manual"),
    targetOutcome: unknownField("manual"),
    scopeIn: unknownField("manual"),
    scopeOut: unknownField("manual"),
    knownFacts: derived.knownFacts || [],
    declaredItems: derived.declaredItems || [],
    supplementalItems: [],
    needsConfirmation: derived.needsConfirmation || []
  };
}

function buildDefaultModuleMap(derived) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "module_map",
    modules: derived.modules || [],
    relations: derived.relations || [],
    currentWorkPackageModule: derived.currentWorkPackageModule || unknownModuleMapping(),
    knownFacts: derived.knownFacts || [],
    declaredItems: [],
    supplementalItems: [],
    needsConfirmation: derived.needsConfirmation || []
  };
}

function buildDefaultTechStack(derived) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "tech_stack",
    frontendClient: fallbackField(derived.frontendClient),
    rendering: fallbackField(derived.rendering),
    uiTech: fallbackField(derived.uiTech),
    stateManagement: fallbackField(derived.stateManagement),
    storage: fallbackField(derived.storage),
    buildRun: fallbackField(derived.buildRun),
    backend: {
      exists: fallbackField(derived.backend.exists),
      technology: fallbackField(derived.backend.technology),
      responsibility: fallbackField(derived.backend.responsibility)
    },
    infrastructure: derived.infrastructure || [],
    knownFacts: derived.knownFacts || [],
    declaredItems: [],
    supplementalItems: [],
    needsConfirmation: derived.needsConfirmation || []
  };
}

function buildDefaultGameDesign(derived) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "game_design",
    gameCategory: fallbackField(derived.gameCategory),
    coreGameplayLoop: unknownField("manual"),
    progressionLoop: unknownField("manual"),
    rewardLoop: unknownField("manual"),
    offlineProgression: unknownField("manual"),
    automation: unknownField("manual"),
    visualDirection: fallbackField(derived.visualDirection),
    primaryScreens: fallbackField(derived.primaryScreens),
    playerExperienceGoal: unknownField("manual"),
    currentPlayableState: fallbackField(derived.currentPlayableState),
    needsConfirmation: derived.needsConfirmation || []
  };
}

function buildDefaultVersionState(projectState, derived, moduleMap) {
  const versionValue = derived.versionTarget?.value || projectState.status.versionTarget.value || "current";
  const workPackageValue = derived.currentWorkPackage?.value || projectState.status.currentWorkPackage.value || "current";
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "version_state",
    version_id: `version-${normalizeId(versionValue)}`,
    work_package_id: `work-package-${normalizeId(workPackageValue)}`,
    versionTarget: fallbackField(derived.versionTarget),
    versionNonScope: [],
    definitionOfDone: [],
    keyRisks: [],
    blockers: [],
    verificationSummary: fallbackField(derived.verificationSummary),
    verificationMatrix: [],
    goNoGoStatus: unknownField("manual"),
    currentStage: fallbackField(derived.currentStage),
    currentWorkPackage: fallbackField(derived.currentWorkPackage),
    currentSliceModule: derived.currentSliceModule || mapWorkPackageToModule(projectState.status.currentWorkPackage.value, moduleMap.modules),
    knownFacts: [],
    declaredItems: [],
    supplementalItems: [],
    needsConfirmation: [
      "当前版本非范围",
      "完成定义（DoD）",
      "当前版本 blockers",
      "当前版本 go / no-go 状态",
      "验证矩阵"
    ]
  };
}

function buildDefaultDecisionLog() {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "decision_log",
    decisions: []
  };
}

function normalizeProjectBrief(raw, displayName) {
  const base = buildDefaultProjectBrief(displayName, {
    oneLineDefinition: unknownField("manual"),
    projectType: unknownField("manual"),
    knownFacts: [],
    declaredItems: [],
    needsConfirmation: []
  });
  return {
    ...base,
    ...(raw || {}),
    projectName: raw?.projectName || displayName,
    oneLineDefinition: normalizeField(raw?.oneLineDefinition, base.oneLineDefinition),
    finalGoal: normalizeField(raw?.finalGoal, base.finalGoal),
    projectType: normalizeField(raw?.projectType, base.projectType),
    targetUsers: normalizeField(raw?.targetUsers, base.targetUsers),
    targetExperience: normalizeField(raw?.targetExperience, base.targetExperience),
    targetOutcome: normalizeField(raw?.targetOutcome, base.targetOutcome),
    scopeIn: normalizeField(raw?.scopeIn, base.scopeIn),
    scopeOut: normalizeField(raw?.scopeOut, base.scopeOut),
    knownFacts: normalizeEntries(raw?.knownFacts),
    declaredItems: normalizeEntries(raw?.declaredItems),
    supplementalItems: normalizeEntries(raw?.supplementalItems),
    needsConfirmation: normalizeStrings(raw?.needsConfirmation)
  };
}

function normalizeModuleMap(raw) {
  const base = buildDefaultModuleMap({
    modules: [],
    relations: [],
    currentWorkPackageModule: unknownModuleMapping(),
    knownFacts: [],
    needsConfirmation: []
  });
  const modules = normalizeModules(raw?.modules);
  const relations = normalizeModuleRelations(raw?.relations, modules);
  return {
    ...base,
    ...(raw || {}),
    modules: applyRelationTargetsToModules(modules, relations),
    relations,
    currentWorkPackageModule: normalizeModuleMapping(raw?.currentWorkPackageModule),
    knownFacts: normalizeEntries(raw?.knownFacts),
    declaredItems: normalizeEntries(raw?.declaredItems),
    supplementalItems: normalizeEntries(raw?.supplementalItems),
    needsConfirmation: normalizeStrings(raw?.needsConfirmation)
  };
}

function normalizeTechStack(raw) {
  const base = buildDefaultTechStack({
    frontendClient: unknownField("manual"),
    rendering: unknownField("manual"),
    uiTech: unknownField("manual"),
    stateManagement: unknownField("manual"),
    storage: unknownField("manual"),
    buildRun: unknownField("manual"),
    backend: {
      exists: unknownField("manual"),
      technology: unknownField("manual"),
      responsibility: unknownField("manual")
    },
    infrastructure: [],
    knownFacts: [],
    needsConfirmation: []
  });
  return {
    ...base,
    ...(raw || {}),
    frontendClient: normalizeField(raw?.frontendClient, base.frontendClient),
    rendering: normalizeField(raw?.rendering, base.rendering),
    uiTech: normalizeField(raw?.uiTech ?? raw?.ui, base.uiTech),
    stateManagement: normalizeField(raw?.stateManagement, base.stateManagement),
    storage: normalizeField(raw?.storage ?? raw?.saveStrategy, base.storage),
    buildRun: normalizeField(raw?.buildRun, base.buildRun),
    backend: {
      exists: normalizeField(raw?.backend?.exists, base.backend.exists),
      technology: normalizeField(raw?.backend?.technology, base.backend.technology),
      responsibility: normalizeField(raw?.backend?.responsibility, base.backend.responsibility)
    },
    infrastructure: normalizeEntries(raw?.infrastructure),
    knownFacts: normalizeEntries(raw?.knownFacts),
    declaredItems: normalizeEntries(raw?.declaredItems),
    supplementalItems: normalizeEntries(raw?.supplementalItems),
    needsConfirmation: normalizeStrings(raw?.needsConfirmation)
  };
}

function normalizeGameDesign(raw) {
  const base = buildDefaultGameDesign({
    gameCategory: unknownField("manual"),
    visualDirection: unknownField("manual"),
    primaryScreens: unknownField("manual"),
    currentPlayableState: unknownField("manual"),
    needsConfirmation: []
  });
  return {
    ...base,
    ...(raw || {}),
    gameCategory: normalizeField(raw?.gameCategory, base.gameCategory),
    coreGameplayLoop: normalizeField(raw?.coreGameplayLoop ?? raw?.coreLoop, base.coreGameplayLoop),
    progressionLoop: normalizeField(raw?.progressionLoop ?? raw?.growthLoop ?? raw?.finalProgressionLoop ?? raw?.outOfRunProgression, base.progressionLoop),
    rewardLoop: normalizeField(raw?.rewardLoop ?? raw?.monetizationLoop ?? raw?.finalRewardLoop, base.rewardLoop),
    offlineProgression: normalizeField(raw?.offlineProgression ?? raw?.offlineAutomation, base.offlineProgression),
    automation: normalizeField(raw?.automation ?? raw?.offlineAutomation, base.automation),
    visualDirection: normalizeField(raw?.visualDirection, base.visualDirection),
    primaryScreens: normalizeField(raw?.primaryScreens, base.primaryScreens),
    playerExperienceGoal: normalizeField(
      raw?.playerExperienceGoal ?? raw?.playerFantasy ?? raw?.finalVersionExperienceGoal ?? raw?.currentVersionExperienceGoal,
      base.playerExperienceGoal
    ),
    currentPlayableState: normalizeField(raw?.currentPlayableState, base.currentPlayableState),
    needsConfirmation: normalizeStrings(raw?.needsConfirmation)
  };
}

function normalizeVersionState(raw, projectState) {
  const base = buildDefaultVersionState(projectState, {
    versionTarget: unknownField("manual"),
    verificationSummary: unknownField("manual"),
    currentStage: unknownField("manual"),
    currentWorkPackage: unknownField("manual"),
    currentSliceModule: unknownModuleMapping()
  }, { modules: [] });

  return {
    ...base,
    ...(raw || {}),
    version_id: raw?.version_id || base.version_id,
    work_package_id: raw?.work_package_id || base.work_package_id,
    versionTarget: normalizeField(raw?.versionTarget, base.versionTarget),
    versionNonScope: normalizeEntries(raw?.versionNonScope),
    definitionOfDone: normalizeDefinitionOfDone(raw?.definitionOfDone),
    keyRisks: normalizeRisks(raw?.keyRisks),
    blockers: normalizeEntries(raw?.blockers),
    verificationSummary: normalizeField(raw?.verificationSummary, base.verificationSummary),
    verificationMatrix: normalizeMatrix(raw?.verificationMatrix),
    goNoGoStatus: normalizeField(raw?.goNoGoStatus, base.goNoGoStatus),
    currentStage: normalizeField(raw?.currentStage, base.currentStage),
    currentWorkPackage: normalizeField(raw?.currentWorkPackage, base.currentWorkPackage),
    currentSliceModule: normalizeModuleMapping(raw?.currentSliceModule),
    knownFacts: normalizeEntries(raw?.knownFacts),
    declaredItems: normalizeEntries(raw?.declaredItems),
    supplementalItems: normalizeEntries(raw?.supplementalItems),
    needsConfirmation: normalizeStrings(raw?.needsConfirmation)
  };
}

function normalizeDecisionLog(raw) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "decision_log",
    ...(raw || {}),
    decisions: Array.isArray(raw?.decisions)
      ? raw.decisions.map((item, index) => ({
          id: item.id || `decision-${index + 1}`,
          decision_id: item.decision_id || item.id || `decision-${index + 1}`,
          title: item.title || "未命名决策",
          summary: item.summary || "unknown",
          reason: item.reason || "",
          impact: item.impact || "",
          status: item.status || "recorded",
          source: item.source || "manual",
          source_ref: item.source_ref || item.source || "manual",
          confidence: item.confidence || "medium",
          last_updated_at: item.last_updated_at || item.decidedAt || null,
          decidedAt: item.decidedAt || null,
          related_modules: normalizeStrings(item.related_modules || item.relatedModules),
          related_versions: normalizeStrings(item.related_versions || item.relatedVersions),
          related_risks: normalizeStrings(item.related_risks || item.relatedRisks),
          related_work_packages: normalizeStrings(item.related_work_packages || item.relatedWorkPackages),
          unresolved_items: normalizeStrings(item.unresolved_items || item.unresolvedItems)
        }))
      : []
  };
}

function mergeProjectBrief(source, repo, supplemental, conflicts) {
  return {
    ...source,
    oneLineDefinition: selectField(source.oneLineDefinition, repo.oneLineDefinition, supplemental.oneLineDefinition, conflicts, "project_one_line_definition"),
    finalGoal: selectField(source.finalGoal, repo.finalGoal, supplemental.finalGoal, conflicts, "project_final_goal"),
    projectType: selectField(source.projectType, repo.projectType, supplemental.projectType, conflicts, "project_type"),
    targetUsers: selectField(source.targetUsers, repo.targetUsers, supplemental.targetUsers, conflicts, "project_target_users"),
    targetExperience: selectField(source.targetExperience, repo.targetExperience, supplemental.targetExperience, conflicts, "project_target_experience"),
    targetOutcome: selectField(source.targetOutcome, repo.targetOutcome, supplemental.targetOutcome, conflicts, "project_target_outcome"),
    scopeIn: selectField(source.scopeIn, repo.scopeIn, supplemental.scopeIn, conflicts, "project_scope_in"),
    scopeOut: selectField(source.scopeOut, repo.scopeOut, supplemental.scopeOut, conflicts, "project_scope_out"),
    knownFacts: uniqueEntries([...source.knownFacts, ...(repo.knownFacts || [])]),
    declaredItems: uniqueEntries([...source.declaredItems, ...(repo.declaredItems || [])]),
    supplementalItems: uniqueEntries([...source.supplementalItems, ...(supplemental.supplementalItems || [])]),
    needsConfirmation: uniqueStrings([
      ...source.needsConfirmation,
      ...(repo.needsConfirmation || [])
    ])
  };
}

function mergeModuleMap(source, repo, supplemental) {
  const primaryModules = source.modules.length ? source.modules : repo.modules;
  return {
    ...source,
    modules: mergeModuleLists(primaryModules, supplemental.modules || []),
    relations: uniqueEntries([...source.relations, ...(repo.relations || [])]),
    currentWorkPackageModule: source.currentWorkPackageModule.moduleName !== "unknown"
      ? source.currentWorkPackageModule
      : (repo.currentWorkPackageModule || unknownModuleMapping()),
    knownFacts: uniqueEntries([...source.knownFacts, ...(repo.knownFacts || [])]),
    declaredItems: uniqueEntries([...source.declaredItems, ...(repo.declaredItems || [])]),
    supplementalItems: uniqueEntries([
      ...source.supplementalItems,
      ...(supplemental.modules || []).map((item) => namedEntry(`Superpowers 模块 ${item.name}`, item.responsibility, item.source, FIELD_GROUPS.SUPPLEMENTAL))
    ]),
    needsConfirmation: uniqueStrings([...source.needsConfirmation, ...(repo.needsConfirmation || [])])
  };
}

function mergeTechStack(source, repo, supplemental, conflicts) {
  return {
    ...source,
    frontendClient: selectField(source.frontendClient, repo.frontendClient, supplemental.frontendClient, conflicts, "tech_frontend_client"),
    rendering: selectField(source.rendering, repo.rendering, supplemental.rendering, conflicts, "tech_rendering"),
    uiTech: selectField(source.uiTech, repo.uiTech, supplemental.uiTech, conflicts, "tech_ui"),
    stateManagement: selectField(source.stateManagement, repo.stateManagement, supplemental.stateManagement, conflicts, "tech_state_management"),
    storage: selectField(source.storage, repo.storage, supplemental.storage, conflicts, "tech_storage"),
    buildRun: selectField(source.buildRun, repo.buildRun, supplemental.buildRun, conflicts, "tech_build_run"),
    backend: {
      exists: selectField(source.backend.exists, repo.backend.exists, supplemental.backend?.exists, conflicts, "tech_backend_exists"),
      technology: selectField(source.backend.technology, repo.backend.technology, supplemental.backend?.technology, conflicts, "tech_backend_technology"),
      responsibility: selectField(source.backend.responsibility, repo.backend.responsibility, supplemental.backend?.responsibility, conflicts, "tech_backend_responsibility")
    },
    infrastructure: uniqueEntries([...source.infrastructure, ...(repo.infrastructure || [])]),
    knownFacts: uniqueEntries([...source.knownFacts, ...(repo.knownFacts || [])]),
    declaredItems: source.declaredItems,
    supplementalItems: uniqueEntries([...source.supplementalItems, ...(supplemental.supplementalItems || [])]),
    needsConfirmation: uniqueStrings([...source.needsConfirmation, ...(repo.needsConfirmation || [])])
  };
}

function mergeGameDesign(source, repo, supplemental, isGameProject, conflicts) {
  if (!isGameProject) {
    return normalizeGameDesign(null);
  }

  return {
    ...source,
    gameCategory: selectField(source.gameCategory, repo.gameCategory, supplemental.gameCategory, conflicts, "game_category"),
    coreGameplayLoop: selectField(source.coreGameplayLoop, repo.coreGameplayLoop, supplemental.coreGameplayLoop, conflicts, "game_core_loop"),
    progressionLoop: selectField(source.progressionLoop, repo.progressionLoop, supplemental.progressionLoop, conflicts, "game_progression_loop"),
    rewardLoop: selectField(source.rewardLoop, repo.rewardLoop, supplemental.rewardLoop, conflicts, "game_reward_loop"),
    offlineProgression: selectField(source.offlineProgression, repo.offlineProgression, supplemental.offlineProgression, conflicts, "game_offline_progression"),
    automation: selectField(source.automation, repo.automation, supplemental.automation, conflicts, "game_automation"),
    visualDirection: selectField(source.visualDirection, repo.visualDirection, supplemental.visualDirection, conflicts, "game_visual_direction"),
    primaryScreens: selectField(source.primaryScreens, repo.primaryScreens, supplemental.primaryScreens, conflicts, "game_primary_screens"),
    playerExperienceGoal: selectField(source.playerExperienceGoal, repo.playerExperienceGoal, supplemental.playerExperienceGoal, conflicts, "game_experience_goal"),
    currentPlayableState: selectField(source.currentPlayableState, repo.currentPlayableState, supplemental.currentPlayableState, conflicts, "game_playable_state"),
    needsConfirmation: uniqueStrings([...source.needsConfirmation, ...(repo.needsConfirmation || [])])
  };
}

function mergeVersionState(source, projectState, repo, supplemental, moduleMap, conflicts) {
  const fallbackMapping = mapWorkPackageToModule(projectState.status.currentWorkPackage.value, moduleMap.modules);
  return {
    ...source,
    versionTarget: selectField(source.versionTarget, repo.versionTarget, supplemental.versionTarget, conflicts, "version_target"),
    verificationSummary: selectField(source.verificationSummary, repo.verificationSummary, supplemental.verificationSummary, conflicts, "version_verification_summary"),
    currentStage: selectField(source.currentStage, repo.currentStage, supplemental.currentStage, conflicts, "version_current_stage"),
    currentWorkPackage: selectField(source.currentWorkPackage, repo.currentWorkPackage, supplemental.currentWorkPackage, conflicts, "version_current_work_package"),
    currentSliceModule: source.currentSliceModule.moduleName !== "unknown"
      ? source.currentSliceModule
      : (repo.currentSliceModule?.moduleName !== "unknown" ? repo.currentSliceModule : fallbackMapping),
    knownFacts: uniqueEntries([...source.knownFacts, ...(repo.knownFacts || [])]),
    declaredItems: uniqueEntries([...source.declaredItems, ...(repo.declaredItems || [])]),
    supplementalItems: uniqueEntries([...source.supplementalItems, ...(supplemental.supplementalItems || [])]),
    needsConfirmation: uniqueStrings([...source.needsConfirmation, ...(repo.needsConfirmation || [])])
  };
}

async function buildSourceFileFacts(filePaths) {
  const entries = await Promise.all(
    Object.entries(filePaths).map(async ([key, filePath]) => {
      const stat = await safeStat(filePath);
      return [
        key,
        {
          path: filePath,
          exists: !!stat,
          mtime: stat ? stat.mtime.toISOString() : null,
          role: key === "versionState" ? "version-control-source" : "project-baseline-source"
        }
      ];
    })
  );

  return Object.fromEntries(entries);
}

function selectField(primary, repoField, supplementalFieldValue, conflicts, conflictType) {
  const candidates = [primary, repoField, supplementalFieldValue].filter(Boolean);
  const chosen = candidates.find((item) => item.value && item.value !== "unknown") || primary || repoField || supplementalFieldValue || unknownField();
  const knownValues = candidates
    .filter((item) => item.value && item.value !== "unknown")
    .map((item) => ({
      normalized: normalizeValue(item.value),
      original: item.value,
      source: item.source,
      sourceKind: item.sourceKind || item.source_kind || FIELD_GROUPS.DECLARED,
      sourceRef: item.source_ref || item.source
    }));

  if (knownValues.length > 1) {
    const mismatch = knownValues.find((item) => item.normalized !== knownValues[0].normalized);
    if (mismatch && !shouldSuppressKnownCoexistenceConflict(conflictType, knownValues)) {
      conflicts.push({
        level: "medium",
        type: conflictType,
        message: `字段存在来源冲突：${knownValues.map((item) => `${item.original} <${item.source}>`).join(" | ")}`
      });
    }
  }

  return chosen;
}

function deriveProjectType(combinedText, repoSnapshot, dependencies) {
  if (containsAny(combinedText, ["game", "游戏", "idle", "fishing", "clicker", "simulation", "roguelite"])) {
    return declaredField("game", "README / package description");
  }
  if (dependencies.electron || dependencies["@tauri-apps/api"]) {
    return factField("client", "package.json desktop dependency");
  }
  if (dependencies.next) {
    return factField("website", "package.json dependencies.next");
  }
  if (dependencies.react || dependencies.vue || dependencies.svelte || repoSnapshot.files.includes("index.html")) {
    return factField("website", "repo frontend entry");
  }
  if (dependencies.commander || dependencies.yargs || repoSnapshot.files.includes("cli.js")) {
    return factField("tool", "CLI dependency / entry");
  }
  return unknownField();
}

function deriveFrontendClient(repoSnapshot, dependencies) {
  if (dependencies.next) {
    return factField("Next.js", "package.json dependencies.next");
  }
  if (dependencies.react) {
    return factField("React", "package.json dependencies.react");
  }
  if (dependencies.vue) {
    return factField("Vue", "package.json dependencies.vue");
  }
  if (dependencies.svelte) {
    return factField("Svelte", "package.json dependencies.svelte");
  }
  if (repoSnapshot.files.includes("index.html")) {
    return factField("HTML entry", "repo root index.html");
  }
  return unknownField();
}

function deriveRenderingMode(combinedText, repoSnapshot, dependencies) {
  if (dependencies.phaser) {
    return factField("Phaser (Canvas/WebGL)", "package.json dependencies.phaser");
  }
  if (dependencies["pixi.js"] || dependencies.pixi) {
    return factField("PixiJS (WebGL/Canvas)", "package.json pixi dependency");
  }
  if (dependencies.three) {
    return factField("Three.js (WebGL)", "package.json dependencies.three");
  }
  if (containsAny(combinedText, ["canvas", "html canvas"])) {
    return declaredField("HTML Canvas", "README");
  }
  if (repoSnapshot.files.includes("index.html") || repoSnapshot.directories.includes("public")) {
    return factField("DOM UI / unknown", "repo html entry");
  }
  return unknownField();
}

function deriveUiTech(repoSnapshot, dependencies) {
  if (dependencies.react) {
    return factField("React UI", "package.json dependencies.react");
  }
  if (dependencies.vue) {
    return factField("Vue UI", "package.json dependencies.vue");
  }
  if (dependencies.svelte) {
    return factField("Svelte UI", "package.json dependencies.svelte");
  }
  if (repoSnapshot.files.includes("index.html")) {
    return factField("HTML/CSS", "repo root index.html");
  }
  return unknownField();
}

function deriveStateManagement(dependencies) {
  if (dependencies.zustand) {
    return factField("Zustand", "package.json dependencies.zustand");
  }
  if (dependencies["@reduxjs/toolkit"] || dependencies.redux) {
    return factField("Redux Toolkit", "package.json redux dependency");
  }
  if (dependencies.mobx) {
    return factField("MobX", "package.json dependencies.mobx");
  }
  if (dependencies.pinia) {
    return factField("Pinia", "package.json dependencies.pinia");
  }
  return unknownField();
}

function deriveStorage(combinedText, dependencies) {
  if (dependencies.localforage) {
    return factField("localForage", "package.json dependencies.localforage");
  }
  if (dependencies["electron-store"]) {
    return factField("electron-store", "package.json dependencies.electron-store");
  }
  if (containsAny(combinedText, ["indexeddb", "localstorage", "sqlite"])) {
    return declaredField(extractFirstMatch(combinedText, ["indexeddb", "localstorage", "sqlite"]), "README");
  }
  return unknownField();
}

function deriveBuildRun(scripts) {
  const parts = [];
  ["dev", "start", "build", "test"].forEach((key) => {
    if (scripts[key]) {
      parts.push(`${key}: ${scripts[key]}`);
    }
  });
  return parts.length ? factField(parts.join(" | "), "package.json scripts") : unknownField();
}

function deriveBackend(combinedText, repoSnapshot, dependencies) {
  const hasBackendDir = repoSnapshot.directories.some((name) => ["server", "api", "backend"].includes(name.toLowerCase()));
  const backendTech = dependencies.express
    ? "Express"
    : dependencies.fastify
      ? "Fastify"
      : dependencies.koa
        ? "Koa"
        : dependencies["@nestjs/core"]
          ? "NestJS"
          : null;
  const hasBackend = hasBackendDir || !!backendTech || containsAny(combinedText, ["api", "backend", "server"]);

  return {
    exists: hasBackend ? factField("yes", hasBackendDir ? "repo backend directory" : (backendTech ? "package.json backend dependency" : "README")) : factField("no", "repo scan"),
    technology: backendTech ? factField(backendTech, "package.json backend dependency") : unknownField(),
    responsibility: containsAny(combinedText, ["api", "backend"])
      ? declaredField("README 提及后端 / API 职责", "README")
      : unknownField()
  };
}

function deriveInfrastructure(dependencies) {
  return uniqueEntries([
    dependencies.firebase ? namedEntry("Firebase", "已识别依赖", "package.json dependencies.firebase", FIELD_GROUPS.FACT) : null,
    dependencies["@supabase/supabase-js"] ? namedEntry("Supabase", "已识别依赖", "package.json dependencies.@supabase/supabase-js", FIELD_GROUPS.FACT) : null,
    dependencies.axios ? namedEntry("Axios", "已识别依赖", "package.json dependencies.axios", FIELD_GROUPS.FACT) : null,
    dependencies["socket.io"] ? namedEntry("Socket.IO", "已识别依赖", "package.json dependencies.socket.io", FIELD_GROUPS.FACT) : null
  ]);
}

function deriveGameCategory(combinedText) {
  const categories = ["idle", "fishing", "clicker", "simulation", "roguelite", "rpg", "puzzle"];
  const matched = categories.find((item) => combinedText.includes(item));
  return matched ? declaredField(matched, "README / package description") : unknownField();
}

function deriveVisualDirection(combinedText) {
  if (containsAny(combinedText, ["pixel", "pixel art", "像素"])) {
    return declaredField("像素", "README");
  }
  if (containsAny(combinedText, ["placeholder", "wireframe", "占位", "ui prototype"])) {
    return declaredField("UI 原型 / 占位资源", "README");
  }
  if (containsAny(combinedText, ["realistic", "写实"])) {
    return declaredField("写实", "README");
  }
  return unknownField();
}

function derivePrimaryScreens(combinedText) {
  if (containsAny(combinedText, ["hud", "inventory", "shop", "battle", "map"])) {
    return declaredField("README 提及多个主要界面", "README");
  }
  return unknownField();
}

function deriveRepoModuleMap(directories, currentWorkPackage, supplementalModules) {
  const defaults = [
    ["src", "主实现代码"],
    ["app", "应用入口与路由"],
    ["public", "静态资源与前端入口"],
    ["client", "客户端实现"],
    ["game", "游戏逻辑 / 玩法实现"],
    ["server", "后端服务"],
    ["api", "接口层"],
    ["backend", "后端实现"],
    ["assets", "资源文件"],
    ["docs", "项目文档"],
    ["tests", "测试集"],
    ["scripts", "脚本与工具链"]
  ];

  const repoModules = defaults
    .filter(([name]) => directories.includes(name))
    .map(([name, responsibility]) => ({
      id: normalizeId(name),
      name,
      responsibility,
      status: "unknown",
      source: `repo directory ${name}`,
      sourceKind: FIELD_GROUPS.FACT,
      relatedModules: []
    }));

  const modules = mergeModuleLists(repoModules, supplementalModules || []);
  return {
    modules,
    relations: uniqueEntries([
      directories.includes("src") && directories.includes("public")
        ? namedEntry("src -> public", "实现代码与静态资源协同", "repo directories", FIELD_GROUPS.FACT)
        : null,
      directories.includes("src") && directories.some((name) => ["server", "api", "backend"].includes(name))
        ? namedEntry("client -> backend", "客户端与服务端分层", "repo directories", FIELD_GROUPS.FACT)
        : null,
      directories.includes("docs")
        ? namedEntry("docs -> project", "文档支撑整体项目实现", "repo directories", FIELD_GROUPS.FACT)
        : null
    ]),
    currentWorkPackageModule: mapWorkPackageToModule(currentWorkPackage, modules),
    knownFacts: modules.map((item) => namedEntry(`模块目录 ${item.name}`, item.responsibility, item.source, item.sourceKind)),
    declaredItems: [],
    supplementalItems: [],
    needsConfirmation: uniqueStrings([
      modules.length ? null : "项目模块划分",
      currentWorkPackage ? null : "当前工作包对应模块"
    ])
  };
}

function detectGameFlag(projectBrief, repoDerived, superpowers) {
  return (
    projectBrief.projectType.value === "game" ||
    repoDerived.isGameProject ||
    superpowers.derived.projectBrief.projectType?.value === "game"
  );
}

function mapWorkPackageToModule(currentWorkPackage, modules) {
  const currentValue = String(currentWorkPackage || "").toLowerCase();
  const matched = modules.find((item) => currentValue && currentValue.includes(item.name.toLowerCase()));
  if (!matched) {
    return unknownModuleMapping(
      currentWorkPackage ? `当前工作包“${currentWorkPackage}”尚未映射到已识别模块` : "需要补充当前工作包"
    );
  }

  return {
    moduleId: matched.id,
    module_id: matched.id,
    moduleName: matched.name,
    relation: `当前工作包与模块 ${matched.name} 关键字匹配`,
    source: matched.source,
    sourceKind: matched.sourceKind
  };
}

function mergeModuleLists(primaryModules, extraModules) {
  const map = new Map();
  [...primaryModules, ...extraModules].forEach((item) => {
    if (!item || !item.name) {
      return;
    }
    const key = normalizeValue(item.name);
    if (!map.has(key)) {
      map.set(key, normalizeModule(item));
      return;
    }
    const existing = map.get(key);
    map.set(key, {
      ...existing,
      responsibility: existing.responsibility !== "unknown" ? existing.responsibility : item.responsibility,
      relatedModules: uniqueStrings([...(existing.relatedModules || []), ...(item.relatedModules || [])])
    });
  });

  return [...map.values()];
}

function normalizeModule(rawModule) {
  const moduleId = rawModule.module_id || rawModule.moduleId || rawModule.id || normalizeId(rawModule.name || rawModule.moduleName || "module");
  return {
    id: moduleId,
    module_id: moduleId,
    name: rawModule.name || rawModule.moduleName || "unknown",
    responsibility: rawModule.responsibility || rawModule.summary || (Array.isArray(rawModule.responsibilities) ? rawModule.responsibilities.join(" / ") : "unknown"),
    status: normalizeModuleStatus(rawModule.status || rawModule.implementationStatus || rawModule.scopeStatus),
    source: rawModule.source || "manual",
    source_ref: rawModule.source_ref || rawModule.source || "manual",
    confidence: rawModule.confidence || "medium",
    last_updated_at: rawModule.last_updated_at || null,
    sourceKind: normalizeSourceKind(rawModule.sourceKind || rawModule.source_kind, FIELD_GROUPS.DECLARED),
    relatedModules: normalizeStrings(rawModule.relatedModules || rawModule.related_modules)
  };
}

function normalizeModules(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter(Boolean).map(normalizeModule);
}

function normalizeModuleMapping(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return unknownModuleMapping();
  }
  return {
    moduleId: rawValue.moduleId || rawValue.module_id || null,
    module_id: rawValue.module_id || rawValue.moduleId || null,
    moduleName: rawValue.moduleName || rawValue.module_name || "unknown",
    relation: rawValue.relation || "needs_confirmation",
    source: rawValue.source || "manual",
    source_ref: rawValue.source_ref || rawValue.source || "manual",
    confidence: rawValue.confidence || "medium",
    last_updated_at: rawValue.last_updated_at || null,
    sourceKind: normalizeSourceKind(rawValue.sourceKind || rawValue.source_kind, FIELD_GROUPS.DECLARED)
  };
}

function unknownModuleMapping(relation = "needs_confirmation") {
  return {
    moduleId: null,
    module_id: null,
    moduleName: "unknown",
    relation,
    source: "needs_confirmation",
    sourceKind: FIELD_GROUPS.NEEDS_CONFIRMATION
  };
}

function normalizeField(rawField, fallback = unknownField()) {
  if (!rawField || typeof rawField !== "object") {
    return { ...fallback };
  }

  return {
    value: stringOrFallback(rawField.value, fallback.value),
    source: stringOrFallback(rawField.source, fallback.source),
    source_ref: stringOrFallback(rawField.source_ref || rawField.source, fallback.source_ref || fallback.source),
    confidence: stringOrFallback(rawField.confidence, fallback.confidence || "low"),
    last_updated_at: rawField.last_updated_at || fallback.last_updated_at || null,
    sourceKind: normalizeSourceKind(rawField.sourceKind || rawField.source_kind, fallback.sourceKind)
  };
}

function fallbackField(field) {
  return field && field.value !== "unknown" ? field : unknownField("manual");
}

function unknownField(source = "needs_confirmation") {
  return {
    value: "unknown",
    source,
    source_ref: source,
    confidence: "low",
    last_updated_at: null,
    sourceKind: FIELD_GROUPS.NEEDS_CONFIRMATION
  };
}

function factField(value, source) {
  return {
    value,
    source,
    source_ref: source,
    confidence: "high",
    last_updated_at: null,
    sourceKind: FIELD_GROUPS.FACT
  };
}

function declaredField(value, source) {
  return {
    value,
    source,
    source_ref: source,
    confidence: "medium",
    last_updated_at: null,
    sourceKind: FIELD_GROUPS.DECLARED
  };
}

function supplementalField(value, source) {
  return {
    value,
    source,
    source_ref: source,
    confidence: "low",
    last_updated_at: null,
    sourceKind: FIELD_GROUPS.SUPPLEMENTAL
  };
}

function namedEntry(label, value, source, sourceKind) {
  return {
    label,
    value,
    source,
    source_ref: source,
    confidence: sourceKind === FIELD_GROUPS.FACT ? "high" : sourceKind === FIELD_GROUPS.DECLARED ? "medium" : "low",
    last_updated_at: null,
    sourceKind
  };
}

function normalizeEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter(Boolean).map((item, index) => ({
    label: stringOrFallback(item.label || item.name, "未命名项"),
    value: stringOrFallback(item.value, "unknown"),
    source: stringOrFallback(item.source, "manual"),
    source_ref: stringOrFallback(item.source_ref || item.source, "manual"),
    confidence: stringOrFallback(item.confidence, "medium"),
    last_updated_at: item.last_updated_at || null,
    sourceKind: normalizeSourceKind(item.sourceKind || item.source_kind, FIELD_GROUPS.DECLARED)
  }));
}

function normalizeStrings(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function normalizeDefinitionOfDone(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(Boolean)
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (typeof item === "object") {
        return stringOrFallback(item.value || item.label || item.name, "");
      }

      return "";
    })
    .filter(Boolean);
}

function normalizeMatrix(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter(Boolean).map((item, index) => ({
    label: stringOrFallback(item.label, "未命名验证项"),
    status: stringOrFallback(item.status, "unknown"),
    note: stringOrFallback(item.note, ""),
    source: stringOrFallback(item.source, "manual"),
    source_ref: stringOrFallback(item.source_ref || item.source, "manual"),
    confidence: stringOrFallback(item.confidence, "medium"),
    last_updated_at: item.last_updated_at || null,
    sourceKind: normalizeSourceKind(item.sourceKind || item.source_kind, FIELD_GROUPS.DECLARED)
  }));
}

function normalizeRisks(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter(Boolean).map((item) => ({
    title: stringOrFallback(item.title, "未命名风险"),
    detail: stringOrFallback(item.detail, ""),
    level: stringOrFallback(item.level, "medium"),
    source: stringOrFallback(item.source, "manual"),
    source_ref: stringOrFallback(item.source_ref || item.source, "manual"),
    confidence: stringOrFallback(item.confidence, "medium"),
    last_updated_at: item.last_updated_at || null,
    sourceKind: normalizeSourceKind(item.sourceKind || item.source_kind, FIELD_GROUPS.DECLARED)
  }));
}

function normalizeModuleRelations(items, modules) {
  if (!Array.isArray(items)) {
    return [];
  }
  const moduleNameById = new Map((modules || []).map((item) => [item.id, item.name]));
  return items.filter(Boolean).map((item) => {
    const fromId = item.from || item.from_id || item.sourceModuleId || item.source_module_id || null;
    const toId = item.to || item.to_id || item.targetModuleId || item.target_module_id || null;
    return {
      label: `${moduleNameById.get(fromId) || fromId || "unknown"} -> ${moduleNameById.get(toId) || toId || "unknown"}`,
      value: stringOrFallback(item.type || item.relation || item.label, "related_to"),
      from: fromId,
      to: toId,
      source: stringOrFallback(item.source, "manual"),
      source_ref: stringOrFallback(item.source_ref || item.source, "manual"),
      confidence: stringOrFallback(item.confidence, "medium"),
      last_updated_at: item.last_updated_at || null,
      sourceKind: normalizeSourceKind(item.sourceKind || item.source_kind, FIELD_GROUPS.DECLARED)
    };
  });
}

function applyRelationTargetsToModules(modules, relations) {
  if (!Array.isArray(modules) || !modules.length) {
    return [];
  }
  if (!Array.isArray(relations) || !relations.length) {
    return modules;
  }

  const moduleNameById = new Map(modules.map((item) => [item.id, item.name]));
  const targetsByModuleId = new Map();
  relations.forEach((relation) => {
    if (!relation?.from || !relation?.to) {
      return;
    }
    const targetName = moduleNameById.get(relation.to) || relation.to;
    const currentTargets = targetsByModuleId.get(relation.from) || [];
    targetsByModuleId.set(relation.from, [...currentTargets, targetName]);
  });

  return modules.map((module) => ({
    ...module,
    relatedModules: uniqueStrings([
      ...(module.relatedModules || []),
      ...(targetsByModuleId.get(module.id) || [])
    ])
  }));
}

function normalizeModuleStatus(value) {
  const normalized = normalizeValue(value);
  const mapping = {
    not_started: "not_started",
    prototype: "prototype",
    in_progress: "in_progress",
    pending_validation: "pending_validation",
    done: "done",
    current_version_in_scope: "in_progress",
    candidate_for_current_version: "prototype",
    future_preparation: "not_started",
    future_version_reserved: "not_started"
  };
  const resolved = mapping[normalized] || normalized;
  return MODULE_STATUSES.has(resolved) ? resolved : "unknown";
}

function normalizeSourceKind(sourceKind, fallback = FIELD_GROUPS.DECLARED) {
  const normalized = normalizeValue(sourceKind);
  if (normalized === "fact" || normalized === "observed") return FIELD_GROUPS.FACT;
  if (normalized === "declared" || normalized === "derived") return FIELD_GROUPS.DECLARED;
  if (normalized === "supplemental") return FIELD_GROUPS.SUPPLEMENTAL;
  if (normalized === "needs_confirmation") return FIELD_GROUPS.NEEDS_CONFIRMATION;
  return fallback;
}

function uniqueEntries(items) {
  const map = new Map();
  items.filter(Boolean).forEach((item) => {
    map.set(`${item.label}:${item.value}:${item.source}`, item);
  });
  return [...map.values()];
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeModuleName(value) {
  return String(value || "")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "unknown";
}

function stringOrFallback(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function readProjectReadme(projectRoot) {
  const names = ["README.md", "README.MD", "readme.md"];
  for (const name of names) {
    const text = await readTextIfExists(path.join(projectRoot, name));
    if (text) {
      return {
        fileName: name,
        text,
        summary: extractDocSummary(text)
      };
    }
  }
  return {
    fileName: null,
    text: "",
    summary: ""
  };
}

async function safeReadJson(filePath) {
  try {
    return await readJsonIfExists(filePath);
  } catch {
    return null;
  }
}

function extractDocTitle(filePath, raw) {
  const heading = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  if (heading) {
    return heading.replace(/^#+\s*/, "").trim();
  }
  return path.basename(filePath);
}

function extractDocSummary(raw) {
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .find((item) => !item.startsWith("#"));
  return line ? truncate(line, 180) : "";
}

function truncate(value, size) {
  return value.length > size ? `${value.slice(0, size - 3)}...` : value;
}

function containsAny(haystack, terms) {
  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function extractFirstMatch(haystack, terms) {
  return terms.find((term) => haystack.includes(String(term).toLowerCase()));
}

function normalizeProjectStateSeed(rawState, displayName) {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      name: rawState?.project?.name || displayName
    },
    status: {
      versionTarget: {
        value: rawState?.status?.versionTarget?.value || "unknown",
        source: rawState?.status?.versionTarget?.source || "project_state.json"
      },
      currentStage: {
        value: rawState?.status?.currentStage?.value || "unknown",
        source: rawState?.status?.currentStage?.source || "project_state.json"
      },
      currentWorkPackage: {
        value: rawState?.status?.currentWorkPackage?.value || "unknown",
        source: rawState?.status?.currentWorkPackage?.source || "project_state.json"
      },
      consistency: {
        summary: rawState?.status?.consistency?.summary || ""
      }
    }
  };
}

function mergeScanPayload(existingValue, generatedValue) {
  if (generatedValue === undefined) {
    return existingValue;
  }
  if (existingValue === undefined || existingValue === null) {
    return generatedValue;
  }

  if (Array.isArray(generatedValue)) {
    if (!Array.isArray(existingValue) || existingValue.length === 0) {
      return generatedValue;
    }
    return existingValue;
  }

  if (typeof generatedValue !== "object" || generatedValue === null) {
    return isUnknownLike(existingValue) ? generatedValue : existingValue;
  }

  if (typeof existingValue !== "object" || existingValue === null || Array.isArray(existingValue)) {
    return generatedValue;
  }

  const result = { ...existingValue };
  for (const [key, value] of Object.entries(generatedValue)) {
    result[key] = mergeScanPayload(existingValue[key], value);
  }
  return result;
}

function countFilledScanFields(existingValue, nextValue) {
  const existingPaths = new Set();
  const nextPaths = new Set();
  collectKnownLeafPaths(existingValue, "", existingPaths);
  collectKnownLeafPaths(nextValue, "", nextPaths);
  let count = 0;
  nextPaths.forEach((key) => {
    if (!existingPaths.has(key)) {
      count += 1;
    }
  });
  return count;
}

function collectKnownLeafPaths(value, prefix, target) {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return;
    }
    value.forEach((item, index) => {
      collectKnownLeafPaths(item, `${prefix}[${index}]`, target);
    });
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) {
      return;
    }
    entries.forEach(([key, nested]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectKnownLeafPaths(nested, nextPrefix, target);
    });
    return;
  }

  if (!isUnknownLike(value)) {
    target.add(prefix);
  }
}

function isUnknownLike(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !normalized || normalized === "unknown" || normalized === "needs_confirmation";
  }
  return false;
}

function hasKnownField(field) {
  return !isUnknownLike(field?.value);
}

function hasKnownList(items) {
  return Array.isArray(items) && items.length > 0;
}

function filterResolvedNeedsConfirmation(labels, sections) {
  return uniqueStrings((labels || []).filter((label) => shouldKeepNeedsConfirmation(label, sections)));
}

function shouldKeepNeedsConfirmation(label, sections) {
  const normalized = normalizeValue(label);
  const { projectBrief, moduleMap, techStack, gameDesign, versionState } = sections;

  if (!normalized) return false;
  if (normalized.includes("终版目标")) return !hasKnownField(projectBrief.finalGoal);
  if (normalized.includes("目标效果")) return !hasKnownField(projectBrief.targetOutcome);
  if (normalized.includes("面向对象") || normalized.includes("目标体验")) return !(hasKnownField(projectBrief.targetUsers) && hasKnownField(projectBrief.targetExperience));
  if (normalized.includes("项目边界") || normalized.includes("当前做什么") || normalized.includes("不做什么")) return !(hasKnownField(projectBrief.scopeIn) && hasKnownField(projectBrief.scopeOut));
  if (normalized.includes("项目模块划分")) return !(Array.isArray(moduleMap.modules) && moduleMap.modules.length > 0);
  if (normalized.includes("当前工作包对应模块")) return isUnknownLike(moduleMap.currentWorkPackageModule?.moduleName);
  if (normalized.includes("前端") || normalized.includes("客户端技术")) return !hasKnownField(techStack.frontendClient);
  if (normalized.includes("画面显示方式")) return !hasKnownField(techStack.rendering);
  if (normalized.includes("ui 技术")) return !hasKnownField(techStack.uiTech);
  if (normalized.includes("状态管理")) return !hasKnownField(techStack.stateManagement);
  if (normalized.includes("存档方式")) return !hasKnownField(techStack.storage);
  if (normalized.includes("后端职责")) return !hasKnownField(techStack.backend?.responsibility);
  if (normalized.includes("游戏分类")) return !hasKnownField(gameDesign.gameCategory);
  if (normalized.includes("画面设计方向")) return !hasKnownField(gameDesign.visualDirection);
  if (normalized.includes("核心玩法循环")) return !hasKnownField(gameDesign.coreGameplayLoop);
  if (normalized.includes("成长循环")) return !(hasKnownField(gameDesign.progressionLoop) || hasKnownField(gameDesign.playerExperienceGoal));
  if (normalized.includes("收益循环")) return !hasKnownField(gameDesign.rewardLoop);
  if (normalized.includes("离线收益") || normalized.includes("自动化")) return !(hasKnownField(gameDesign.offlineProgression) || hasKnownField(gameDesign.automation));
  if (normalized.includes("玩家最终体验目标")) return !hasKnownField(gameDesign.playerExperienceGoal);
  if (normalized.includes("当前版本非范围")) return !hasKnownList(versionState.versionNonScope);
  if (normalized.includes("完成定义") || normalized.includes("dod")) return !hasKnownList(versionState.definitionOfDone);
  if (normalized.includes("验证矩阵")) return !hasKnownList(versionState.verificationMatrix);
  if (normalized.includes("go / no-go") || normalized.includes("go/no-go")) return !hasKnownField(versionState.goNoGoStatus);
  if (normalized.includes("blocker")) return !Array.isArray(versionState.blockers);
  return true;
}

function buildMinimumQuestions(needsConfirmation) {
  return uniqueStrings((needsConfirmation || []).slice(0, 5).map((item) => `请补充：${item}`));
}

function stripPreviewPayload(item) {
  const { nextPayload, ...rest } = item;
  return rest;
}

function collectChangedLeafPaths(existingValue, nextValue, prefix = "", results = []) {
  if (nextValue === undefined) {
    return results;
  }

  if (Array.isArray(nextValue)) {
    if (!Array.isArray(existingValue) || JSON.stringify(existingValue) !== JSON.stringify(nextValue)) {
      results.push(prefix || "root");
    }
    return results;
  }

  if (typeof nextValue === "object" && nextValue !== null) {
    const keys = new Set([
      ...Object.keys(existingValue && typeof existingValue === "object" ? existingValue : {}),
      ...Object.keys(nextValue)
    ]);
    keys.forEach((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectChangedLeafPaths(existingValue ? existingValue[key] : undefined, nextValue[key], nextPrefix, results);
    });
    return uniqueStrings(results);
  }

  if (existingValue !== nextValue) {
    results.push(prefix || "root");
  }
  return uniqueStrings(results);
}

function collectOverwrittenLeafPaths(existingValue, nextValue, prefix = "", results = []) {
  if (nextValue === undefined) {
    return results;
  }

  if (Array.isArray(nextValue)) {
    if (Array.isArray(existingValue) && JSON.stringify(existingValue) !== JSON.stringify(nextValue) && existingValue.length) {
      results.push(prefix || "root");
    }
    return results;
  }

  if (typeof nextValue === "object" && nextValue !== null) {
    Object.keys(nextValue).forEach((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectOverwrittenLeafPaths(existingValue ? existingValue[key] : undefined, nextValue[key], nextPrefix, results);
    });
    return uniqueStrings(results);
  }

  if (!isUnknownLike(existingValue) && existingValue !== nextValue) {
    results.push(prefix || "root");
  }
  return uniqueStrings(results);
}

function collectSourceKinds(value, results = new Set()) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSourceKinds(item, results));
    return [...results];
  }
  if (typeof value === "object") {
    if (value.sourceKind) {
      results.add(value.sourceKind);
    }
    Object.values(value).forEach((item) => collectSourceKinds(item, results));
    return [...results];
  }
  return [...results];
}

function normalizeMatrix(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter(Boolean).map((item, index) => ({
    label: deriveMatrixLabel(item, index),
    status: stringOrFallback(item.status, "unknown"),
    note: stringOrFallback(item.note, ""),
    source: stringOrFallback(item.source, "manual"),
    source_ref: stringOrFallback(item.source_ref || item.source, "manual"),
    confidence: stringOrFallback(item.confidence, "medium"),
    last_updated_at: item.last_updated_at || null,
    sourceKind: normalizeSourceKind(item.sourceKind || item.source_kind, FIELD_GROUPS.DECLARED)
  }));
}

function normalizeRisks(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter(Boolean).map((item, index) => ({
    title: deriveOverviewRiskTitle(item, index),
    detail: stringOrFallback(item.detail, ""),
    level: stringOrFallback(item.level, "medium"),
    source: stringOrFallback(item.source, "manual"),
    source_ref: stringOrFallback(item.source_ref || item.source, "manual"),
    confidence: stringOrFallback(item.confidence, "medium"),
    last_updated_at: item.last_updated_at || null,
    sourceKind: normalizeSourceKind(item.sourceKind || item.source_kind, FIELD_GROUPS.DECLARED)
  }));
}

function deriveMatrixLabel(item, index) {
  if (item?.label && item.label.trim()) {
    return item.label.trim();
  }
  if (item?.scenario && item.scenario.trim()) {
    return item.scenario.trim();
  }
  if (item?.checkId && item.checkId.trim()) {
    return item.checkId.trim();
  }
  if (item?.area && item.area.trim()) {
    return `${item.area.trim()} verification`;
  }
  if (item?.note && item.note.trim()) {
    return item.note.trim().slice(0, 48);
  }
  return `Validation item ${index + 1}`;
}

function deriveOverviewRiskTitle(item, index) {
  if (item?.title && item.title.trim()) {
    return item.title.trim();
  }
  if (item?.label && item.label.trim()) {
    return item.label.trim();
  }
  if (item?.riskId && item.riskId.trim()) {
    return item.riskId.trim();
  }
  if (item?.name && item.name.trim()) {
    return item.name.trim();
  }
  if (item?.detail && item.detail.trim()) {
    return item.detail.trim().slice(0, 48);
  }
  return `Risk item ${index + 1}`;
}

function shouldSuppressKnownCoexistenceConflict(conflictType, knownValues) {
  const coexistenceTypes = new Set([
    "project_type",
    "tech_frontend_client",
    "tech_rendering",
    "tech_ui",
    "tech_build_run",
    "tech_backend_exists",
    "game_playable_state",
    "version_verification_summary",
    "version_current_work_package"
  ]);

  if (!coexistenceTypes.has(conflictType)) {
    return false;
  }

  const hasRepoObserved = knownValues.some((item) => {
    const sourceKind = String(item.sourceKind || "").toLowerCase();
    return sourceKind === FIELD_GROUPS.FACT || String(item.sourceRef || "").toLowerCase().includes("repo");
  });
  const hasDeclared = knownValues.some((item) => {
    const sourceKind = String(item.sourceKind || "").toLowerCase();
    return sourceKind === FIELD_GROUPS.DECLARED || String(item.sourceRef || "").toLowerCase().includes("user_confirmed");
  });

  if (conflictType === "version_current_work_package") {
    return knownValues.some((item) => String(item.sourceRef || "").toLowerCase().includes("project_state.json"));
  }

  return hasRepoObserved && hasDeclared;
}

module.exports = {
  FIELD_GROUPS,
  ensureOverviewSourceFiles,
  previewOverviewSourceFiles,
  rebuildOverviewSourceFiles,
  normalizeDecisionLog,
  normalizeGameDesign,
  normalizeModuleMap,
  normalizeProjectBrief,
  normalizeTechStack,
  normalizeVersionState,
  readOverviewSources,
  scanProjectLayers
};
