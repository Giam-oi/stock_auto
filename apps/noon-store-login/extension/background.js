const ALARM_NAME = "noon-session-keepalive";

function isValidStoreDashboard(host, title) {
  return host === "noon-store.noon.partners" && !/Partners Login/i.test(title || "");
}

function finishBadge(valid) {
  chrome.action.setBadgeBackgroundColor({ color: valid ? "#2E7D32" : "#C62828" });
  chrome.action.setBadgeText({ text: valid ? "" : "!" });
}

async function executeInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results[0]?.result;
}

async function waitFor(check, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("automatic_login_timeout");
}

async function attemptAutomaticLogin(tabId, config) {
  const base = config.bridgeBaseUrl;
  const token = encodeURIComponent(config.bridgeToken);
  const begin = await fetch(`${base}/otp-begin/${token}`, { method: "POST", cache: "no-store" });
  if (!begin.ok) throw new Error("outlook_baseline_failed");

  await waitFor(async () => executeInTab(tabId, () => {
    const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
    const buttons = [...document.querySelectorAll("button")];
    const otpInput = document.querySelector('input[aria-label="otp-input"], input[name*="otp" i], input[id*="otp" i]');
    if (otpInput) {
      const resend = buttons.find((button) => /resend|send again/i.test(normalize(button.textContent)) && !button.disabled);
      if (!resend) return false;
      resend.click();
      return true;
    }
    const continueText = [...document.querySelectorAll("button, p, div")]
      .find((element) => /^Continue with this user$/i.test(normalize(element.textContent)));
    if (continueText) {
      (continueText.closest("button") || continueText).click();
      return true;
    }
    const continueButton = buttons.find((button) => /^Continue$/i.test(normalize(button.textContent)) && !button.disabled);
    if (continueButton) {
      continueButton.click();
      return true;
    }
    return false;
  }), 25_000);

  await waitFor(() => executeInTab(tabId, () => Boolean(
    document.querySelector('input[aria-label="otp-input"], input[name*="otp" i], input[id*="otp" i]'),
  )), 20_000);

  const codeResponse = await fetch(`${base}/otp-code/${token}`, { cache: "no-store" });
  if (!codeResponse.ok) throw new Error("outlook_code_failed");
  const { code } = await codeResponse.json();
  if (!/^\d{6}$/.test(code || "")) throw new Error("invalid_verification_code");

  const filled = await executeInTab(tabId, (otpCode) => {
    const input = document.querySelector('input[aria-label="otp-input"], input[name*="otp" i], input[id*="otp" i]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, otpCode);
    else input.value = otpCode;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, [code]);
  if (!filled) throw new Error("verification_fill_failed");

  const submitted = await waitFor(() => executeInTab(tabId, () => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => /^Continue$/i.test((candidate.textContent || "").trim()) && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  }), 5_000, 200);
  if (!submitted) throw new Error("verification_submit_failed");

  await new Promise((resolve) => setTimeout(resolve, 4_000));
  await chrome.tabs.update(tabId, { url: config.targetUrl });
  const current = await waitFor(async () => {
    const candidate = await chrome.tabs.get(tabId).catch(() => null);
    return candidate?.status === "complete" ? candidate : null;
  }, 30_000);
  const url = current.url || "";
  const title = current.title || "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const valid = isValidStoreDashboard(host, title);
  return {
    valid,
    finalUrl: url,
    title,
    checkedAt: new Date().toISOString(),
    ...(valid ? { autoLogin: true } : { reason: host === "login.noon.partners" ? "automatic_login_rejected" : "automatic_login_unexpected_page" }),
  };
}

async function checkSession(config) {
  const tab = await chrome.tabs.create({ url: config.targetUrl, active: false });
  return new Promise((resolve) => {
    let settled = false;
    const complete = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      await chrome.tabs.remove(tab.id).catch(() => {});
      finishBadge(result.valid);
      await chrome.storage.local.set({ lastCheck: result, monitorConfig: config });
      resolve(result);
    };
    let loginAttempt;
    const inspect = async (tabId) => {
      const current = await chrome.tabs.get(tabId).catch(() => null);
      if (!current) return;
      const url = current.url || "";
      const title = current.title || "";
      const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
      if (host === "login.noon.partners" || /Partners Login/i.test(title)) {
        if (config.autoLogin && config.bridgeBaseUrl && config.bridgeToken) {
          if (!loginAttempt) {
            loginAttempt = attemptAutomaticLogin(tabId, config)
              .then(complete)
              .catch((error) => complete({
                valid: false,
                finalUrl: url,
                title,
                checkedAt: new Date().toISOString(),
                reason: error instanceof Error ? error.message : "automatic_login_failed",
              }));
          }
          return;
        }
        await complete({ valid: false, finalUrl: url, title, checkedAt: new Date().toISOString(), reason: "redirected_to_login" });
      } else if (current.status === "complete") {
        const valid = isValidStoreDashboard(host, title);
        await complete({ valid, finalUrl: url, title, checkedAt: new Date().toISOString(), ...(valid ? {} : { reason: "unexpected_page" }) });
      }
    };
    const onUpdated = (tabId, changeInfo) => {
      if (tabId === tab.id && (changeInfo.status === "complete" || changeInfo.url)) void inspect(tabId);
    };
    const onRemoved = (tabId) => {
      if (tabId === tab.id && !settled) void complete({ valid: false, finalUrl: "", title: "", checkedAt: new Date().toISOString(), reason: "tab_closed" });
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    const timer = setTimeout(() => {
      void complete({ valid: false, finalUrl: "", title: "", checkedAt: new Date().toISOString(), reason: "timeout" });
    }, config.autoLogin ? 115000 : 30000);
    void inspect(tab.id);
  });
}

async function configureAndCheck(config) {
  await chrome.storage.local.set({ monitorConfig: config });
  const periodInMinutes = Math.max(1, config.intervalMinutes || 10);
  if (config.alarmMode === "fallback") {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: periodInMinutes * 2,
      periodInMinutes,
    });
  } else {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
  }
  return checkSession(config);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "configure-monitor") {
    configureAndCheck(message.config).then(respond, (error) => respond({
      valid: false,
      finalUrl: "",
      title: "",
      checkedAt: new Date().toISOString(),
      reason: error instanceof Error ? error.message : "check_failed",
    }));
    return true;
  }
  if (message?.type === "close-bridge-tab" && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    respond({ ok: true });
    return;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  chrome.storage.local.get("monitorConfig").then(({ monitorConfig }) => {
    if (monitorConfig) return checkSession(monitorConfig);
  }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get("monitorConfig").then(({ monitorConfig }) => {
    if (monitorConfig) return configureAndCheck(monitorConfig);
  }).catch(() => {});
});
