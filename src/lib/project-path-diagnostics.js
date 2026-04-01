const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const {
  CONTROL_DIR_NAME
} = require("./constants");
const {
  getRuntimeInfo
} = require("./runtime-env");

async function diagnoseProjectPath(inputPath) {
  const runtime = getRuntimeInfo();
  const rawInput = typeof inputPath === "string" ? inputPath : "";
  const trimmedInput = rawInput.trim();
  const diagnostic = {
    rawInput,
    trimmedInput,
    normalizedPath: null,
    platform: runtime.platform,
    isWindowsNative: runtime.isWindowsNative,
    isWindowsDrivePath: isWindowsDrivePath(trimmedInput),
    isAbsolutePath: false,
    checks: [],
    success: false,
    failureReason: null
  };

  if (!trimmedInput) {
    return failDiagnostic(diagnostic, "项目路径不能为空。", "input_non_empty", false, "请输入 Windows 本地项目路径。");
  }

  if (!runtime.isWindowsNative) {
    return failDiagnostic(
      diagnostic,
      "当前服务不是运行在 Windows 本机 Node 环境，不能接收 Windows 本地项目路径。",
      "windows_native_runtime",
      false,
      "请在 Windows 11 本机 Node 进程中启动总控服务，再添加类似 C:\\work\\demo 的路径。"
    );
  }

  const normalizedPath = normalizeWindowsPath(trimmedInput);
  diagnostic.normalizedPath = normalizedPath;

  const absolute = path.win32.isAbsolute(normalizedPath);
  diagnostic.isAbsolutePath = absolute;
  diagnostic.checks.push({
    key: "absolute_path",
    ok: absolute,
    message: absolute ? "已识别为绝对路径。" : "不是绝对路径。"
  });
  if (!absolute) {
    return failDiagnostic(diagnostic, "只支持 Windows 本地绝对路径。", "absolute_path", false, "示例：C:\\work\\demo 或 D:\\repo\\my-project");
  }

  if (!diagnostic.isWindowsDrivePath) {
    diagnostic.checks.push({
      key: "drive_letter_path",
      ok: false,
      message: "当前版本仅优先支持 Windows 本地盘符路径。"
    });
    return failDiagnostic(
      diagnostic,
      "当前版本仅支持 Windows 本地盘符路径。",
      "drive_letter_path",
      false,
      "请使用类似 C:\\work\\demo 或 D:\\repo\\my-project 的路径。"
    );
  }

  let stats = null;
  try {
    stats = await fsPromises.stat(normalizedPath);
    diagnostic.checks.push({
      key: "path_exists",
      ok: true,
      message: "路径存在。"
    });
  } catch (error) {
    diagnostic.checks.push({
      key: "path_exists",
      ok: false,
      message: `路径不存在：${error.code || error.message}`
    });
    return failDiagnostic(diagnostic, "路径不存在。", "path_exists", false, "请检查输入路径是否正确。");
  }

  const isDirectory = !!stats && stats.isDirectory();
  diagnostic.checks.push({
    key: "is_directory",
    ok: isDirectory,
    message: isDirectory ? "路径是目录。" : "路径不是目录。"
  });
  if (!isDirectory) {
    return failDiagnostic(diagnostic, "项目路径必须是目录。", "is_directory", false, "请输入 repo 根目录，而不是单个文件。");
  }

  const gitEntryPath = path.win32.join(normalizedPath, ".git");
  const gitEntryExists = await exists(gitEntryPath);
  diagnostic.checks.push({
    key: "is_git_repo",
    ok: gitEntryExists,
    message: gitEntryExists ? "检测到 .git，路径被识别为 git repo。" : "未检测到 .git。"
  });
  if (!gitEntryExists) {
    return failDiagnostic(diagnostic, "目标目录不是 git repo。", "is_git_repo", false, "当前版本要求被监控项目必须是 git repo。");
  }

  const controlDirPath = path.win32.join(normalizedPath, CONTROL_DIR_NAME);
  const writeTarget = (await exists(controlDirPath)) ? controlDirPath : normalizedPath;
  const writable = await canWrite(writeTarget);
  diagnostic.checks.push({
    key: "codex_control_writable",
    ok: writable,
    message: writable
      ? `可以写入 ${writeTarget}。`
      : `无法写入 ${writeTarget}。`
  });
  if (!writable) {
    return failDiagnostic(
      diagnostic,
      "没有权限创建或写入 .codex-control。",
      "codex_control_writable",
      false,
      "请确认当前 Node 进程对该项目目录有写权限。"
    );
  }

  diagnostic.success = true;
  return diagnostic;
}

function normalizeWindowsPath(inputPath) {
  const normalizedSlashes = inputPath.replaceAll("/", "\\");
  return path.win32.normalize(normalizedSlashes);
}

function isWindowsDrivePath(inputPath) {
  return /^[A-Za-z]:[\\/]/.test(inputPath);
}

async function exists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function canWrite(targetPath) {
  try {
    await fsPromises.access(targetPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function failDiagnostic(diagnostic, failureReason, failedCheck, ok, message) {
  diagnostic.failureReason = failureReason;
  if (failedCheck) {
    diagnostic.checks.push({
      key: failedCheck,
      ok,
      message
    });
  }
  return diagnostic;
}

module.exports = {
  diagnoseProjectPath,
  normalizeWindowsPath
};
