# 项目侧源状态协议

## 适用范围

本协议用于被监控项目 repo 内的源状态文件：

- `/.codex-control/project_state.json`
- `/.codex-control/runs/*.json`

总控日常运行只读取这些源文件，并将派生结果写入总控本地缓存。`current_state.json` 与 `current_state.md` 不属于项目侧源状态协议。

## project_state.json 最低字段

最低必须包含以下字段：

- `schemaVersion`
- `project.name`
- `status.versionTarget.value`
- `status.versionTarget.updatedAt`
- `status.currentStage.value`
- `status.currentStage.updatedAt`
- `status.currentWorkPackage.value`
- `status.currentWorkPackage.updatedAt`
- `status.lastUpdatedAt`
- `status.fixedDeliverables`
- `status.riskFlags`
- `status.consistency.docs.status`
- `status.consistency.code.status`
- `status.consistency.tests.status`
- `evidence.history`

其中：

- `status.fixedDeliverables` 必须固定为 10 项
- 每项必须带 `key`、`title`、`status`
- `evidence.history` 用于引用 `runs/*.json` 记录，建议包含 `id`、`type`、`title`、`summary`、`createdAt`、`file`

## runs/*.json 最低字段

每个运行记录文件最低必须包含：

- `schemaVersion`
- `runId`
- `type`
- `title`
- `summary`
- `createdAt`
- `deliverables`

其中 `deliverables` 必须稳定包含以下 10 个字段：

- `change_summary`
- `changed_files`
- `executed_commands`
- `test_results`
- `open_issues`
- `residual_risks`
- `impact_scope`
- `test_suggestions`
- `documentation_updates`
- `escalation_or_rollback`

每个 `deliverables.<key>` 最低建议包含：

- `status`
- `content`

## 时间戳要求

- 所有时间戳统一使用 ISO 8601 UTC 字符串，例如：`2026-03-26T09:30:00.000Z`
- `status.lastUpdatedAt` 表示当前项目声明态的最近更新时间
- `status.*.updatedAt` 表示单个声明字段的最近更新时间
- `runs/*.json.createdAt` 表示本次运行记录生成时间
- 如果 `runs/*.json.createdAt` 晚于 `project_state.json.status.lastUpdatedAt`，总控应标记“声明态可能过期”

## 固定交付字段映射

`project_state.json.status.fixedDeliverables[*].key` 与 `runs/*.json.deliverables` 必须按以下稳定映射保持一致：

| 固定交付项 | project_state key | runs deliverable key |
| --- | --- | --- |
| 改动摘要 | `change_summary` | `change_summary` |
| 变更文件 | `changed_files` | `changed_files` |
| 执行命令 | `executed_commands` | `executed_commands` |
| 自测/测试结果 | `test_results` | `test_results` |
| 未解决问题 | `open_issues` | `open_issues` |
| 剩余风险 | `residual_risks` | `residual_risks` |
| 是否影响其他工作包 | `impact_scope` | `impact_scope` |
| 需要补充的测试建议 | `test_suggestions` | `test_suggestions` |
| 文档更新情况 | `documentation_updates` | `documentation_updates` |
| 是否触发升级/回跳条件 | `escalation_or_rollback` | `escalation_or_rollback` |

## 状态来源语义

- `declared`：来自 `project_state.json` 的项目声明
- `verified`：总控实际核验后才可写入，当前版本默认不启用
- `derived/cache`：总控根据源状态生成的本地缓存，不回写项目 repo
