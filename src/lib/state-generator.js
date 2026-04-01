const path = require("node:path");
const {
  CACHE_DIR,
  CONTROL_DIR_NAME,
  CURRENT_STATE_FILE_NAME,
  CURRENT_STATE_MD_FILE_NAME,
  DECISION_LOG_FILE_NAME,
  FIXED_DELIVERABLE_TEMPLATES,
  GAME_DESIGN_FILE_NAME,
  MODULE_MAP_FILE_NAME,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  RUNS_DIR_NAME,
  SCHEMA_VERSION,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME
} = require("./constants");
const {
  writeJsonAtomic,
  writeTextAtomic
} = require("./fs-utils");
const {
  appendSuperpowersMarkdownSection,
  buildSuperpowersInstructionGuidance,
  buildSuperpowersRecentEntries,
  buildSuperpowersSummaryFields
} = require("./state-generator-superpowers");
const {
  buildDecisionImpactRows,
  collectPendingDecisions
} = require("./state-generator-instruction-center");
const {
  buildWorkflowGuidanceState,
  buildWorkflowOnboardingView,
  withWorkflowGuidanceInstructionCenter
} = require("./state-generator-workflow-guidance");
const {
  buildPendingReviewModel
} = require("./state-generator-pending-review");

function buildDefaultProjectState(displayName) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      name: displayName,
      description: "Update source state here. Do not store derived dashboard cache in the repo."
    },
    status: {
      versionTarget: {
        value: "unknown",
        source: "manual",
        updatedAt: now
      },
      currentStage: {
        value: "unknown",
        source: "manual",
        updatedAt: now
      },
      currentWorkPackage: {
        value: "unknown",
        source: "manual",
        updatedAt: now
      },
      lastUpdatedAt: now,
      fixedDeliverables: FIXED_DELIVERABLE_TEMPLATES.map((item) => ({
        key: item.key,
        title: item.title,
        status: "todo",
        note: "",
        updatedAt: now
      })),
      riskFlags: [],
      consistency: {
        docs: {
          status: "unknown",
          note: "",
          updatedAt: now
        },
        code: {
          status: "unknown",
          note: "",
          updatedAt: now
        },
        tests: {
          status: "unknown",
          note: "",
          updatedAt: now
        },
        summary: ""
      }
    },
    evidence: {
      history: []
    }
  };
}

function normalizeProjectState(rawState, displayName) {
  const base = buildDefaultProjectState(displayName);
  const merged = {
    ...base,
    ...rawState,
    project: {
      ...base.project,
      ...(rawState && rawState.project ? rawState.project : {})
    },
    status: {
      ...base.status,
      ...(rawState && rawState.status ? rawState.status : {})
    },
    evidence: {
      ...base.evidence,
      ...(rawState && rawState.evidence ? rawState.evidence : {})
    }
  };

  merged.status.versionTarget = {
    ...base.status.versionTarget,
    ...(merged.status.versionTarget || {})
  };
  merged.status.currentStage = {
    ...base.status.currentStage,
    ...(merged.status.currentStage || {})
  };
  merged.status.currentWorkPackage = {
    ...base.status.currentWorkPackage,
    ...(merged.status.currentWorkPackage || {})
  };
  merged.status.consistency = {
    ...base.status.consistency,
    ...(merged.status.consistency || {})
  };

  ["docs", "code", "tests"].forEach((key) => {
    merged.status.consistency[key] = {
      ...base.status.consistency[key],
      ...(merged.status.consistency[key] || {})
    };
  });

  const deliverables = Array.isArray(merged.status.fixedDeliverables)
    ? merged.status.fixedDeliverables
    : [];

  merged.status.fixedDeliverables = FIXED_DELIVERABLE_TEMPLATES.map((template) => {
    const existing = deliverables.find((item) => item && item.key === template.key);
    return {
      key: template.key,
      title: template.title,
      status: "todo",
      note: "",
      updatedAt: merged.status.lastUpdatedAt,
      ...(existing || {})
    };
  });

  merged.status.riskFlags = Array.isArray(merged.status.riskFlags)
    ? merged.status.riskFlags
    : [];
  merged.evidence.history = Array.isArray(merged.evidence.history)
    ? merged.evidence.history
    : [];

  return merged;
}

function buildCurrentState(projectRecord, projectState, repoFacts, conflicts, overviewSources) {
  const recentChangeSummaries = buildSuperpowersRecentEntries(
    overviewSources,
    buildRecentChangeSummaries(projectState, repoFacts),
    repoFacts
  );
  const mergedRisks = mergeRisks(overviewSources.versionState.keyRisks, projectState.status.riskFlags);
  const basePendingReview = buildPendingReviewModel({
    conflicts,
    currentSliceModule: overviewSources.versionState.currentSliceModule,
    mergedRisks,
    needsConfirmation: overviewSources.needsConfirmation,
    overviewSources,
    verificationMatrix: overviewSources.versionState.verificationMatrix
  });
  const summary = buildSummary(projectState, repoFacts, conflicts, overviewSources, recentChangeSummaries, basePendingReview);
  const baseInstructionCenter = buildInstructionCenter(projectState, overviewSources, conflicts, summary);
  const workflowGuidanceState = buildWorkflowGuidanceState(
    projectRecord,
    overviewSources,
    conflicts,
    summary,
    baseInstructionCenter
  );
  const pendingReview = buildPendingReviewModel({
    conflicts,
    currentSliceModule: overviewSources.versionState.currentSliceModule,
    mergedRisks,
    needsConfirmation: overviewSources.needsConfirmation,
    overviewSources,
    verificationMatrix: overviewSources.versionState.verificationMatrix,
    workflowGuidance: workflowGuidanceState.guidance
  });
  const instructionCenter = withWorkflowGuidanceInstructionCenter(
    baseInstructionCenter,
    workflowGuidanceState.guidance
  );
  const onboarding = buildWorkflowOnboardingView(
    projectRecord,
    buildOnboardingView(projectRecord),
    workflowGuidanceState.guidance
  );
  Object.assign(summary, workflowGuidanceState.summaryFields, {
    sourceConflictCount: pendingReview.conflictCount,
    pendingReviewCount: pendingReview.count
  });
  const cachePaths = buildCachePaths(projectRecord.id);
  const detail = buildDetail(
    projectRecord,
    projectState,
    repoFacts,
    conflicts,
    overviewSources,
    recentChangeSummaries,
    cachePaths,
    summary,
    pendingReview,
    instructionCenter,
    onboarding
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    project: {
      id: projectRecord.id,
      name: projectRecord.name,
      rootPath: projectRecord.rootPath,
      sourceControlDir: path.join(projectRecord.rootPath, CONTROL_DIR_NAME),
      cacheDir: cachePaths.cacheDir
    },
    summary,
    detail
  };
}

function buildRecentChangeSummaries(projectState, repoFacts) {
  const declaredHistory = [...projectState.evidence.history]
    .filter((entry) => entry && (entry.type === "run" || entry.type === "diff"))
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

  return declaredHistory.length
    ? declaredHistory.slice(0, 2)
    : (repoFacts.recentChangeSummaries || []);
}

function buildSummary(projectState, repoFacts, conflicts, overviewSources, recentChangeSummaries, pendingReview) {
  const projectBrief = overviewSources.projectBrief;
  const versionState = overviewSources.versionState;
  const moduleMap = overviewSources.moduleMap;
  const techStack = overviewSources.techStack;
  const gameDesign = overviewSources.gameDesign;
  const keyRisk = pickPrimaryRisk(versionState.keyRisks, projectState.status.riskFlags);
  const currentAction = deriveCurrentActionAnalysis(projectState, overviewSources, conflicts);
  const superpowersFields = buildSuperpowersSummaryFields(overviewSources);

  return {
    oneLineDefinition: projectBrief.oneLineDefinition.value,
    projectType: projectBrief.projectType.value,
    finalGoal: projectBrief.finalGoal.value,
    overallCompletion: stageCompletionLabel(versionState.currentStage.value || projectState.status.currentStage.value),
    versionTarget: versionState.versionTarget.value || projectState.status.versionTarget.value,
    currentStage: versionState.currentStage.value || projectState.status.currentStage.value,
    currentWorkPackage: versionState.currentWorkPackage.value || projectState.status.currentWorkPackage.value,
    lastUpdatedAt: projectState.status.lastUpdatedAt || repoFacts.latestSourceUpdateAt,
    riskLevel: pickRiskLevel(versionState.keyRisks, projectState.status.riskFlags),
    keyRisk: keyRisk ? keyRisk.title : "unknown",
    blockersCount: versionState.blockers.length,
    currentActionState: currentAction.state,
    currentActionReasons: currentAction.reasons,
    secondaryConditions: currentAction.secondaryConditions,
    conflictsCount: conflicts.length,
    sourceConflictCount: pendingReview.conflictCount,
    pendingReviewCount: pendingReview.count,
    moduleCount: moduleMap.modules.length,
    moduleNames: moduleMap.modules.map((item) => item.name),
    techStackSummary: buildTechStackSummary(techStack),
    gameCategorySummary: overviewSources.isGameProject ? gameDesign.gameCategory.value : "not_applicable",
    gameplaySummary: overviewSources.isGameProject ? gameDesign.coreGameplayLoop.value : "not_applicable",
    superpowersStatus: overviewSources.superpowers.status,
    recentSummaryTitle: determineRecentSummaryTitle(recentChangeSummaries),
    ...superpowersFields,
    consistencyMode: repoFacts.verifiedConsistency ? "declared_with_verified" : "declared_only",
    stateSources: {
      declared: "repo source state files",
      verified: repoFacts.verifiedConsistency ? "verified" : "not_available",
      derivedCache: "data/cache/<project-id>/current_state.*",
      supplemental: overviewSources.superpowers.status === "not_used" ? "not_used" : "docs/superpowers/specs|plans"
    }
  };
}

function buildDetail(
  projectRecord,
  projectState,
  repoFacts,
  conflicts,
  overviewSources,
  recentChangeSummaries,
  cachePaths,
  summary,
  pendingReview,
  instructionCenter,
  onboarding
) {
  const navigation = buildNavigation(overviewSources);
  const visualizations = buildVisualizations(projectRecord, projectState, overviewSources, recentChangeSummaries, conflicts, summary);
  const versionRef = buildVersionRef(overviewSources.versionState);
  const sliceRef = buildSliceRef(overviewSources.versionState);
  return {
    baseline: {
      projectBrief: overviewSources.projectBrief,
      moduleMap: overviewSources.moduleMap,
      techStack: overviewSources.techStack,
      gameDesign: overviewSources.gameDesign,
      decisionLog: overviewSources.decisionLog,
      isGameProject: overviewSources.isGameProject
    },
    versionControl: {
      versionState: overviewSources.versionState
    },
    executionEvidence: {
      fixedDeliverables: projectState.status.fixedDeliverables,
      recentChangeSummaries,
      recentSummaryTitle: determineRecentSummaryTitle(recentChangeSummaries),
      declaredState: {
        versionTarget: projectState.status.versionTarget,
        currentStage: projectState.status.currentStage,
        currentWorkPackage: projectState.status.currentWorkPackage,
        lastUpdatedAt: projectState.status.lastUpdatedAt
      },
      consistency: {
        declared: projectState.status.consistency,
        verified: repoFacts.verifiedConsistency || null,
        mode: repoFacts.verifiedConsistency ? "declared_with_verified" : "declared_only"
      }
    },
    superpowers: overviewSources.superpowers,
    currentActionState: summary.currentActionState,
    currentActionReasons: summary.currentActionReasons,
    secondaryConditions: summary.secondaryConditions,
    pendingReview,
    actionBoundaries: buildActionBoundaryModel(),
    entityRefs: {
      version: {
        ...versionRef,
        source_ref: overviewSources.versionState.versionTarget.source,
        confidence: confidenceFromField(overviewSources.versionState.versionTarget),
        last_updated_at: projectState.status.lastUpdatedAt || repoFacts.latestSourceUpdateAt
      },
      workPackage: {
        ...sliceRef,
        source_ref: overviewSources.versionState.currentWorkPackage.source,
        confidence: confidenceFromField(overviewSources.versionState.currentWorkPackage),
        last_updated_at: projectState.status.lastUpdatedAt || repoFacts.latestSourceUpdateAt
      },
      modules: overviewSources.moduleMap.modules.map((module) => ({
        module_id: module.id,
        label: module.name,
        source_ref: module.source,
        confidence: confidenceFromSourceKind(module.sourceKind),
        last_updated_at: projectState.status.lastUpdatedAt || repoFacts.latestSourceUpdateAt
      })),
      decisions: overviewSources.decisionLog.decisions.map((decision) => ({
        decision_id: decision.id,
        label: decision.title,
        source_ref: decision.source_ref || decision.source || "manual",
        confidence: decision.confidence || "medium",
        last_updated_at: decision.last_updated_at || decision.decidedAt || projectState.status.lastUpdatedAt || repoFacts.latestSourceUpdateAt,
        related_modules: decision.related_modules || [],
        related_versions: decision.related_versions || [],
        related_risks: decision.related_risks || []
      }))
    },
    visualizations,
    navigation,
    views: buildViews(
      projectRecord,
      projectState,
      repoFacts,
      conflicts,
      overviewSources,
      recentChangeSummaries,
      cachePaths,
      summary,
      visualizations,
      pendingReview,
      instructionCenter,
      onboarding
    ),
    sourceMarkers: buildSourceMarkers(projectRecord, cachePaths, overviewSources),
    sourcePriority: overviewSources.sourcePriority,
    repoFacts,
    conflicts,
    artifacts: buildArtifacts(projectRecord, cachePaths),
    layers: {
      entryWorkflows: navigation[0],
      overallCognition: navigation[1],
      currentControl: navigation[2],
      executionEvidence: navigation[3]
    }
  };
}

function buildNavigation(overviewSources) {
  const intakeItems = [
    { id: "new-project-filing", label: "新项目建档" },
    { id: "existing-project-recovery", label: "已有项目恢复" },
    { id: "gpt-assist", label: "GPT 辅助整理" }
  ];
  const cognitionItems = [
    { id: "overview", label: "项目总览" },
    { id: "project-panorama", label: "项目全景图" },
    { id: "definition", label: "项目定义" },
    { id: "modules", label: "模块地图" },
    { id: "module-dependency", label: "模块与依赖" },
    { id: "tech", label: "技术架构" }
  ];
  if (overviewSources.isGameProject) {
    cognitionItems.push({ id: "game", label: "游戏设计" });
    cognitionItems.push({ id: "game-loop", label: "游戏循环" });
  }
  cognitionItems.push({ id: "decisions", label: "决策记录" });

  return [
    {
      id: "entry-workflows",
      label: "接入与整理入口",
      items: intakeItems
    },
    {
      id: "overall-cognition",
      label: "整体认知层",
      items: cognitionItems
    },
    {
      id: "current-control",
      label: "当前控制层",
      items: [
        { id: "version-cockpit", label: "版本驾驶舱" },
        { id: "current-slice", label: "当前阶段与当前切片" },
        { id: "version-slice", label: "版本与切片" },
        { id: "scope-boundary", label: "范围边界" },
        { id: "verification-matrix", label: "验证矩阵" },
        { id: "risk-blockers", label: "风险与阻塞" },
        { id: "instruction-center", label: "指令中心" }
      ]
    },
    {
      id: "execution-evidence",
      label: "执行证据层",
      items: [
        { id: "deliverables", label: "固定交付 10 项" },
        { id: "recent-changes", label: "最近两次变更摘要" },
        { id: "status-sources", label: "状态来源说明" },
        { id: "diagnostics", label: "接入诊断" },
        { id: "runtime", label: "运行环境" },
        { id: "onboarding", label: "接入与运行" }
      ]
    }
  ];
}

function buildViews(
  projectRecord,
  projectState,
  repoFacts,
  conflicts,
  overviewSources,
  recentChangeSummaries,
  cachePaths,
  summary,
  visualizations,
  pendingReview,
  instructionCenter,
  onboarding
) {
  const projectBrief = overviewSources.projectBrief;
  const versionState = overviewSources.versionState;
  const moduleMap = overviewSources.moduleMap;
  const techStack = overviewSources.techStack;
  const gameDesign = overviewSources.gameDesign;

  return {
    overview: {
      layer: "overall-cognition",
      title: "项目总览",
      projectName: projectRecord.name,
      oneLineDefinition: projectBrief.oneLineDefinition,
      projectType: projectBrief.projectType,
      overallCompletion: summary.overallCompletion,
      finalGoal: projectBrief.finalGoal,
      versionTarget: versionState.versionTarget,
      currentStage: versionState.currentStage,
      currentWorkPackage: versionState.currentWorkPackage,
      currentActionState: summary.currentActionState,
      currentActionReasons: summary.currentActionReasons,
      secondaryConditions: summary.secondaryConditions,
      pendingReview,
      mainRisk: pickPrimaryRisk(versionState.keyRisks, projectState.status.riskFlags),
      keyOpenQuestion: overviewSources.needsConfirmation[0] || findDeliverableNote(projectState.status.fixedDeliverables, "open_issues"),
      moduleSummary: {
        count: moduleMap.modules.length,
        modules: moduleMap.modules.slice(0, 6)
      },
      techStackSummary: buildTechSummaryEntries(techStack),
      gameSummary: overviewSources.isGameProject ? { category: gameDesign.gameCategory, coreLoop: gameDesign.coreGameplayLoop } : null,
      superpowers: buildSuperpowersBadge(overviewSources.superpowers)
    },
    projectPanorama: {
      layer: "overall-cognition",
      title: "项目全景图",
      diagramIds: ["project_panorama"],
      relatedSummary: {
        currentActionState: summary.currentActionState,
        currentVersionTarget: versionState.versionTarget.value,
        currentModule: versionState.currentSliceModule.moduleName
      }
    },
    definition: {
      layer: "overall-cognition",
      title: "项目定义",
      oneLineDefinition: projectBrief.oneLineDefinition,
      finalGoal: projectBrief.finalGoal,
      currentVersionTarget: versionState.versionTarget,
      targetOutcome: projectBrief.targetOutcome,
      audienceExperience: mergeAudienceExperience(projectBrief),
      scopeIn: projectBrief.scopeIn,
      scopeOut: projectBrief.scopeOut,
      knownFacts: overviewSources.knownFacts,
      declaredItems: overviewSources.declaredItems,
      supplementalItems: overviewSources.supplementalItems,
      needsConfirmation: overviewSources.needsConfirmation
    },
    modules: {
      layer: "overall-cognition",
      title: "模块地图",
      modules: moduleMap.modules,
      relations: moduleMap.relations,
      currentWorkPackageModule: versionState.currentSliceModule,
      currentWorkPackage: versionState.currentWorkPackage,
      unknowns: moduleMap.needsConfirmation
    },
    techArchitecture: {
      layer: "overall-cognition",
      title: "技术架构",
      frontendClient: techStack.frontendClient,
      rendering: techStack.rendering,
      uiTech: techStack.uiTech,
      stateManagement: techStack.stateManagement,
      storage: techStack.storage,
      buildRun: techStack.buildRun,
      backend: techStack.backend,
      infrastructure: techStack.infrastructure,
      knownFacts: techStack.knownFacts,
      supplementalItems: techStack.supplementalItems,
      needsConfirmation: techStack.needsConfirmation
    },
    gameDesign: {
      layer: "overall-cognition",
      visible: overviewSources.isGameProject,
      title: "游戏设计",
      gameCategory: gameDesign.gameCategory,
      coreGameplayLoop: gameDesign.coreGameplayLoop,
      progressionLoop: gameDesign.progressionLoop,
      rewardLoop: gameDesign.rewardLoop,
      offlineProgression: gameDesign.offlineProgression,
      automation: gameDesign.automation,
      visualDirection: gameDesign.visualDirection,
      primaryScreens: gameDesign.primaryScreens,
      playerExperienceGoal: gameDesign.playerExperienceGoal,
      currentPlayableState: gameDesign.currentPlayableState,
      needsConfirmation: gameDesign.needsConfirmation
    },
    decisions: {
      layer: "overall-cognition",
      title: "决策记录",
      decisions: overviewSources.decisionLog.decisions
    },
    moduleDependency: {
      layer: "overall-cognition",
      title: "模块与依赖",
      diagramIds: ["module_structure", "module_dependency"],
      relatedSummary: {
        modules: overviewSources.moduleMap.modules.map((item) => item.name),
        blockers: overviewSources.versionState.blockers.map((item) => item.label || item.value)
      }
    },
    versionCockpit: {
      layer: "current-control",
      title: "版本驾驶舱",
      versionTarget: versionState.versionTarget,
      versionNonScope: versionState.versionNonScope,
      definitionOfDone: versionState.definitionOfDone,
      keyRisks: versionState.keyRisks,
      blockers: versionState.blockers,
      goNoGoStatus: versionState.goNoGoStatus,
      currentStage: versionState.currentStage,
      currentWorkPackage: versionState.currentWorkPackage,
      currentSliceModule: versionState.currentSliceModule,
      currentActionState: summary.currentActionState,
      currentActionReasons: summary.currentActionReasons,
      secondaryConditions: summary.secondaryConditions,
      pendingReview,
      superpowers: buildSuperpowersBadge(overviewSources.superpowers)
    },
    currentSlice: {
      layer: "current-control",
      title: "当前阶段与当前切片",
      currentVersionTarget: versionState.versionTarget,
      currentStage: versionState.currentStage,
      currentWorkPackage: versionState.currentWorkPackage,
      currentSliceModule: versionState.currentSliceModule,
      currentSliceGoalLink: deriveProjectGoalLink(projectBrief, versionState),
      completionImpact: deriveSliceImpact(versionState, moduleMap),
      fixedDeliverables: projectState.status.fixedDeliverables,
      recentChangeSummaries
    },
    versionSlice: {
      layer: "current-control",
      title: "版本与切片",
      diagramIds: ["version_roadmap", "current_slice_position"],
      relatedSummary: {
        currentActionState: summary.currentActionState,
        blockers: versionState.blockers.map((item) => item.label || item.value),
        risks: mergeRisks(versionState.keyRisks, projectState.status.riskFlags).map((item) => item.title)
      }
    },
    scopeBoundary: {
      layer: "current-control",
      title: "范围边界",
      finalGoal: projectBrief.finalGoal,
      scopeIn: projectBrief.scopeIn,
      scopeOut: projectBrief.scopeOut,
      versionNonScope: versionState.versionNonScope,
      currentVersionTarget: versionState.versionTarget
    },
    verificationMatrix: {
      layer: "current-control",
      title: "验证矩阵",
      verificationSummary: versionState.verificationSummary,
      verificationMatrix: versionState.verificationMatrix,
      goNoGoStatus: versionState.goNoGoStatus,
      consistency: {
        declared: projectState.status.consistency,
        verified: repoFacts.verifiedConsistency || null,
        mode: repoFacts.verifiedConsistency ? "declared_with_verified" : "declared_only"
      }
    },
    riskBlockers: {
      layer: "current-control",
      title: "风险与阻塞",
      risks: mergeRisks(versionState.keyRisks, projectState.status.riskFlags),
      blockers: versionState.blockers,
      conflicts,
      sourceConflictCount: conflicts.length,
      unknowns: collectUnknownFields(overviewSources),
      pendingDecisions: collectPendingDecisions(overviewSources.decisionLog),
      decisionImpacts: buildDecisionImpactRows(overviewSources.decisionLog),
      declaredNotVerified: [
        "Current version target / stage / work package are declared unless explicitly verified.",
        "Docs / code / tests consistency is declared unless explicitly verified."
      ]
    },
    instructionCenter,
    deliverables: {
      layer: "execution-evidence",
      title: "固定交付 10 项",
      fixedDeliverables: projectState.status.fixedDeliverables
    },
    recentChanges: {
      layer: "execution-evidence",
      title: determineRecentSummaryTitle(recentChangeSummaries),
      entries: recentChangeSummaries
    },
    statusSources: {
      layer: "execution-evidence",
      title: "状态来源说明",
      markers: buildSourceMarkers(projectRecord, cachePaths, overviewSources),
      sourcePriority: overviewSources.sourcePriority,
      factVsDeclaration: {
        knownFacts: "Based on repo-verifiable structure or explicit files.",
        declared: "Project-side source files or repo documents describing intended state.",
        supplemental: "Optional evidence from docs/superpowers/specs and plans.",
        needsConfirmation: "Still unknown and should not be treated as verified fact."
      },
      superpowers: buildSuperpowersBadge(overviewSources.superpowers),
      actionBoundaries: buildActionBoundaryModel()
    },
    gameLoop: {
      layer: "overall-cognition",
      visible: overviewSources.isGameProject,
      title: "游戏循环",
      diagramIds: ["game_loop"],
      relatedSummary: {
        category: overviewSources.gameDesign.gameCategory.value,
        playable: overviewSources.gameDesign.currentPlayableState.value
      }
    },
    onboarding
  };
}

function buildSourceMarkers(projectRecord, cachePaths, overviewSources) {
  const declaredFiles = [
    path.join(projectRecord.rootPath, CONTROL_DIR_NAME, PROJECT_STATE_FILE_NAME),
    path.join(projectRecord.rootPath, CONTROL_DIR_NAME, PROJECT_BRIEF_FILE_NAME),
    path.join(projectRecord.rootPath, CONTROL_DIR_NAME, MODULE_MAP_FILE_NAME),
    path.join(projectRecord.rootPath, CONTROL_DIR_NAME, TECH_STACK_FILE_NAME),
    path.join(projectRecord.rootPath, CONTROL_DIR_NAME, VERSION_STATE_FILE_NAME),
    path.join(projectRecord.rootPath, CONTROL_DIR_NAME, DECISION_LOG_FILE_NAME)
  ];

  if (overviewSources.files.gameDesign.exists) {
    declaredFiles.push(overviewSources.files.gameDesign.path);
  }

  const supplementalFiles = [];
  if (overviewSources.superpowers.hasSpecs) {
    supplementalFiles.push("docs/superpowers/specs/**");
  }
  if (overviewSources.superpowers.hasPlans) {
    supplementalFiles.push("docs/superpowers/plans/**");
  }

  return [
    {
      label: "declared",
      meaning: "Source state declared by project-side control files.",
      files: declaredFiles
    },
    {
      label: "verified",
      meaning: "Only used when the dashboard has run an explicit verification pass.",
      files: []
    },
    {
      label: "derived/cache",
      meaning: "Dashboard-local cache. Never written back into the monitored repo during steady state.",
      files: [cachePaths.currentStateJsonPath, cachePaths.currentStateMarkdownPath]
    },
    {
      label: "supplemental",
      meaning: "Optional supporting evidence. Not treated as the only source of truth.",
      files: supplementalFiles
    }
  ];
}

function buildActionBoundaryModel() {
  return [
    {
      id: "initialization_write",
      label: "初始化接入写入",
      scope: "创建 .codex-control、源状态模板、稳定规则块",
      mode: "repo_write",
      trigger: "add_project"
    },
    {
      id: "explicit_maintenance_write",
      label: "用户显式维护写入",
      scope: "如 rebuild-profile，仅更新项目控制源文件，不修改业务代码",
      mode: "repo_write",
      trigger: "user_confirmed_maintenance"
    },
    {
      id: "steady_state_readonly",
      label: "日常自动聚合只读",
      scope: "watcher / polling / refresh 仅读取 AGENTS.md、.codex-control/** 与可选 supplemental",
      mode: "repo_read_only",
      trigger: "automatic_aggregation"
    }
  ];
}

function deriveCurrentActionAnalysis(projectState, overviewSources, conflicts) {
  const reasons = [];
  const missingBaselineItems = [];
  const missingVersionItems = [];
  const blockers = overviewSources.versionState.blockers || [];
  const highConflicts = (conflicts || []).filter((item) => item.level === "high");
  const goNoGoValue = normalizeValue(overviewSources.versionState.goNoGoStatus.value);
  const stageValue = normalizeValue(overviewSources.versionState.currentStage.value || projectState.status.currentStage.value);
  const noGo = isExplicitNoGo(goNoGoValue);
  const blueprintStage = isBlueprintStage(stageValue);
  const pendingDecisions = collectPendingDecisions(overviewSources.decisionLog);
  const unresolvedValidation = projectState.status.fixedDeliverables.filter((item) => {
    return ["test_results", "documentation_updates", "open_issues", "residual_risks"].includes(item.key) && item.status !== "done";
  });
  const conditions = [];

  if (overviewSources.projectBrief.oneLineDefinition.value === "unknown") {
    missingBaselineItems.push("project one-line definition");
  }
  if (overviewSources.projectBrief.finalGoal.value === "unknown") {
    missingBaselineItems.push("final goal");
  }
  if (!overviewSources.moduleMap.modules.length) {
    missingBaselineItems.push("module map");
  }
  if (overviewSources.techStack.frontendClient.value === "unknown") {
    missingBaselineItems.push("frontend/client stack");
  }

  if (overviewSources.versionState.versionTarget.value === "unknown") {
    missingVersionItems.push("current version target");
  }
  if (!overviewSources.versionState.definitionOfDone.length) {
    missingVersionItems.push("definition of done");
  }
  if (!overviewSources.versionState.verificationMatrix.length) {
    missingVersionItems.push("verification matrix");
  }
  if (overviewSources.versionState.currentSliceModule.moduleName === "unknown") {
    missingVersionItems.push("current slice -> module mapping");
  }

  if (missingBaselineItems.length) {
    conditions.push("needs_baseline");
  }
  if (missingVersionItems.length) {
    conditions.push("needs_version_definition");
  }
  if (blockers.length) {
    conditions.push("blocked");
  }
  if (noGo || highConflicts.length || pendingDecisions.length) {
    conditions.push("needs_human_decision");
  }
  if (!blueprintStage && unresolvedValidation.length) {
    conditions.push("needs_validation");
  }

  if (missingBaselineItems.length) {
    reasons.push(`Missing baseline information: ${missingBaselineItems.slice(0, 3).join(", ")}`);
  }

  if (missingVersionItems.length) {
    reasons.push(`Missing version definition: ${missingVersionItems.slice(0, 3).join(", ")}`);
  }

  if (blockers.length) {
    reasons.push(`Active blockers: ${blockers.slice(0, 2).map((item) => item.label || item.value || "unknown").join(", ")}`);
  }

  if (noGo) {
    reasons.push(`Current go / no-go is ${overviewSources.versionState.goNoGoStatus.value}.`);
  }

  if (highConflicts.length) {
    reasons.push(`High-severity conflicts detected: ${highConflicts.slice(0, 2).map((item) => item.type || item.message).join(", ")}`);
  }
  if (pendingDecisions.length) {
    reasons.push(`Pending decisions still unresolved: ${pendingDecisions.slice(0, 2).map((item) => item.title).join(", ")}`);
  }

  if (!blueprintStage && unresolvedValidation.length) {
    reasons.push(`Validation evidence still incomplete: ${unresolvedValidation.slice(0, 3).map((item) => item.title).join(", ")}`);
  }
  if (!conditions.length) {
    reasons.push("Baseline, version boundary, current slice mapping, and validation evidence are present enough for the next implementation instruction.");
  }

  const primaryState = conditions[0] || "ready_for_implementation";
  return {
    state: primaryState,
    reasons: reasons.slice(0, 5),
    secondaryConditions: conditions.filter((item) => item !== primaryState)
  };
}

function deriveCurrentActionState(projectState, overviewSources, conflicts) {
  return deriveCurrentActionAnalysis(projectState, overviewSources, conflicts).state;
}

function buildVisualizations(projectRecord, projectState, overviewSources, recentChangeSummaries, conflicts, summary) {
  const diagrams = [
    buildProjectPanoramaDiagram(projectRecord, overviewSources, conflicts, summary),
    buildModuleStructureDiagram(overviewSources),
    buildModuleDependencyDiagram(overviewSources),
    buildVersionRoadmapDiagram(overviewSources),
    buildCurrentSliceDiagram(overviewSources, projectState),
    buildGameLoopDiagram(overviewSources)
  ].filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    cacheBoundary: {
      isolatedUnderCurrentState: true,
      splitReadyPath: `data/cache/${projectRecord.id}/visualizations.json`
    },
    diagrams,
    byId: Object.fromEntries(diagrams.map((diagram) => [diagram.id, diagram])),
    recentEvidence: recentChangeSummaries.map((item) => ({
      id: item.id,
      title: item.title || item.id,
      type: item.type,
      createdAt: item.createdAt
    }))
  };
}

function buildProjectPanoramaDiagram(projectRecord, overviewSources, conflicts, summary) {
  const versionRef = buildVersionRef(overviewSources.versionState);
  const sliceRef = buildSliceRef(overviewSources.versionState);
  const missingFields = [];
  const omittedNodes = [];
  const omittedEdges = [];
  const sourceUpdatedAt = latestFieldTimestamp([
    overviewSources.projectBrief.finalGoal,
    overviewSources.versionState.versionTarget,
    overviewSources.versionState.currentWorkPackage
  ]) || summary.lastUpdatedAt;
  const nodes = [
    buildNode(projectRecord.id, projectRecord.name, "project", "ready", "fact", "high", projectRecord.rootPath),
    buildNode("final-goal", overviewSources.projectBrief.finalGoal.value, "goal", statusFromField(overviewSources.projectBrief.finalGoal), kindFromField(overviewSources.projectBrief.finalGoal), confidenceFromField(overviewSources.projectBrief.finalGoal), overviewSources.projectBrief.finalGoal.source, "", {
      related_versions: [versionRef.version_id]
    }),
    buildNode(versionRef.version_id, overviewSources.versionState.versionTarget.value, "version", statusFromField(overviewSources.versionState.versionTarget), kindFromField(overviewSources.versionState.versionTarget), confidenceFromField(overviewSources.versionState.versionTarget), overviewSources.versionState.versionTarget.source, "", {
      related_versions: [versionRef.version_id],
      related_work_packages: [sliceRef.work_package_id]
    }),
    buildNode(sliceRef.work_package_id, overviewSources.versionState.currentWorkPackage.value, "slice", statusFromField(overviewSources.versionState.currentWorkPackage), kindFromField(overviewSources.versionState.currentWorkPackage), confidenceFromField(overviewSources.versionState.currentWorkPackage), overviewSources.versionState.currentWorkPackage.source, "", {
      related_versions: [versionRef.version_id],
      related_work_packages: [sliceRef.work_package_id]
    })
  ];

  if (overviewSources.projectBrief.finalGoal.value === "unknown") {
    missingFields.push("final goal");
  }
  if (overviewSources.versionState.versionTarget.value === "unknown") {
    missingFields.push("current version target");
  }
  if (overviewSources.versionState.currentWorkPackage.value === "unknown") {
    missingFields.push("current work package");
  }

  overviewSources.moduleMap.modules.slice(0, 6).forEach((module) => {
    nodes.push(buildNode(module.id, module.name, "module", module.status, module.sourceKind, confidenceFromSourceKind(module.sourceKind), module.source, module.responsibility, {
      related_modules: [module.id],
      related_versions: [versionRef.version_id]
    }));
  });
  if (!overviewSources.moduleMap.modules.length) {
    missingFields.push("module map");
    omittedNodes.push("module nodes");
    nodes.push(buildNode("unknown-module", "待确认模块", "module", "unknown", "needs_confirmation", "low", "module_map.json", "模块地图尚未补齐。", {
      unresolved_items: ["Module map still needs confirmation."]
    }));
  }

  const primaryRisk = summary.keyRisk && summary.keyRisk !== "unknown"
    ? buildNode("primary-risk", summary.keyRisk, "risk", summary.riskLevel, "declared", summary.riskLevel === "high" || summary.riskLevel === "critical" ? "high" : "medium", "version/project risks", "", {
      related_versions: [versionRef.version_id],
      related_work_packages: [sliceRef.work_package_id],
      related_risks: [summary.keyRisk]
    })
    : null;
  if (primaryRisk) {
    nodes.push(primaryRisk);
  } else {
    omittedNodes.push("primary risk node");
  }

  const edges = [
    buildEdge(projectRecord.id, "final-goal", "defines", "medium"),
    buildEdge("final-goal", versionRef.version_id, "targets", confidenceFromField(overviewSources.projectBrief.finalGoal)),
    buildEdge(versionRef.version_id, sliceRef.work_package_id, "contains", confidenceFromField(overviewSources.versionState.currentWorkPackage))
  ];

  const mappedModule = overviewSources.versionState.currentSliceModule.moduleId;
  if (mappedModule) {
    edges.push(buildEdge(sliceRef.work_package_id, mappedModule, "belongs_to", confidenceFromSourceKind(overviewSources.versionState.currentSliceModule.sourceKind)));
  } else {
    missingFields.push("current slice -> module mapping");
    omittedEdges.push("slice -> module");
  }
  overviewSources.moduleMap.modules.slice(0, 6).forEach((module) => {
    edges.push(buildEdge(versionRef.version_id, module.id, "advances", confidenceFromSourceKind(module.sourceKind)));
  });
  if (primaryRisk) {
    if (mappedModule) {
      edges.push(buildEdge("primary-risk", mappedModule, "impacts", summary.riskLevel === "high" || summary.riskLevel === "critical" ? "high" : "medium"));
    } else {
      edges.push(buildEdge("primary-risk", versionRef.version_id, "impacts", summary.riskLevel === "high" || summary.riskLevel === "critical" ? "high" : "medium"));
    }
  }

  return finalizeDiagram({
    id: "project_panorama",
    title: "项目全景图",
    type: "panorama",
    source_summary: [
      "project_brief.json",
      "module_map.json",
      "version_state.json",
      "project_state.json"
    ],
    nodes,
    edges,
    notes: [
      `current_action_state: ${summary.currentActionState}`,
      `conflicts: ${conflicts.length}`
    ],
    missing_fields: missingFields,
    omitted_nodes: omittedNodes,
    omitted_edges: omittedEdges,
    source_updated_at: sourceUpdatedAt,
    unresolved_items: overviewSources.needsConfirmation.slice(0, 6),
    related_refs: [versionRef.version_id, sliceRef.work_package_id, ...(mappedModule ? [mappedModule] : [])]
  });
}

function buildModuleStructureDiagram(overviewSources) {
  const missingFields = [];
  const omittedNodes = [];
  const omittedEdges = [];
  const nodes = overviewSources.moduleMap.modules.map((module) =>
    buildNode(module.id, module.name, "module", module.status, module.sourceKind, confidenceFromSourceKind(module.sourceKind), module.source, module.responsibility, {
      related_modules: [module.id]
    })
  );
  const edges = [];
  overviewSources.moduleMap.modules.forEach((module) => {
    (module.relatedModules || []).forEach((related) => {
      const target = overviewSources.moduleMap.modules.find((item) => normalizeValue(item.name) === normalizeValue(related));
      if (target) {
        edges.push(buildEdge(module.id, target.id, "related_to", confidenceFromSourceKind(module.sourceKind)));
      }
    });
  });

  if (!nodes.length) {
    missingFields.push("module map");
    nodes.push(buildNode("unknown-module", "待确认模块", "module", "unknown", "needs_confirmation", "low", "module_map.json", "尚未识别到稳定模块。"));
  }
  if (!edges.length) {
    omittedEdges.push("module relation edges");
  }

  return finalizeDiagram({
    id: "module_structure",
    title: "模块结构图",
    type: "module_structure",
    source_summary: ["module_map.json", "repo structure", overviewSources.superpowers.hasPlans ? "docs/superpowers/plans/**" : null].filter(Boolean),
    nodes,
    edges,
    notes: ["Shows identified modules, responsibilities, and current status."],
    missing_fields: missingFields,
    omitted_nodes: omittedNodes,
    omitted_edges: omittedEdges,
    source_updated_at: latestFieldTimestamp(overviewSources.moduleMap.modules.map((item) => ({ last_updated_at: item.last_updated_at }))),
    unresolved_items: overviewSources.moduleMap.needsConfirmation,
    related_refs: nodes.map((node) => node.id)
  });
}

function buildModuleDependencyDiagram(overviewSources) {
  const missingFields = [];
  const omittedNodes = [];
  const omittedEdges = [];
  const nodes = overviewSources.moduleMap.modules.map((module) =>
    buildNode(module.id, module.name, "module", module.status, module.sourceKind, confidenceFromSourceKind(module.sourceKind), module.source, module.responsibility, {
      related_modules: [module.id]
    })
  );
  const blockerNodes = overviewSources.versionState.blockers.slice(0, 4).map((item) => {
    const blockerId = `blocker-${slug(item.label || item.value || "unknown")}`;
    return buildNode(blockerId, item.label || item.value || "Unnamed blocker", "blocker", "blocked", item.sourceKind || "declared", confidenceFromSourceKind(item.sourceKind || "declared"), item.source || "version_state.json", "", {
      related_risks: [item.label || item.value || "Unnamed blocker"]
    });
  });
  const edges = [];

  overviewSources.moduleMap.modules.forEach((module) => {
    (module.relatedModules || []).forEach((related) => {
      const target = overviewSources.moduleMap.modules.find((item) => normalizeValue(item.name) === normalizeValue(related));
      if (target) {
        edges.push(buildEdge(module.id, target.id, "depends_on", confidenceFromSourceKind(module.sourceKind)));
      }
    });
  });

  blockerNodes.forEach((blocker) => {
    if (overviewSources.versionState.currentSliceModule.moduleId) {
      edges.push(buildEdge(blocker.id, overviewSources.versionState.currentSliceModule.moduleId, "blocks", "medium"));
    } else {
      omittedEdges.push("blocker -> module");
    }
  });

  if (!nodes.length) {
    missingFields.push("module map");
    nodes.push(buildNode("unknown-module", "待确认模块", "module", "unknown", "needs_confirmation", "low", "module_map.json"));
  }
  if (!blockerNodes.length) {
    omittedNodes.push("blocker nodes");
  }
  if (!edges.length) {
    missingFields.push("module dependencies");
  }

  return finalizeDiagram({
    id: "module_dependency",
    title: "依赖关系图",
    type: "dependency",
    source_summary: ["module_map.json", "version_state.json", "repo structure"],
    nodes: [...nodes, ...blockerNodes],
    edges,
    notes: ["First version shows only known dependencies and blocker propagation."],
    missing_fields: missingFields,
    omitted_nodes: omittedNodes,
    omitted_edges: omittedEdges,
    source_updated_at: latestFieldTimestamp([
      overviewSources.versionState.versionTarget,
      overviewSources.versionState.currentWorkPackage
    ]),
    unresolved_items: edges.length ? overviewSources.moduleMap.needsConfirmation.slice(0, 4) : ["Dependency information is still partial."],
    related_refs: [...nodes.map((node) => node.id), ...blockerNodes.map((node) => node.id)]
  });
}

function buildVersionRoadmapDiagram(overviewSources) {
  const versionRef = buildVersionRef(overviewSources.versionState);
  const missingFields = [];
  const omittedNodes = [];
  const omittedEdges = [];
  const nodes = [
    buildNode("final-goal", overviewSources.projectBrief.finalGoal.value, "goal", statusFromField(overviewSources.projectBrief.finalGoal), kindFromField(overviewSources.projectBrief.finalGoal), confidenceFromField(overviewSources.projectBrief.finalGoal), overviewSources.projectBrief.finalGoal.source, "", {
      related_versions: [versionRef.version_id]
    }),
    buildNode(versionRef.version_id, overviewSources.versionState.versionTarget.value, "version", statusFromField(overviewSources.versionState.versionTarget), kindFromField(overviewSources.versionState.versionTarget), confidenceFromField(overviewSources.versionState.versionTarget), overviewSources.versionState.versionTarget.source, "", {
      related_versions: [versionRef.version_id]
    })
  ];
  if (overviewSources.projectBrief.finalGoal.value === "unknown") {
    missingFields.push("final goal");
  }
  if (overviewSources.versionState.versionTarget.value === "unknown") {
    missingFields.push("current version target");
  }
  const futureEntries = overviewSources.supplementalItems
    .filter((item) => normalizeValue(item.label).includes("plan"))
    .slice(0, 2);
  futureEntries.forEach((entry, index) => {
    nodes.push(buildNode(`future-version-${index + 1}`, entry.value, "future_version", "unknown", "supplemental", "low", entry.source, "", {
      related_versions: [versionRef.version_id]
    }));
  });
  if (!futureEntries.length) {
    omittedNodes.push("future version nodes");
  }

  const edges = [buildEdge("final-goal", versionRef.version_id, "narrows_to", confidenceFromField(overviewSources.versionState.versionTarget))];
  futureEntries.forEach((entry, index) => {
    edges.push(buildEdge(versionRef.version_id, `future-version-${index + 1}`, "possible_next", "low"));
  });

  const relatedDecisions = (overviewSources.decisionLog.decisions || [])
    .filter((item) => {
      return item.related_versions?.includes(versionRef.version_id)
        || normalizeValue(item.impact).includes(normalizeValue(overviewSources.versionState.versionTarget.value));
    })
    .slice(0, 3);
  relatedDecisions.forEach((decision) => {
    nodes.push(buildNode(decision.decision_id || decision.id, decision.title, "decision", decision.status, "declared", decision.confidence || "medium", decision.source_ref || decision.source, decision.summary, {
      related_versions: decision.related_versions || [versionRef.version_id],
      related_risks: decision.related_risks || [],
      unresolved_items: decision.unresolved_items || [],
      source_files: [DECISION_LOG_FILE_NAME]
    }));
    edges.push(buildEdge(decision.decision_id || decision.id, versionRef.version_id, "impacts", decision.confidence || "medium"));
  });
  if (!relatedDecisions.length) {
    omittedNodes.push("decision nodes");
  }

  return finalizeDiagram({
    id: "version_roadmap",
    title: "版本路线图",
    type: "version_roadmap",
    source_summary: ["project_brief.json", "version_state.json", overviewSources.superpowers.hasPlans ? "docs/superpowers/plans/**" : null].filter(Boolean),
    nodes,
    edges,
    notes: [
      `DoD count: ${overviewSources.versionState.definitionOfDone.length}`,
      `Non-scope count: ${overviewSources.versionState.versionNonScope.length}`,
      `Blockers count: ${overviewSources.versionState.blockers.length}`
    ],
    missing_fields: missingFields,
    omitted_nodes: omittedNodes,
    omitted_edges: omittedEdges,
    source_updated_at: latestFieldTimestamp([
      overviewSources.projectBrief.finalGoal,
      overviewSources.versionState.versionTarget,
      overviewSources.versionState.goNoGoStatus
    ]),
    unresolved_items: overviewSources.versionState.needsConfirmation,
    related_refs: [versionRef.version_id]
  });
}

function buildCurrentSliceDiagram(overviewSources, projectState) {
  const versionRef = buildVersionRef(overviewSources.versionState);
  const sliceRef = buildSliceRef(overviewSources.versionState);
  const missingFields = [];
  const omittedNodes = [];
  const omittedEdges = [];
  const nodes = [
    buildNode(sliceRef.work_package_id, overviewSources.versionState.currentWorkPackage.value, "slice", statusFromField(overviewSources.versionState.currentWorkPackage), kindFromField(overviewSources.versionState.currentWorkPackage), confidenceFromField(overviewSources.versionState.currentWorkPackage), overviewSources.versionState.currentWorkPackage.source, "", {
      related_versions: [versionRef.version_id],
      related_work_packages: [sliceRef.work_package_id]
    }),
    buildNode(versionRef.version_id, overviewSources.versionState.versionTarget.value, "version", statusFromField(overviewSources.versionState.versionTarget), kindFromField(overviewSources.versionState.versionTarget), confidenceFromField(overviewSources.versionState.versionTarget), overviewSources.versionState.versionTarget.source, "", {
      related_versions: [versionRef.version_id],
      related_work_packages: [sliceRef.work_package_id]
    })
  ];
  if (overviewSources.versionState.currentWorkPackage.value === "unknown") {
    missingFields.push("current work package");
  }
  if (overviewSources.versionState.versionTarget.value === "unknown") {
    missingFields.push("current version target");
  }
  if (overviewSources.versionState.currentSliceModule.moduleId) {
    const module = overviewSources.moduleMap.modules.find((item) => item.id === overviewSources.versionState.currentSliceModule.moduleId);
    if (module) {
      nodes.push(buildNode(module.id, module.name, "module", module.status, module.sourceKind, confidenceFromSourceKind(module.sourceKind), module.source, module.responsibility, {
        related_modules: [module.id],
        related_versions: [versionRef.version_id],
        related_work_packages: [sliceRef.work_package_id]
      }));
    }
  } else {
    missingFields.push("current slice -> module mapping");
    omittedNodes.push("current module node");
    omittedEdges.push("slice -> module");
  }
  overviewSources.versionState.verificationMatrix.slice(0, 3).forEach((item, index) => {
    nodes.push(buildNode(`verification-${index + 1}`, item.label, "verification", item.status, item.sourceKind || "declared", confidenceFromSourceKind(item.sourceKind || "declared"), item.source || "version_state.json", item.note, {
      related_versions: [versionRef.version_id],
      related_work_packages: [sliceRef.work_package_id],
      related_validation_gaps: [item.label]
    }));
  });
  if (!overviewSources.versionState.verificationMatrix.length) {
    missingFields.push("verification matrix");
    omittedNodes.push("verification nodes");
  }
  mergeRisks(overviewSources.versionState.keyRisks, projectState.status.riskFlags).slice(0, 2).forEach((item, index) => {
    nodes.push(buildNode(`risk-${index + 1}`, item.title, "risk", item.level, "declared", item.level === "high" || item.level === "critical" ? "high" : "medium", item.source, item.detail, {
      related_versions: [versionRef.version_id],
      related_work_packages: [sliceRef.work_package_id],
      related_risks: [item.title]
    }));
  });
  if (!mergeRisks(overviewSources.versionState.keyRisks, projectState.status.riskFlags).length) {
    omittedNodes.push("risk nodes");
  }

  const edges = [buildEdge(versionRef.version_id, sliceRef.work_package_id, "contains", confidenceFromField(overviewSources.versionState.currentWorkPackage))];
  if (overviewSources.versionState.currentSliceModule.moduleId) {
    edges.push(buildEdge(sliceRef.work_package_id, overviewSources.versionState.currentSliceModule.moduleId, "belongs_to", confidenceFromSourceKind(overviewSources.versionState.currentSliceModule.sourceKind)));
  }
  nodes.filter((item) => item.kind === "verification").forEach((node) => {
    edges.push(buildEdge(sliceRef.work_package_id, node.id, "requires", node.confidence));
  });
  nodes.filter((item) => item.kind === "risk").forEach((node) => {
    edges.push(buildEdge(node.id, sliceRef.work_package_id, "impacts", node.confidence));
  });

  return finalizeDiagram({
    id: "current_slice_position",
    title: "当前切片位置图",
    type: "current_slice",
    source_summary: ["version_state.json", "project_state.json", "runs/*.json"],
    nodes,
    edges,
    notes: [deriveSliceImpact(overviewSources.versionState, overviewSources.moduleMap)],
    missing_fields: missingFields,
    omitted_nodes: omittedNodes,
    omitted_edges: omittedEdges,
    source_updated_at: latestFieldTimestamp([
      overviewSources.versionState.currentWorkPackage,
      overviewSources.versionState.versionTarget,
      { last_updated_at: projectState.status.lastUpdatedAt }
    ]),
    unresolved_items: overviewSources.versionState.currentSliceModule.moduleName === "unknown"
      ? ["Current slice -> module mapping still needs confirmation."]
      : [],
    related_refs: [versionRef.version_id, sliceRef.work_package_id]
  });
}

function buildGameLoopDiagram(overviewSources) {
  if (!overviewSources.isGameProject) {
    return null;
  }
  const missingFields = [];
  const omittedNodes = [];
  const omittedEdges = [];
  const fields = [
    ["player-action", overviewSources.gameDesign.coreGameplayLoop, "player_action"],
    ["reward", overviewSources.gameDesign.rewardLoop, "reward"],
    ["progression", overviewSources.gameDesign.progressionLoop, "progression"],
    ["offline", overviewSources.gameDesign.offlineProgression, "offline"]
  ];
  const nodes = fields.map(([id, field, kind]) => {
    if (field.value === "unknown") {
      missingFields.push(kind);
    }
    return buildNode(id, field.value, kind, statusFromField(field), kindFromField(field), confidenceFromField(field), field.source);
  });
  const edges = [
    buildEdge("player-action", "reward", "gains", confidenceFromField(overviewSources.gameDesign.rewardLoop)),
    buildEdge("reward", "progression", "upgrades", confidenceFromField(overviewSources.gameDesign.progressionLoop)),
    buildEdge("progression", "player-action", "loops_back", confidenceFromField(overviewSources.gameDesign.coreGameplayLoop))
  ];
  if (overviewSources.gameDesign.offlineProgression.value !== "unknown") {
    edges.push(buildEdge("offline", "reward", "feeds", confidenceFromField(overviewSources.gameDesign.offlineProgression)));
  } else {
    omittedEdges.push("offline -> reward");
  }

  return finalizeDiagram({
    id: "game_loop",
    title: "核心玩法循环图",
    type: "game_loop",
    source_summary: ["game_design.json", "project_brief.json", overviewSources.superpowers.hasSpecs ? "docs/superpowers/specs/**" : null].filter(Boolean),
    nodes,
    edges,
    notes: ["Only shown for projects identified as games."],
    missing_fields: missingFields,
    omitted_nodes: omittedNodes,
    omitted_edges: omittedEdges,
    source_updated_at: latestFieldTimestamp([
      overviewSources.gameDesign.coreGameplayLoop,
      overviewSources.gameDesign.rewardLoop,
      overviewSources.gameDesign.progressionLoop,
      overviewSources.projectBrief.finalGoal
    ]),
    unresolved_items: overviewSources.gameDesign.needsConfirmation,
    related_refs: nodes.map((node) => node.id)
  });
}

function buildNode(id, label, kind, status, sourceKind, confidence, relatedRef, note = "", extras = {}) {
  return {
    id,
    label: label && label !== "unknown" ? label : "unknown",
    kind,
    status: status || "unknown",
    source_kind: sourceKind || "needs_confirmation",
    confidence: confidence || "low",
    source_ref: relatedRef || null,
    related_ref: relatedRef || null,
    note: note || "",
    last_updated_at: extras.last_updated_at || new Date().toISOString(),
    source_files: extras.source_files || [],
    recommended_source_files: extras.recommended_source_files || [],
    related_modules: extras.related_modules || [],
    related_versions: extras.related_versions || [],
    related_work_packages: extras.related_work_packages || [],
    related_risks: extras.related_risks || [],
    related_validation_gaps: extras.related_validation_gaps || [],
    unresolved_items: extras.unresolved_items || []
  };
}

function buildEdge(from, to, relation, confidence) {
  return {
    from,
    to,
    relation,
    confidence: confidence || "medium"
  };
}

function finalizeDiagram(diagram) {
  const knownNodeCount = diagram.nodes.filter((node) => node.label !== "unknown").length;
  const status = knownNodeCount >= Math.max(2, Math.ceil(diagram.nodes.length * 0.7))
    ? "ready"
    : knownNodeCount > 0
      ? "partial"
      : "unknown";
  const degradation = {
    missing_fields: uniqueStrings(diagram.missing_fields || []),
    omitted_nodes: uniqueStrings(diagram.omitted_nodes || []),
    omitted_edges: uniqueStrings(diagram.omitted_edges || []),
    fallback_hint: status === "ready"
      ? "Structured diagram is ready."
      : status === "partial"
        ? "Partial diagram: missing fields reduce the graph, but a minimum readable structure is still shown."
        : "Unknown diagram: only the minimum placeholder structure is shown until more source state is available."
  };

  return {
    ...diagram,
    status,
    generated_at: new Date().toISOString(),
    stale_hint: buildDiagramStaleHint(diagram.source_updated_at),
    coverageLevel: deriveCoverageLevel(diagram.nodes),
    freshness: deriveFreshnessLevel(diagram.source_updated_at),
    sourceMix: deriveSourceMix(diagram.nodes),
    degradation,
    traceability: buildDiagramTraceability(diagram),
    source_summary: diagram.source_summary,
    notes: diagram.notes || [],
    unresolved_items: diagram.unresolved_items || [],
    related_refs: diagram.related_refs || []
  };
}

function buildDiagramStaleHint(sourceUpdatedAt) {
  const timestamp = new Date(sourceUpdatedAt || 0).getTime();
  if (!timestamp) {
    return "Source freshness is unknown.";
  }
  const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  if (ageHours >= 24 * 7) {
    return "Source state is older than 7 days and may be stale.";
  }
  if (ageHours >= 24) {
    return "Source state is older than 24 hours. Check whether a newer run or state update is missing.";
  }
  return "Source state looks recent.";
}

function latestFieldTimestamp(fields) {
  const values = (fields || [])
    .map((item) => item?.last_updated_at || item?.updatedAt || item?.decidedAt || null)
    .filter(Boolean)
    .sort();
  return values.slice(-1)[0] || null;
}

function deriveCoverageLevel(nodes) {
  const total = (nodes || []).length;
  if (!total) {
    return "low";
  }
  const known = nodes.filter((node) => node.label !== "unknown").length;
  const ratio = known / total;
  if (ratio >= 0.75 && total >= 3) {
    return "high";
  }
  if (ratio >= 0.4) {
    return "medium";
  }
  return "low";
}

function deriveFreshnessLevel(sourceUpdatedAt) {
  const timestamp = new Date(sourceUpdatedAt || 0).getTime();
  if (!timestamp) {
    return "stale";
  }
  const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  if (ageHours < 24) {
    return "fresh";
  }
  if (ageHours < 24 * 7) {
    return "aging";
  }
  return "stale";
}

function deriveSourceMix(nodes) {
  const counts = { fact: 0, declared: 0, supplemental: 0, needs_confirmation: 0 };
  (nodes || []).forEach((node) => {
    counts[node.source_kind] = (counts[node.source_kind] || 0) + 1;
  });
  if (counts.fact >= counts.declared && counts.fact >= counts.supplemental) {
    return "fact_dominant";
  }
  if (counts.supplemental >= counts.fact && counts.supplemental >= counts.declared) {
    return "supplemental_heavy";
  }
  return "declared_dominant";
}

function buildDiagramTraceability(diagram) {
  return {
    primarySourceFiles: uniqueStrings((diagram.source_summary || []).filter(Boolean)),
    weakSourceFiles: uniqueStrings(mapMissingFieldsToSourceFiles(diagram.id, diagram.missing_fields || [])),
    recommendedSourceFiles: uniqueStrings(mapRecommendedFilesForDiagram(diagram.id, diagram.missing_fields || []))
  };
}

function mapMissingFieldsToSourceFiles(diagramId, missingFields) {
  return (missingFields || []).flatMap((field) => mapRecommendedFilesForField(diagramId, field));
}

function mapRecommendedFilesForDiagram(diagramId, missingFields) {
  const files = new Set();
  (missingFields || []).forEach((field) => {
    mapRecommendedFilesForField(diagramId, field).forEach((item) => files.add(item));
  });
  if (!files.size) {
    defaultSourceFilesForDiagram(diagramId).forEach((item) => files.add(item));
  }
  return [...files];
}

function mapRecommendedFilesForField(diagramId, field) {
  const normalized = normalizeValue(field);
  if (normalized.includes("module")) return [MODULE_MAP_FILE_NAME];
  if (normalized.includes("version") || normalized.includes("dod") || normalized.includes("verification") || normalized.includes("work package")) return [VERSION_STATE_FILE_NAME];
  if (normalized.includes("goal") || normalized.includes("project")) return [PROJECT_BRIEF_FILE_NAME];
  if (normalized.includes("game") || normalized.includes("offline") || normalized.includes("reward") || normalized.includes("progression")) return [GAME_DESIGN_FILE_NAME];
  if (normalized.includes("risk") || normalized.includes("decision")) return [DECISION_LOG_FILE_NAME, VERSION_STATE_FILE_NAME];
  return defaultSourceFilesForDiagram(diagramId);
}

function defaultSourceFilesForDiagram(diagramId) {
  if (diagramId === "project_panorama") return [PROJECT_BRIEF_FILE_NAME, MODULE_MAP_FILE_NAME, VERSION_STATE_FILE_NAME];
  if (diagramId === "module_structure" || diagramId === "module_dependency") return [MODULE_MAP_FILE_NAME, VERSION_STATE_FILE_NAME];
  if (diagramId === "version_roadmap" || diagramId === "current_slice_position") return [VERSION_STATE_FILE_NAME, PROJECT_STATE_FILE_NAME];
  if (diagramId === "game_loop") return [GAME_DESIGN_FILE_NAME, PROJECT_BRIEF_FILE_NAME];
  return [PROJECT_BRIEF_FILE_NAME, VERSION_STATE_FILE_NAME];
}

function buildVersionRef(versionState) {
  return {
    version_id: `version-${slug(versionState.versionTarget.value || "current")}`,
    label: versionState.versionTarget.value || "unknown"
  };
}

function buildSliceRef(versionState) {
  return {
    work_package_id: `work-package-${slug(versionState.currentWorkPackage.value || "current")}`,
    slice_id: `slice-${slug(versionState.currentWorkPackage.value || "current")}`
  };
}

function statusFromField(field) {
  return field && field.value && field.value !== "unknown" ? "ready" : "unknown";
}

function kindFromField(field) {
  return field?.sourceKind || "needs_confirmation";
}

function confidenceFromField(field) {
  return confidenceFromSourceKind(field?.sourceKind);
}

function confidenceFromSourceKind(sourceKind) {
  if (sourceKind === "fact") return "high";
  if (sourceKind === "declared") return "medium";
  if (sourceKind === "supplemental") return "low";
  return "low";
}

function slug(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "unknown";
}

function buildArtifacts(projectRecord, cachePaths) {
  const controlDir = path.join(projectRecord.rootPath, CONTROL_DIR_NAME);
  return {
    cacheCurrentStateJson: cachePaths.currentStateJsonPath,
    cacheCurrentStateMarkdown: cachePaths.currentStateMarkdownPath,
    sourceProjectState: path.join(controlDir, PROJECT_STATE_FILE_NAME),
    sourceProjectBrief: path.join(controlDir, PROJECT_BRIEF_FILE_NAME),
    sourceModuleMap: path.join(controlDir, MODULE_MAP_FILE_NAME),
    sourceTechStack: path.join(controlDir, TECH_STACK_FILE_NAME),
    sourceGameDesign: path.join(controlDir, GAME_DESIGN_FILE_NAME),
    sourceVersionState: path.join(controlDir, VERSION_STATE_FILE_NAME),
    sourceDecisionLog: path.join(controlDir, DECISION_LOG_FILE_NAME),
    sourceRunsDir: path.join(controlDir, RUNS_DIR_NAME)
  };
}

function buildOnboardingView(projectRecord) {
  return {
    layer: "execution-evidence",
    title: "接入与运行",
    steps: [
      "Run node src/server.js in PowerShell.",
      "Open http://localhost:4310 in the browser.",
      "Paste a Windows local git repo absolute path such as D:\\repo\\my-project.",
      "Initialization may create .codex-control/, baseline/version templates, and the stable AGENTS rules block.",
      "Steady-state watcher and polling only read the repo."
    ],
    supportedPaths: ["C:\\work\\demo", "D:\\repo\\my-project"],
    unsupportedWays: [
      "Opening public/index.html directly",
      "Dragging a folder onto the page",
      "Relative paths such as .\\demo"
    ],
    activeProjectRoot: projectRecord ? projectRecord.rootPath : null,
    actionBoundaries: buildActionBoundaryModel()
  };
}

function buildInstructionCenter(projectState, overviewSources, conflicts, summary = null) {
  const projectBrief = overviewSources.projectBrief;
  const versionState = overviewSources.versionState;
  const moduleMap = overviewSources.moduleMap;
  const missingBaseline = [];
  const missingVersion = [];
  const readyFields = [];
  const currentAction = summary
    ? {
        state: summary.currentActionState,
        reasons: summary.currentActionReasons || [],
        secondaryConditions: summary.secondaryConditions || []
      }
    : deriveCurrentActionAnalysis(projectState, overviewSources, conflicts);
  const superpowersGuidance = buildSuperpowersInstructionGuidance(overviewSources);

  checkField(projectBrief.oneLineDefinition, "project one-line definition", missingBaseline, readyFields);
  checkField(projectBrief.finalGoal, "final goal", missingBaseline, readyFields);
  if (!moduleMap.modules.length) {
    missingBaseline.push("module map");
  } else {
    readyFields.push("module map");
  }
  checkField(overviewSources.techStack.frontendClient, "frontend/client stack", missingBaseline, readyFields);
  checkField(versionState.versionTarget, "current version target", missingVersion, readyFields);
  if (!versionState.definitionOfDone.length) {
    missingVersion.push("definition of done");
  } else {
    readyFields.push("definition of done");
  }
  if (!versionState.verificationMatrix.length) {
    missingVersion.push("verification matrix");
  } else {
    readyFields.push("verification matrix");
  }
  if (versionState.currentSliceModule.moduleName === "unknown") {
    missingVersion.push("current slice -> module mapping");
  } else {
    readyFields.push("current slice -> module mapping");
  }

  let primaryType = "补项目基线";
  if (!missingBaseline.length && missingVersion.length) {
    primaryType = "补版本状态";
  } else if (!missingBaseline.length && !missingVersion.length && conflicts.length) {
    primaryType = "修验证缺口";
  } else if (!missingBaseline.length && !missingVersion.length) {
    primaryType = "实现某模块";
  }

  if (superpowersGuidance?.overridePrimaryType) {
    primaryType = superpowersGuidance.overridePrimaryType;
    currentAction.reasons = uniqueStrings([
      ...currentAction.reasons,
      ...(superpowersGuidance.extraReasons || [])
    ]);
  }

  return {
    layer: "current-control",
    title: "指令中心",
    currentActionState: currentAction.state,
    currentActionReasons: currentAction.reasons,
    secondaryConditions: currentAction.secondaryConditions,
    primaryType,
    availableTypes: [
      {
        type: "补项目基线",
        label: "首次导入旧项目时优先补整体认知层",
        template: "请基于 repo 事实扫描该项目，只补 project_brief / module_map / tech_stack / game_design / decision_log 中仍为 unknown 或 needs_confirmation 的字段，不修改业务代码。"
      },
      {
        type: "补版本状态",
        label: "当前版本目标、边界或验证口径不清晰时使用",
        template: "请只补 version_state.json，明确当前版本目标、非范围、DoD、blockers、验证矩阵与 go/no-go 状态，不修改业务代码。"
      },
      {
        type: "扫描模块",
        label: "当前模块拆分不足时先补模块地图",
        template: "请扫描 repo 结构和项目文档，只补模块地图与当前工作包所属模块映射，无法确认的字段保持 unknown / needs_confirmation。"
      },
      {
        type: "实现某模块",
        label: "当项目基线和版本边界已齐全时再推进实现",
        template: "请围绕模块【模块名】实现当前切片，目标是【目标】，边界是【不做什么】，并在完成后按协议更新 project_state.json 与 runs/*.json。"
      },
      {
        type: "修验证缺口",
        label: "当实现已推进但验证信息不足或冲突较多时使用",
        template: "请只做验证与缺口修复，核对文档、代码、测试与当前状态声明，列出冲突与缺失，不扩展业务范围。"
      },
      {
        type: "同步文档",
        label: "当 repo 已变化但控制文件落后时使用",
        template: "请基于 repo 可验证事实同步项目控制源文件和 runs 摘要，不修改业务实现。"
      },
      {
        type: "补风险与边界",
        label: "当风险、blockers 或非范围仍不清楚时使用",
        template: "请只补风险、blockers、非范围与升级/回跳条件，保持 repo 事实优先，不修改业务代码。"
      }
    ],
    requiredContext: uniqueStrings([
      "current work package goal",
      "target module name",
      "acceptance / verification scope",
      projectBrief.finalGoal.value === "unknown" ? "final goal" : null,
      projectBrief.targetOutcome.value === "unknown" ? "target outcome" : null,
      versionState.versionTarget.value === "unknown" ? "current version target" : null,
      ...(superpowersGuidance?.extraRequiredContext || [])
    ]),
    blockingQuestions: [...missingBaseline, ...missingVersion],
    readyFields,
    pendingDecisions: collectPendingDecisions(overviewSources.decisionLog),
    firstActionHint: superpowersGuidance?.firstActionHint || (missingBaseline.length || missingVersion.length
      ? "When baseline or version information is incomplete, prefer a state-completion instruction before direct implementation."
      : "The project baseline and current version boundary are mostly present, so the next instruction can focus on a module, a gap, or a verification task.")
  };
}

function checkField(field, label, missingList, readyList) {
  if (!field || field.value === "unknown") {
    missingList.push(label);
  } else {
    readyList.push(label);
  }
}

function buildSuperpowersBadge(superpowers) {
  const labelMap = {
    not_used: "未使用",
    detected: "已检测到",
    connected_but_insufficient: "已接入但信息不足"
  };

  return {
    status: superpowers.status,
    label: labelMap[superpowers.status] || superpowers.status,
    hasSpecs: superpowers.hasSpecs,
    hasPlans: superpowers.hasPlans,
    latestUpdatedAt: superpowers.latestUpdatedAt
  };
}

function buildTechStackSummary(techStack) {
  return [
    techStack.frontendClient.value !== "unknown" ? techStack.frontendClient.value : null,
    techStack.rendering.value !== "unknown" ? techStack.rendering.value : null,
    techStack.backend.exists.value === "yes" && techStack.backend.technology.value !== "unknown"
      ? techStack.backend.technology.value
      : null
  ].filter(Boolean).join(" / ") || "unknown";
}

function buildTechSummaryEntries(techStack) {
  return [
    { label: "前端 / 客户端", value: techStack.frontendClient.value, source: techStack.frontendClient.source },
    { label: "画面显示方式", value: techStack.rendering.value, source: techStack.rendering.source },
    { label: "UI 技术", value: techStack.uiTech.value, source: techStack.uiTech.source },
    { label: "后端", value: techStack.backend.exists.value, source: techStack.backend.exists.source }
  ];
}

function mergeAudienceExperience(projectBrief) {
  const values = [projectBrief.targetUsers.value, projectBrief.targetExperience.value].filter((item) => item && item !== "unknown");
  const sources = [projectBrief.targetUsers.source, projectBrief.targetExperience.source].filter(Boolean);
  if (!values.length) {
    return {
      value: "unknown",
      source: "needs_confirmation",
      sourceKind: "needs_confirmation"
    };
  }
  return {
    value: values.join(" / "),
    source: sources.join(" + ") || "unknown",
    sourceKind: projectBrief.targetExperience.sourceKind || projectBrief.targetUsers.sourceKind || "needs_confirmation"
  };
}

function deriveProjectGoalLink(projectBrief, versionState) {
  if (projectBrief.finalGoal.value !== "unknown") {
    return `Current slice should advance the final goal: ${projectBrief.finalGoal.value}`;
  }
  if (versionState.versionTarget.value !== "unknown") {
    return `Current slice should advance the current version target: ${versionState.versionTarget.value}`;
  }
  return "Current slice to project-goal linkage still needs confirmation.";
}

function deriveSliceImpact(versionState, moduleMap) {
  const sliceModule = versionState.currentSliceModule;
  if (sliceModule.moduleName && sliceModule.moduleName !== "unknown") {
    return `Finishing this slice should move module ${sliceModule.moduleName} forward.`;
  }
  if (moduleMap.modules.length) {
    return "Finishing this slice should move one identified module forward, but the exact mapping still needs confirmation.";
  }
  return "Slice impact is still blocked by missing module mapping.";
}

function buildCachePaths(projectId) {
  const cacheDir = path.join(CACHE_DIR, projectId);
  return {
    cacheDir,
    currentStateJsonPath: path.join(cacheDir, CURRENT_STATE_FILE_NAME),
    currentStateMarkdownPath: path.join(cacheDir, CURRENT_STATE_MD_FILE_NAME)
  };
}

async function persistCacheArtifacts(projectRecord, currentState) {
  const cachePaths = buildCachePaths(projectRecord.id);
  await writeJsonAtomic(cachePaths.currentStateJsonPath, currentState);
  await writeTextAtomic(cachePaths.currentStateMarkdownPath, renderCurrentStateMarkdown(currentState));
  return cachePaths;
}

function renderCurrentStateMarkdown(currentState) {
  const detail = currentState.detail;
  const versionCockpit = detail.views.versionCockpit;
  const instructionCenter = detail.views.instructionCenter;
  const lines = [
    "# 项目整体情况中心 + 当前状态中心",
    "",
    `- 项目: ${currentState.project.name}`,
    `- 项目路径: ${currentState.project.rootPath}`,
    `- 源状态目录: ${currentState.project.sourceControlDir}`,
    `- 本地缓存目录: ${currentState.project.cacheDir}`,
    `- 生成时间: ${currentState.generatedAt}`,
    "",
    "## 项目总览",
    "",
    `- 一句话定义: ${currentState.summary.oneLineDefinition}`,
    `- 项目类型: ${currentState.summary.projectType}`,
    `- 终版目标: ${currentState.summary.finalGoal}`,
    `- 当前版本目标: ${currentState.summary.versionTarget}`,
    `- 当前阶段: ${currentState.summary.currentStage}`,
    `- 当前工作包: ${currentState.summary.currentWorkPackage}`,
    `- 当前可动作状态: ${currentState.summary.currentActionState}`,
    `- 当前主风险: ${currentState.summary.keyRisk}`,
    `- 模块数: ${currentState.summary.moduleCount}`,
    `- 技术栈摘要: ${currentState.summary.techStackSummary}`,
    `- Superpowers: ${detail.superpowers.status}`,
    "",
    "## 版本驾驶舱",
    "",
    `- 当前版本目标: ${versionCockpit.versionTarget.value}`,
    `- 当前阶段: ${versionCockpit.currentStage.value}`,
    `- 当前工作包: ${versionCockpit.currentWorkPackage.value}`,
    `- 当前切片所属模块: ${versionCockpit.currentSliceModule.moduleName}`,
    `- Go / No-Go: ${versionCockpit.goNoGoStatus.value}`,
    "",
    "## 固定交付 10 项",
    ""
  ];

  detail.executionEvidence.fixedDeliverables.forEach((item) => {
    lines.push(`- ${item.title} [${item.status}] ${item.note || ""}`.trim());
  });

  appendSuperpowersMarkdownSection(lines, currentState);

  lines.push("", `## ${detail.executionEvidence.recentSummaryTitle}`, "");
  if (!detail.executionEvidence.recentChangeSummaries.length) {
    lines.push("- 暂无");
  } else {
    detail.executionEvidence.recentChangeSummaries.forEach((item) => {
      lines.push(`- [${item.type}] ${item.title || item.id}: ${item.summary}`);
    });
  }

  lines.push("", "## 指令中心", "");
  lines.push(`- 当前最适合的指令类型: ${instructionCenter.primaryType}`);
  (currentState.summary.currentActionReasons || []).forEach((item) => {
    lines.push(`- 状态原因: ${item}`);
  });
  instructionCenter.blockingQuestions.forEach((item) => {
    lines.push(`- 前置缺口: ${item}`);
  });

  lines.push("", "## 状态来源说明", "");
  detail.views.statusSources.markers.forEach((item) => {
    lines.push(`- ${item.label}: ${item.meaning}`);
  });

  if (detail.conflicts.length) {
    lines.push("", "## 冲突", "");
    detail.conflicts.forEach((item) => {
      lines.push(`- [${item.level}] ${item.message}`);
    });
  }

  return `${lines.join("\n")}\n`;
}

function determineRecentSummaryTitle(recentChangeSummaries) {
  const hasRealDiff = recentChangeSummaries.some((item) => item.type === "diff" && item.gitDiff === true);
  return hasRealDiff ? "最近两次真实 diff 摘要" : "最近两次变更摘要";
}

function pickRiskLevel(versionRisks, projectRisks) {
  const levels = ["low", "medium", "high", "critical"];
  const maxIndex = mergeRisks(versionRisks, projectRisks).reduce((current, item) => {
    const next = levels.indexOf(item.level);
    return Math.max(current, next);
  }, 0);
  return levels[maxIndex] || "low";
}

function pickPrimaryRisk(versionRisks, projectRisks) {
  return mergeRisks(versionRisks, projectRisks)[0] || null;
}

function mergeRisks(versionRisks, projectRisks) {
  const merged = [];
  (Array.isArray(versionRisks) ? versionRisks : []).forEach((item) => {
    merged.push({
      title: deriveRiskTitle(item, merged.length),
      detail: item.detail || "",
      level: item.level || "medium",
      source: item.source || "version_state.json"
    });
  });
  (Array.isArray(projectRisks) ? projectRisks : []).forEach((item) => {
    merged.push({
      title: deriveRiskTitle(item, merged.length),
      detail: item.detail || "",
      level: item.level || "medium",
      source: item.source || "project_state.json"
    });
  });
  return dedupeRisks(merged).sort((left, right) => riskScore(right.level) - riskScore(left.level));
}

function dedupeRisks(items) {
  const map = new Map();
  items.forEach((item) => {
    const key = `${item.title}:${item.detail}:${item.level}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return [...map.values()];
}

function riskScore(level) {
  if (level === "critical") return 4;
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function stageCompletionLabel(stage) {
  return stage && stage !== "unknown" ? `阶段性进展: ${stage}` : "整体完成度待确认";
}

function collectUnknownFields(overviewSources) {
  const fields = [];
  pushUnknownField(fields, "项目一句话定义", overviewSources.projectBrief.oneLineDefinition);
  pushUnknownField(fields, "终版目标", overviewSources.projectBrief.finalGoal);
  pushUnknownField(fields, "项目目标效果", overviewSources.projectBrief.targetOutcome);
  pushUnknownField(fields, "项目类型", overviewSources.projectBrief.projectType);
  pushUnknownField(fields, "模块地图", { value: overviewSources.moduleMap.modules.length ? "known" : "unknown" });
  pushUnknownField(fields, "画面显示方式", overviewSources.techStack.rendering);
  pushUnknownField(fields, "后端职责", overviewSources.techStack.backend.responsibility);
  pushUnknownField(fields, "当前版本目标", overviewSources.versionState.versionTarget);
  pushUnknownField(fields, "完成定义", { value: overviewSources.versionState.definitionOfDone.length ? "known" : "unknown" });
  if (overviewSources.isGameProject) {
    pushUnknownField(fields, "游戏分类", overviewSources.gameDesign.gameCategory);
    pushUnknownField(fields, "画面设计方向", overviewSources.gameDesign.visualDirection);
  }
  return fields;
}

function deriveRiskTitle(item, index) {
  if (typeof item === "string" && item.trim()) {
    return item.trim();
  }
  if (item?.title && item.title !== "unknown") {
    return item.title;
  }
  if (item?.label && item.label !== "unknown") {
    return item.label;
  }
  if (item?.detail) {
    return item.detail.slice(0, 48);
  }
  return `Risk item ${index + 1}`;
}

function pushUnknownField(fields, label, field) {
  if (!field || field.value === "unknown") {
    fields.push(label);
  }
}

function findDeliverableNote(deliverables, key) {
  const item = deliverables.find((entry) => entry.key === key && entry.note);
  return item ? item.note : null;
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isExplicitNoGo(value) {
  return [
    "no_go",
    "no-go",
    "blocked",
    "hold",
    "stop"
  ].includes(value);
}

function isBlueprintStage(value) {
  return ["blueprint", "draft", "planning", "intake", "definition"].some((token) => value.includes(token));
}

module.exports = {
  buildCachePaths,
  buildCurrentState,
  buildDefaultProjectState,
  normalizeProjectState,
  persistCacheArtifacts,
  renderCurrentStateMarkdown
};
