import { execFile as nodeExecFile } from "node:child_process";
import { AsnCreatorError } from "./errors.js";
import type { FolderRunResult } from "./runner.js";

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { windowsHide: boolean; encoding: "utf8"; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

const FOLDER_SCRIPT = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
$dialog.Description = '选择包含 ASN 表格的文件夹'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.WriteLine($dialog.SelectedPath)
} else {
  [Console]::Out.WriteLine('__CANCEL__')
}
`;

const defaultExecFile: ExecFileLike = (file, args, options) => new Promise((resolve, reject) => {
  nodeExecFile(file, [...args], options, (error, stdout, stderr) => {
    if (error) reject(error);
    else resolve({ stdout, stderr });
  });
});

export async function chooseFolder(execFile: ExecFileLike = defaultExecFile): Promise<string | undefined> {
  const encoded = Buffer.from(FOLDER_SCRIPT, "utf16le").toString("base64");
  let output: { stdout: string; stderr: string };
  try {
    output = await execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", encoded],
      { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
  } catch (cause) {
    throw new AsnCreatorError("configuration", false, "folder-picker", "Unable to open the Windows folder picker", { cause });
  }
  const selected = output.stdout.trim();
  if (selected === "__CANCEL__" || selected === "") return undefined;
  return selected;
}

export async function showOperatorMessage(
  message: string,
  isError: boolean,
  execFile: ExecFileLike = defaultExecFile,
): Promise<void> {
  const messageBase64 = Buffer.from(message, "utf8").toString("base64");
  const icon = isError ? "Error" : "Information";
  const script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$message = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${messageBase64}'))
[void][System.Windows.Forms.MessageBox]::Show(
  $message,
  'Noon ASN 创建工具',
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::${icon}
)
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    await execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", encoded],
      { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
  } catch (cause) {
    throw new AsnCreatorError("configuration", false, "result-dialog", "Unable to show the result dialog", { cause });
  }
}

export function exitCodeForResult(result: FolderRunResult): 0 | 1 {
  return result.files.some(({ status }) => status === "failed" || status === "needs_review" || status === "invalid_input") ? 1 : 0;
}

export function formatSummary(result: FolderRunResult): string {
  const count = (status: string) => result.files.filter((file) => file.status === status).length;
  const rows = result.files.map((file) => [
    file.status,
    file.fileName,
    file.asnNumber ?? "",
    file.error?.message ?? "",
  ].join("\t"));
  const totals = [
    `written=${count("written")}`,
    `skipped=${count("skipped_existing")}`,
    `failed=${count("failed") + count("invalid_input")}`,
    `needs_review=${count("needs_review")}`,
  ].join("  ");
  return [`Folder: ${result.folderPath}`, "Status\tFile\tASN\tMessage", ...rows, totals].join("\n");
}

export function formatOperatorSummary(result: FolderRunResult): string {
  const count = (status: string) => result.files.filter((file) => file.status === status).length;
  const failed = result.files.filter((file) => file.status === "failed" || file.status === "invalid_input" || file.status === "needs_review");
  const details = failed.map((file) => `${file.fileName}：${file.error?.message ?? (file.status === "needs_review" ? "需要人工检查" : "处理失败")}`);
  return [
    `文件夹：${result.folderPath}`,
    "",
    `成功锁定并写入：${count("written")}`,
    `已有 ASN，已核验锁定：${count("skipped_existing")}`,
    `失败：${count("failed") + count("invalid_input")}`,
    `需要人工检查：${count("needs_review")}`,
    ...(details.length > 0 ? ["", "未完成文件：", ...details] : []),
  ].join("\n");
}
