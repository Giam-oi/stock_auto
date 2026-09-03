const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function targetMaxPosition(period) {
  return period === "peak" ? 3 : 20;
}

export function nextMinimumBid(input) {
  const current = Number(input.currentBid);
  const minimum = Math.max(0.25, Number(input.minimumBid ?? 0.25));
  const maximum = Number(input.maximumBid);
  if (![current, minimum, maximum].every(Number.isFinite) || maximum < minimum) return { action: "hold", reason: "invalid_bounds" };
  if (Number(input.samplesInPeriod ?? 0) < 3) return { action: "hold", reason: "insufficient_rank_samples" };
  if (Number(input.roas) < 8 || Number(input.orders) < 1) return { action: "hold", reason: "roas_or_order_guard" };
  const targetMax = targetMaxPosition(input.period);
  const passed = Number.isFinite(Number(input.adPosition)) && Number(input.adPosition) <= targetMax;
  let lowerFail = Number.isFinite(Number(input.lowerFailBid)) ? Number(input.lowerFailBid) : null;
  let upperPass = Number.isFinite(Number(input.upperPassBid)) ? Number(input.upperPassBid) : null;
  if (passed) upperPass = upperPass == null ? current : Math.min(upperPass, current);
  else lowerFail = lowerFail == null ? current : Math.max(lowerFail, current);
  let desired = current;
  if (passed) {
    const floor = lowerFail == null ? minimum : lowerFail;
    if (current - floor >= 0.02) desired = round((current + floor) / 2);
  } else if (upperPass != null && upperPass - current >= 0.02) {
    desired = round((current + upperPass) / 2);
  } else {
    desired = round(Math.min(maximum, Math.max(current + 0.05, current * 1.1)));
  }
  if (Math.abs(desired - current) < 0.009) return { action: "hold", reason: passed ? "minimum_band_converged" : "maximum_bound_reached", lowerFail, upperPass, targetMax };
  return { action: "propose", desiredBid: desired, direction: desired < current ? "down" : "up", lowerFail, upperPass, targetMax };
}
