# Noon Background Focus Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all scheduled and tray-triggered Noon checks in the background without stealing the user's active window or automatically opening login pages.

**Architecture:** Add a small Windows foreground-window guard around each Chrome profile launch, restoring the captured foreground window after Chrome is invoked. Add an explicit `openLoginOnLogout` policy so resident and tray checks only record/indicate logout while interactive one-shot runs may retain the old behavior.

**Tech Stack:** TypeScript, Node.js 22, Win32 user32 via a small PowerShell focus helper, Vitest, packaged Windows EXE.

## Global Constraints

- Scheduled and tray-triggered checks must not leave Chrome in the foreground.
- Resident mode must not automatically open a login page.
- Do not read/write cookies, passwords, OTP, Local Storage, or API JWTs.
- Preserve six real Chrome Profiles and temporary-tab checks.
- Preserve unrelated dirty-worktree changes.

---

### Task 1: Logout presentation policy

**Files:**
- Modify: `apps/noon-store-login/src/main.ts`
- Modify: `apps/noon-store-login/src/cli.ts`
- Modify: `apps/noon-store-login/tests/cli.test.ts`

**Interfaces:**
- Produces: `Options.openLoginOnLogout: boolean`, false for `--resident` and true for ordinary one-shot mode.

- [ ] Write a failing test proving resident mode disables automatic login presentation.
- [ ] Run the focused test and confirm the expected failure.
- [ ] Implement the minimal option and gate `shouldOpenLoginPage` in `main.ts`.
- [ ] Re-run focused tests.

### Task 2: Foreground-window restoration

**Files:**
- Create: `apps/noon-store-login/assets/restore-foreground.ps1`
- Modify: `apps/noon-store-login/src/chrome.ts`
- Modify: `apps/noon-store-login/scripts/package.cjs`

**Interfaces:**
- `launchChromeProfile` captures the current foreground HWND before spawn and invokes the packaged helper asynchronously after Chrome launch.

- [ ] Add a controlled foreground-probe reproduction that shows Chrome can steal focus before the change.
- [ ] Implement a helper using `GetForegroundWindow` and `SetForegroundWindow` without enumerating page content.
- [ ] Package the helper with UTF-8 BOM and invoke it hidden after profile launch.
- [ ] Re-run the probe and confirm the original foreground process remains active through a six-profile check.

### Task 3: Verification and live upgrade

**Files:**
- Update documentation only if behavior description is now inaccurate.

**Interfaces:**
- Produces updated release EXE and restarted tray/worker.

- [ ] Run the full test suite and typecheck.
- [ ] Stop tray/worker, package the new EXE, reinstall the tray task, and confirm both processes return.
- [ ] Trigger an immediate six-store check while a non-Chrome window is foreground and confirm focus remains on that window.
- [ ] Confirm six new log records are written and no automatic login page is left open.

