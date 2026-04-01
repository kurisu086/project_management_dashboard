# Windows 快速开始

## 适用场景

当前版本以 Windows 11 本机 Node 进程为主场景，只支持接入 Windows 本机 git repo 的绝对路径。

## 启动方式

1. 打开 PowerShell
2. 进入当前项目目录
3. 执行：

```powershell
node src/server.js
```

4. 在浏览器访问：

```text
http://localhost:4310
```

## 支持的路径格式

- `C:\work\demo`
- `D:\repo\my-project`

## 不支持的使用方式

- 直接双击 `public/index.html`
- 把目录拖拽到页面里
- 使用相对路径，例如 `.\demo`
- 使用非 Windows 本机路径

## 最小使用流程

1. 运行 `node src/server.js`
2. 打开 `http://localhost:4310`
3. 先看首页“当前运行环境”，确认是 Windows 本机模式
4. 在“Windows 本地项目路径”输入框粘贴一个 git repo 根目录绝对路径，例如 `D:\repo\my-project`
5. 点击“添加项目”
6. 如果成功：
   - 页面会提示接入成功
   - 项目列表会立即刷新
   - 目标 repo 会在初始化阶段补齐 `/.codex-control/` 和稳定规则块
7. 如果失败：
   - 请看首页“添加项目诊断结果”
   - 再看“常见失败原因”

## 运行边界

- 总控只读业务代码
- 日常运行只读取 `AGENTS.md` 和 `/.codex-control/`
- 日常运行不会回写业务实现
- 派生状态写入总控本地缓存，不写项目 repo
