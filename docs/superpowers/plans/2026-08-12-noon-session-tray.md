# Noon Session Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing resident Noon monitor behind a Windows notification-area icon so users cannot accidentally close its console window.

**Architecture:** Keep the tested TypeScript monitor executable unchanged as the worker and add a lightweight PowerShell WinForms tray host as the user-facing process. The scheduled task launches the tray host hidden; the host starts the resident worker hidden, renders recent JSONL results, supports an immediate check, opens the log directory, and performs explicit confirmed shutdown.

**Tech Stack:** PowerShell 5.1, Windows Forms, Task Scheduler COM, TypeScript/Node.js worker, Vitest.

## Global Constraints

- Closing the status window hides it and does not stop monitoring.
- Only the tray menu `退出监控` action may stop the host and worker.
- Do not read or write Noon cookies, passwords, OTP, Local Storage, or API JWTs.
- Do not restore or copy legacy Chrome User Data mirrors.
- Preserve existing logon/unlock triggers and worker single-instance behavior.
- Preserve unrelated dirty-worktree changes.

---

### Task 1: Tray state formatting

**Files:**
- Create: `apps/noon-store-login/src/tray-state.ts`
- Create: `apps/noon-store-login/tests/tray-state.test.ts`

**Interfaces:**
- Produces: `summarizeTrayState(records: SessionLogRecord[]): { severity: "healthy" | "warning" | "logout"; lines: string[] }`.

- [ ] Write a failing test with literal six-store records proving healthy, unavailable, and confirmed-logout severities plus Chinese status lines.
- [ ] Run `npm.cmd test -- tests/tray-state.test.ts` and confirm failure because the module is absent.
- [ ] Implement the minimal pure formatter.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Hidden Windows tray host

**Files:**
- Create: `apps/noon-store-login/assets/noon-tray.ps1`
- Create: `apps/noon-store-login/assets/noon-tray-launcher.vbs`

**Interfaces:**
- Consumes: `release/Noon店铺会话监控.exe`, `%LOCALAPPDATA%\NoonStoreLogin\session-monitor.jsonl`.
- Produces: notification-area icon, status window, immediate-check process, log-directory action, confirmed exit.

- [ ] Create a PowerShell WinForms host with a mutex named `Local\NoonStoreSessionTray`.
- [ ] Start the worker with `--resident --store all --site UAE --page inventory --interval-minutes 10` using `WindowStyle Hidden`.
- [ ] Read only the final six JSONL records to populate the status window and set green/yellow/red icon state.
- [ ] Add `查看六店状态`, `立即检查`, `打开日志目录`, and `退出监控` menu actions.
- [ ] Make form closing cancel and hide unless explicit exit is in progress.
- [ ] Add a VBS launcher that invokes PowerShell with `-WindowStyle Hidden -ExecutionPolicy Bypass`.
- [ ] Parse the PowerShell source and run the VBS launcher in a controlled smoke test.

### Task 3: Packaging and scheduled-task upgrade

**Files:**
- Modify: `apps/noon-store-login/scripts/package.cjs`
- Modify: `apps/noon-store-login/assets/install-resident-monitor.ps1`
- Modify: `apps/noon-store-login/assets/uninstall-resident-monitor.ps1`
- Modify: `apps/noon-store-login/README.md`

**Interfaces:**
- Scheduled task remains `NoonStoreSessionMonitor`.
- Action changes to `wscript.exe "<release>\Noon会话监控托盘.vbs"`.

- [ ] Package the PowerShell host with UTF-8 BOM and copy the VBS launcher.
- [ ] Change installer action to hidden VBS launcher while preserving logon and unlock triggers.
- [ ] Update uninstaller to stop both tray host and resident worker using owned PID metadata only.
- [ ] Document tray controls and explicit exit behavior.

### Task 4: Full verification and installation

**Files:**
- Modify only files required by failures directly attributable to Tasks 1-3.

**Interfaces:**
- Produces: installed, running tray-based scheduled task and updated release artifacts.

- [ ] Run `npm.cmd test` and confirm zero failures.
- [ ] Run `npm.cmd run typecheck` and confirm zero TypeScript errors.
- [ ] Run `npm.cmd run package:win` and confirm tray assets exist.
- [ ] Reinstall `NoonStoreSessionMonitor` and confirm the task launches `wscript.exe` with the tray VBS.
- [ ] Confirm no visible console window, tray host and exactly one resident worker are running.
- [ ] Confirm status data contains six stores and immediate check writes a newer six-record cycle.

