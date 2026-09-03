import { describe, expect, it, vi } from "vitest";
import type { FolderRunResult } from "../src/runner.js";
import { chooseFolder, exitCodeForResult, formatOperatorSummary, formatSummary, showOperatorMessage, type ExecFileLike } from "../src/launcher.js";

describe("folder launcher", () => {
  it("returns a selected folder including Chinese text and spaces", async () => {
    const execFile = vi.fn<ExecFileLike>(async () => ({ stdout: "D:\\ASN 文件\\第一批\r\n", stderr: "" }));
    await expect(chooseFolder(execFile)).resolves.toBe("D:\\ASN 文件\\第一批");
    expect(execFile.mock.calls[0]?.[1]).toContain("-EncodedCommand");
    expect(execFile.mock.calls[0]?.[1].join(" ")).not.toContain("D:\\ASN 文件");
  });

  it("distinguishes cancel from PowerShell failure", async () => {
    await expect(chooseFolder(async () => ({ stdout: "__CANCEL__\r\n", stderr: "" }))).resolves.toBeUndefined();
    await expect(chooseFolder(async () => { throw new Error("PowerShell failed"); })).rejects.toMatchObject({ kind: "configuration" });
  });
});

describe("operator summary", () => {
  const result: FolderRunResult = {
    folderPath: "D:\\input",
    files: [
      { filePath: "a.xlsx", fileName: "a.xlsx", status: "written", asnNumber: "ASN-1" },
      { filePath: "b.xlsx", fileName: "b.xlsx", status: "skipped_existing", asnNumber: "ASN-2" },
      { filePath: "c.xlsx", fileName: "c.xlsx", status: "failed", error: { kind: "http", stage: "find", message: "HTTP 500" } },
      { filePath: "d.xlsx", fileName: "d.xlsx", status: "needs_review" }
    ]
  };

  it("formats per-file rows and summary counts", () => {
    const text = formatSummary(result);
    expect(text).toContain("written=1");
    expect(text).toContain("skipped=1");
    expect(text).toContain("failed=1");
    expect(text).toContain("needs_review=1");
    expect(text).toContain("a.xlsx");
  });

  it("maps success, partial failure, configuration, and cancel exit codes", () => {
    expect(exitCodeForResult({ folderPath: "x", files: result.files.slice(0, 2) })).toBe(0);
    expect(exitCodeForResult(result)).toBe(1);
  });

  it("formats a Chinese popup summary with failed file details", () => {
    const text = formatOperatorSummary(result);
    expect(text).toContain("成功锁定并写入：1");
    expect(text).toContain("已有 ASN，已核验锁定：1");
    expect(text).toContain("需要人工检查：1");
    expect(text).toContain("c.xlsx：HTTP 500");
    expect(text).toContain("d.xlsx：需要人工检查");
  });

  it("opens a Windows result dialog without exposing message text in command arguments", async () => {
    const execFile = vi.fn<ExecFileLike>(async () => ({ stdout: "", stderr: "" }));
    await showOperatorMessage("三份文件处理失败", true, execFile);
    expect(execFile).toHaveBeenCalledOnce();
    const [file, args, options] = execFile.mock.calls[0]!;
    expect(file).toBe("powershell.exe");
    expect(args).toContain("-EncodedCommand");
    expect(args.join(" ")).not.toContain("三份文件处理失败");
    expect(options.windowsHide).toBe(true);
  });
});
