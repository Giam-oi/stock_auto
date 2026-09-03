# Noon Session Resident Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Noon session monitor a single-instance resident Windows process that starts at user logon, recovers after resume/unlock, and checks all six profiles every 10 minutes.

**Architecture:** Extend the existing CLI with an explicit resident mode, isolate scheduling and single-instance behavior into testable modules, and generate Windows Task Scheduler install/uninstall scripts in the release package. The existing extension remains the per-profile tab executor and fallback only.

**Tech Stack:** TypeScript, Node.js 22, Vitest, Windows Task Scheduler (`schtasks.exe`), packaged EXE via `@yao-pkg/pkg`.

## Global Constraints

- Do not read or write Noon cookies, passwords, OTP, Local Storage, or API JWTs.
- Do not restore or copy legacy Chrome User Data mirrors.
- A temporary Chrome/extension failure is unavailable and must be retried, not classified as logout.
- Only `login.noon.partners` or title `Partners Login` confirms logout.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Resident CLI and scheduling primitives

**Files:**
- Modify: `apps/noon-store-login/src/cli.ts`
- Create: `apps/noon-store-login/src/resident.ts`
- Modify: `apps/noon-store-login/tests/cli.test.ts`
- Create: `apps/noon-store-login/tests/resident.test.ts`

**Interfaces:**
- Produces: `Options.resident: boolean`, `runResidentLoop(check: () => Promise<void>, intervalMs: number, signal?: AbortSignal): Promise<void>`.

- [ ] Write failing tests proving `--resident` parses and the resident loop checks immediately, waits one interval, retries after a failed check, and stops on abort.
- [ ] Run `npm test -- tests/cli.test.ts tests/resident.test.ts` and confirm failures are caused by missing resident behavior.
- [ ] Implement the smallest parser and loop needed to pass.
- [ ] Re-run focused tests and confirm they pass.

### Task 2: Single-instance resident integration

**Files:**
- Create: `apps/noon-store-login/src/single-instance.ts`
- Create: `apps/noon-store-login/tests/single-instance.test.ts`
- Modify: `apps/noon-store-login/src/main.ts`

**Interfaces:**
- Produces: `acquireSingleInstance(lockPath: string): Promise<{ acquired: boolean; release(): Promise<void> }>`.
- Consumes: `runResidentLoop` from Task 1 and existing `checkStores`/`writeLog` behavior.

- [ ] Write a failing test proving the first owner acquires the lock, a second live owner is rejected, and a stale lock can be replaced.
- [ ] Run the focused test and confirm expected failure.
- [ ] Implement atomic lock acquisition with PID metadata and safe stale-lock recovery.
- [ ] Wire `--resident` to force all stores, perform an immediate check, repeat every configured interval, and release the lock on termination.
- [ ] Run focused tests and the existing monitor tests.

### Task 3: Windows scheduled-task installation

**Files:**
- Create: `apps/noon-store-login/assets/install-resident-monitor.ps1`
- Create: `apps/noon-store-login/assets/install-resident-monitor.cmd`
- Create: `apps/noon-store-login/assets/uninstall-resident-monitor.ps1`
- Modify: `apps/noon-store-login/scripts/package.cjs`
- Modify: `apps/noon-store-login/README.md`
- Create: `apps/noon-store-login/tests/package.test.ts`

**Interfaces:**
- Scheduled task name: `NoonStoreSessionMonitor`.
- Command: packaged EXE with `--resident --store all --site UAE --page inventory --interval-minutes 10`.

- [ ] Write a failing packaging test asserting the installer/uninstaller assets and resident command are copied into `release`.
- [ ] Run the focused test and confirm it fails before packaging changes.
- [ ] Implement scripts that register logon and workstation-unlock triggers, use restart-on-failure settings, and immediately start the task.
- [ ] Update packaging and usage documentation.
- [ ] Run packaging tests.

### Task 4: Verification, packaging, and local installation

**Files:**
- Modify only files required by failures directly attributable to Tasks 1-3.

**Interfaces:**
- Produces: updated `release/Noon店铺会话监控.exe` plus installer/uninstaller scripts.

- [ ] Run `npm test` and confirm the full suite passes.
- [ ] Run `npm run typecheck` and confirm no TypeScript errors.
- [ ] Run `npm run package:win` and confirm release artifacts are created.
- [ ] Execute the resident-monitor installer locally.
- [ ] Verify the scheduled task and exactly one resident process exist.
- [ ] Verify a new log cycle contains six store results without exposing session secrets.

