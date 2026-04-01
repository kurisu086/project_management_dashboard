function getRuntimeInfo() {
  const platform = process.platform;
  const isWindowsNative = platform === "win32";

  return {
    platform,
    nodeVersion: process.version,
    nodeRuntimeDescription: isWindowsNative
      ? "Windows 11 本机 Node.js 进程"
      : "非 Windows 本机 Node.js 进程",
    isWindowsNative,
    modeLabel: isWindowsNative ? "Windows Native" : "Non-Windows / Unsupported",
    directoryPicker: {
      supported: false,
      reason: "当前技术栈是普通浏览器页面，无法安全获得系统目录选择器返回的绝对本地路径。"
    }
  };
}

module.exports = {
  getRuntimeInfo
};
