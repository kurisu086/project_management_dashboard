const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.CODEX_CONTROL_DATA_DIR
  ? path.resolve(process.env.CODEX_CONTROL_DATA_DIR)
  : path.join(APP_ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const REGISTRY_FILE = path.join(DATA_DIR, "project-registry.json");
const WORKBENCH_FILE = path.join(DATA_DIR, "intake-workbench.json");
const OPERATION_LOG_FILE = path.join(DATA_DIR, "operation-log.ndjson");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const SCHEMA_VERSION = "1.2.0";
const SERVER_PORT = Number(process.env.PORT || 4310);

const CONTROL_DIR_NAME = ".codex-control";
const META_DIR_NAME = "meta";
const RUNS_DIR_NAME = "runs";
const PROJECT_STATE_FILE_NAME = "project_state.json";
const PROJECT_BRIEF_FILE_NAME = "project_brief.json";
const MODULE_MAP_FILE_NAME = "module_map.json";
const TECH_STACK_FILE_NAME = "tech_stack.json";
const GAME_DESIGN_FILE_NAME = "game_design.json";
const VERSION_STATE_FILE_NAME = "version_state.json";
const DECISION_LOG_FILE_NAME = "decision_log.json";
const CURRENT_STATE_FILE_NAME = "current_state.json";
const CURRENT_STATE_MD_FILE_NAME = "current_state.md";
const PROJECT_CONFIG_FILE_NAME = "project_config.json";
const WATCH_MANIFEST_FILE_NAME = "watch_manifest.json";
const AGENTS_FILE_NAME = "AGENTS.md";
const GITIGNORE_FILE_NAME = ".gitignore";
const AGENTS_DIR_NAME = ".agents";
const SKILLS_DIR_NAME = "skills";
const DOCS_DIR_NAME = "docs";
const SUPERPOWERS_DIR_NAME = "superpowers";
const SUPERPOWERS_SPECS_DIR_NAME = "specs";
const SUPERPOWERS_PLANS_DIR_NAME = "plans";
const DIAGNOSTIC_HISTORY_FILE = path.join(DATA_DIR, "diagnostic-history.json");

const CONTROL_RULES_START = "<!-- CODEX-CONTROL-RULES:START -->";
const CONTROL_RULES_END = "<!-- CODEX-CONTROL-RULES:END -->";
const CONTROL_GITIGNORE_START = "# CODEX-CONTROL-IGNORE:START";
const CONTROL_GITIGNORE_END = "# CODEX-CONTROL-IGNORE:END";
const LOCAL_SKILL_NAMES = [
  "codex-project-handoff",
  "codex-task-closeout-writeback",
  "codex-project-recovery-scan"
];

const WATCH_SETTLE_MS = 600;
const POLL_INTERVAL_MS = 15000;
const READ_RETRY_COUNT = 5;
const READ_RETRY_DELAY_MS = 250;

const FIXED_DELIVERABLE_TEMPLATES = [
  { key: "change_summary", title: "改动摘要" },
  { key: "changed_files", title: "变更文件" },
  { key: "executed_commands", title: "执行命令" },
  { key: "test_results", title: "自测/测试结果" },
  { key: "open_issues", title: "未解决问题" },
  { key: "residual_risks", title: "剩余风险" },
  { key: "impact_scope", title: "是否影响其他工作包" },
  { key: "test_suggestions", title: "需要补充的测试建议" },
  { key: "documentation_updates", title: "文档更新情况" },
  { key: "escalation_or_rollback", title: "是否触发升级/回跳条件" }
];

module.exports = {
  AGENTS_FILE_NAME,
  AGENTS_DIR_NAME,
  APP_ROOT,
  CACHE_DIR,
  CONTROL_DIR_NAME,
  CONTROL_GITIGNORE_END,
  CONTROL_GITIGNORE_START,
  CONTROL_RULES_END,
  CONTROL_RULES_START,
  CURRENT_STATE_FILE_NAME,
  CURRENT_STATE_MD_FILE_NAME,
  DATA_DIR,
  DECISION_LOG_FILE_NAME,
  DIAGNOSTIC_HISTORY_FILE,
  DOCS_DIR_NAME,
  FIXED_DELIVERABLE_TEMPLATES,
  GAME_DESIGN_FILE_NAME,
  GITIGNORE_FILE_NAME,
  LOCAL_SKILL_NAMES,
  META_DIR_NAME,
  OPERATION_LOG_FILE,
  MODULE_MAP_FILE_NAME,
  POLL_INTERVAL_MS,
  PROJECT_BRIEF_FILE_NAME,
  PROJECT_CONFIG_FILE_NAME,
  PROJECT_STATE_FILE_NAME,
  PUBLIC_DIR,
  READ_RETRY_COUNT,
  READ_RETRY_DELAY_MS,
  REGISTRY_FILE,
  RUNS_DIR_NAME,
  SCHEMA_VERSION,
  SERVER_PORT,
  SUPERPOWERS_DIR_NAME,
  SUPERPOWERS_PLANS_DIR_NAME,
  SUPERPOWERS_SPECS_DIR_NAME,
  SKILLS_DIR_NAME,
  TECH_STACK_FILE_NAME,
  VERSION_STATE_FILE_NAME,
  WATCH_MANIFEST_FILE_NAME,
  WATCH_SETTLE_MS,
  WORKBENCH_FILE
};
