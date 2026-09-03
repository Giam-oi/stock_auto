const FACTORS = {
  observe: { midnight: 1, trough: 1, baseline: 1, peak: 1, late: 1 },
  optimize: { midnight: 0.90, trough: 0.90, baseline: 1, peak: 1.05, late: 0.95 },
  maintain: { midnight: 0.90, trough: 0.90, baseline: 1, peak: 1, late: 0.95 },
  hard_pass: { midnight: 0.90, trough: 0.90, baseline: 1, peak: 1, late: 0.95 },
  hard_fail: { midnight: 0.90, trough: 0.90, baseline: 0.90, peak: 0.90, late: 0.90 },
  severe: { midnight: 0.85, trough: 0.85, baseline: 0.85, peak: 0.85, late: 0.85 },
  zero_order_watch: { midnight: 0.85, trough: 0.85, baseline: 0.85, peak: 0.85, late: 0.85 },
  zero_order_stop: { midnight: 0.85, trough: 0.85, baseline: 0.85, peak: 0.85, late: 0.85 },
};

const RISK = {
  optimize: 0, maintain: 1, hard_pass: 2, observe: 2,
  hard_fail: 3, severe: 4, zero_order_watch: 5, zero_order_stop: 6,
};

export function dubaiHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai", hour: "2-digit", hourCycle: "h23",
  }).format(now));
}

export function periodForHour(hour) {
  if (hour >= 0 && hour <= 3) return "midnight";
  if (hour >= 4 && hour <= 7) return "trough";
  if (hour >= 8 && hour <= 18) return "baseline";
  if (hour >= 19 && hour <= 22) return "peak";
  return "late";
}

export function classifyPerformance({ roas, spends, orders, ageDays }) {
  const values = [roas, spends, orders, ageDays].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return { tier: "observe", reason: "Target指标不完整" };
  if (ageDays < 7) return { tier: "observe", reason: "Target所属Campaign不足7天" };
  if (orders === 0 && spends >= 20) return { tier: "zero_order_stop", reason: "Target近14日消耗达到AED 20且0单", pauseTarget: true };
  if (orders === 0 && spends >= 10) return { tier: "zero_order_watch", reason: "Target近14日0单且消耗达到AED 10" };
  if (spends < 10) return { tier: "observe", reason: "Target近14日消耗不足AED 10" };
  if (roas < 5) return { tier: "severe", reason: "Target近14日ROAS低于5" };
  if (roas < 8) return { tier: "hard_fail", reason: "Target近14日ROAS低于硬线8" };
  if (roas < 10) return { tier: "hard_pass", reason: "Target达到硬线8但未达到优化目标10" };
  if (roas < 12 || orders < 3 || spends < 30) {
    return { tier: "maintain", reason: "Target ROAS达到10但未满足ROAS 12扩量条件" };
  }
  return { tier: "optimize", reason: "Target ROAS达到12且订单样本充分" };
}

export function resolvePolicyCooldown(next, previous, now, cooldownDays = 7) {
  if (!previous?.tier || previous.tier === next.tier) return next;
  const previousAt = Date.parse(previous.policyUpdatedAt ?? "");
  const withinCooldown = Number.isFinite(previousAt)
    && now.getTime() - previousAt < cooldownDays * 86_400_000;
  const nextRisk = RISK[next.tier] ?? 2;
  const previousRisk = RISK[previous.tier] ?? 2;
  if (withinCooldown && nextRisk < previousRisk) {
    return {
      tier: previous.tier, reason: `${previous.reason ?? previous.tier}；7天冷却期内暂不恢复`,
      pauseTarget: previous.pauseTarget === true,
    };
  }
  return next;
}

export function factorFor(tier, period) {
  return FACTORS[tier]?.[period] ?? 1;
}

export function roundBid(baseBid, factor, minimum = 0.25) {
  const value = Math.round((Number(baseBid) * Number(factor) + Number.EPSILON) * 100) / 100;
  return Math.max(minimum, value);
}
