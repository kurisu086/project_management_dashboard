# Project Management Dashboard

`project_management_dashboard` 是一个多项目只读型 Codex 总控台。

它的职责是接入本机 Windows git repo，聚合被监控项目的控制面信息，并在一个统一看板里展示：

- 项目定义、模块地图、技术栈、版本与切片状态
- 最近变更、状态来源、风险与待确认项
- Superpowers 项目的 spec / plan / writeback / workflow 阶段
- 接入、建档、recovery、pending-review 等控制面辅助入口

这个仓库是控制面实现，不负责修改被监控项目的业务代码。

## 当前边界

- steady-state 下，总控台只读聚合被监控项目状态
- 显式维护动作可以写入被监控项目的控制面文件，例如 `.codex-control/`、repo-local skills、dashboard 管理的 `AGENTS.md` 规则块
- 总控台可以解释“当前项目到什么程度了”，但不直接编排或代替 repo 内开发

更多仓库内工作流规则见 [AGENTS.md](D:/VibeCoding/project_management_dashboard/AGENTS.md) 和 [docs/superpowers/README.md](D:/VibeCoding/project_management_dashboard/docs/superpowers/README.md)。

## 本地运行

要求：

- Windows 11 本机 Node.js 环境
- 被监控项目使用绝对本地路径，且必须是 git repo

启动：

```bash
npm start
```

开发模式：

```bash
npm run dev
```

验证：

```bash
npm run test:smoke:frontend
npm run test:regression:windows
```

## 仓库结构

- [src/server.js](D:/VibeCoding/project_management_dashboard/src/server.js): 服务入口
- [src/lib/](D:/VibeCoding/project_management_dashboard/src/lib): 聚合、接入、工作流、脚手架注入等后端逻辑
- [public/](D:/VibeCoding/project_management_dashboard/public): 前端页面与视图模块
- [scripts/](D:/VibeCoding/project_management_dashboard/scripts): Windows 回归、前端 smoke 与测试辅助脚本
- [docs/superpowers/](D:/VibeCoding/project_management_dashboard/docs/superpowers): 本仓库自身的 Superpowers 工作流文档
- [docs/source-state-protocol.md](D:/VibeCoding/project_management_dashboard/docs/source-state-protocol.md): 被监控项目控制面协议

## 被监控项目怎么接入

1. 先把目标 repo 接入总控台。
2. 根据项目阶段选择“新项目建档”或“已有项目建档”。
3. 如果该项目后续要按 Superpowers 流程协作，在总控台里启用 `useSuperpowers`。
4. 总控台会按模式注入或维护对应控制面资产，例如：
   - `.codex-control/`
   - repo-local skills
   - dashboard 管理的 `AGENTS.md` 规则块
   - 最小 `docs/superpowers/` 骨架
5. 后续看板会优先读取正式 writeback，再关联 spec / plan，缺 formal writeback 时才用 repo 变化做 inferred fallback。

## Superpowers 兼容说明

当前主干已经支持三层能力：

- 接入层：`useSuperpowers` 打开后，接入、recovery、prompt、repo 脚手架会切到 Superpowers 模式
- 聚合层：看板会识别 formal writeback、spec / plan、repo fallback，并区分 formal 与 inferred 证据
- 流程层：看板会显示 workflow stage、建议下一步和推荐 skill，但这些只是状态解释，不直接干涉开发

## 维护提示

- 这个仓库里的 `.js` 文件必须保持在 700 行以内
- 任何会改变控制面边界的数据/API/协议改动，都应遵守 [docs/superpowers/README.md](D:/VibeCoding/project_management_dashboard/docs/superpowers/README.md) 里的主通道流程
- 测试脚本必须使用隔离的临时数据目录，不能覆盖真实 `data/`
