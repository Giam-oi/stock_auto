const { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

const root = join(__dirname, "..");
const release = join(root, "release");
const exeName = "Noon\u5e97\u94fa\u4f1a\u8bdd\u76d1\u63a7.exe";
const extensionName = "Noon\u767b\u5f55\u52a9\u624b\u6269\u5c55";
const copyPowerShellUtf8Bom = (source, destination) => {
  const content = readFileSync(source, "utf8").replace(/^\uFEFF/, "");
  writeFileSync(destination, `\uFEFF${content}`, "utf8");
};
mkdirSync(release, { recursive: true });
rmSync(join(release, "Noon\u5e97\u94fa\u767b\u5f55.exe"), { force: true });
const pkg = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");
execFileSync(process.execPath, [pkg, "package.json", "--targets", "node22-win-x64", "--output", join(release, exeName)], {
  cwd: root,
  stdio: "inherit",
});
const releaseExtension = join(release, extensionName);
rmSync(releaseExtension, { recursive: true, force: true });
cpSync(join(root, "extension"), releaseExtension, { recursive: true });
copyFileSync(join(root, "assets", "install-extension.cmd"), join(release, "\u5b89\u88c5\u6269\u5c55.cmd"));
copyFileSync(join(root, "assets", "setup-extension.html"), join(release, "\u5b89\u88c5\u76d1\u63a7\u6269\u5c55.html"));
copyFileSync(join(root, "README.md"), join(release, "\u4f7f\u7528\u8bf4\u660e.txt"));
copyPowerShellUtf8Bom(join(root, "assets", "install-resident-monitor.ps1"), join(release, "\u5b89\u88c5\u5e38\u9a7b\u76d1\u63a7.ps1"));
copyFileSync(join(root, "assets", "install-resident-monitor.cmd"), join(release, "\u5b89\u88c5\u5e38\u9a7b\u76d1\u63a7.cmd"));
copyPowerShellUtf8Bom(join(root, "assets", "uninstall-resident-monitor.ps1"), join(release, "\u5378\u8f7d\u5e38\u9a7b\u76d1\u63a7.ps1"));
copyPowerShellUtf8Bom(join(root, "assets", "noon-tray.ps1"), join(release, "noon-tray.ps1"));
copyFileSync(join(root, "assets", "noon-tray-launcher.vbs"), join(release, "noon-tray.vbs"));
copyPowerShellUtf8Bom(join(root, "assets", "launch-chrome-background.ps1"), join(release, "launch-chrome-background.ps1"));
copyPowerShellUtf8Bom(join(root, "assets", "outlook-otp.ps1"), join(release, "outlook-otp.ps1"));
const cscCandidates = [
  join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
];
const csc = cscCandidates.find((candidate) => require("node:fs").existsSync(candidate));
if (!csc) throw new Error("C# compiler not found");
execFileSync("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "generate-dashboard-icon.ps1"),
], { cwd: root, stdio: "inherit" });
execFileSync("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "generate-auto-login-icon.ps1"),
], { cwd: root, stdio: "inherit" });
execFileSync(csc, [
  "/nologo",
  "/target:winexe",
  `/win32icon:${join(root, "assets", "NoonAutoLogin.ico")}`,
  `/out:${join(release, "Noon\u516d\u5e97\u81ea\u52a8\u767b\u5f55.exe")}`,
  join(root, "assets", "NoonAutoLoginLauncher.cs"),
], { cwd: root, stdio: "inherit" });
execFileSync(csc, [
  "/nologo",
  "/target:winexe",
  "/codepage:65001",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Drawing.dll",
  `/win32icon:${join(root, "assets", "NoonDashboard.ico")}`,
  `/out:${join(release, "Noon\u516d\u5e97\u770b\u677f.exe")}`,
  join(root, "assets", "NoonDashboardLauncher.cs"),
], { cwd: root, stdio: "inherit" });
copyPowerShellUtf8Bom(join(root, "assets", "install-auto-login-schedule.ps1"), join(release, "\u5b89\u88c5\u6bcf\u65e5\u81ea\u52a8\u767b\u5f55.ps1"));
copyPowerShellUtf8Bom(join(root, "assets", "uninstall-auto-login-schedule.ps1"), join(release, "\u5378\u8f7d\u6bcf\u65e5\u81ea\u52a8\u767b\u5f55.ps1"));
copyFileSync(join(root, "assets", "install-auto-login-schedule.cmd"), join(release, "\u5b89\u88c5\u6bcf\u65e5\u81ea\u52a8\u767b\u5f55.cmd"));
copyFileSync(join(root, "assets", "NoonDashboard.ico"), join(release, "Noon\u516d\u5e97\u770b\u677f.ico"));
copyFileSync(join(root, "assets", "NoonAutoLogin.ico"), join(release, "Noon\u516d\u5e97\u81ea\u52a8\u767b\u5f55.ico"));
