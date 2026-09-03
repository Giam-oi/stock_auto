(async () => {
  if (!location.pathname.startsWith("/bridge/")) return;
  const token = location.pathname.split("/").filter(Boolean).pop();
  let result;
  try {
    const response = await fetch(`/config/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("configuration unavailable");
    const config = await response.json();
    result = await chrome.runtime.sendMessage({ type: "configure-monitor", config });
  } catch (error) {
    result = {
      valid: false,
      finalUrl: "",
      title: "",
      checkedAt: new Date().toISOString(),
      reason: error instanceof Error ? error.message : "bridge_failed",
    };
  }
  await fetch(`/complete/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  }).catch(() => {});
  document.addEventListener("DOMContentLoaded", () => {
    document.body.textContent = result.valid ? "Noon 登录状态正常。" : "Noon 登录已失效。";
  });
  setTimeout(() => chrome.runtime.sendMessage({ type: "close-bridge-tab" }).catch(() => {}), 300);
})();
