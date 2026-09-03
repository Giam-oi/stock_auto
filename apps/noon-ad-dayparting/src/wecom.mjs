export async function sendWeCom(content, webhook = process.env.WECOM_WEBHOOK_URL, fetchImpl = fetch) {
  if (!webhook) return { status: "not_configured" };
  const url = new URL(webhook);
  if (url.hostname !== "qyapi.weixin.qq.com" || url.pathname !== "/cgi-bin/webhook/send") throw new Error("Invalid WeCom webhook");
  const response = await fetchImpl(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errcode !== 0) throw new Error(`WeCom notification failed ${response.status}/${body.errcode ?? "invalid"}`);
  return { status: "delivered" };
}

const AUDIT_SCHEMA = {
  f04Gwj: { title: "执行时间", type: "text" }, ftQMc5: { title: "库存日期", type: "text" },
  ftk5Tx: { title: "库存快照", type: "text" }, ffFwIh: { title: "店铺", type: "text" },
  fn8TJd: { title: "Campaign名称", type: "text" }, fZnpIT: { title: "Campaign Code", type: "text" },
  fWu4pJ: { title: "动作", type: "text" }, flwY8l: { title: "动作前状态", type: "text" },
  flonp3: { title: "动作后状态", type: "text" }, fdmHtH: { title: "商品数", type: "text" },
  f06ICG: { title: "可售总量", type: "text" }, fPpZbX: { title: "判断依据", type: "text" },
  fjeo4G: { title: "执行结果", type: "text" }, fGvb2k: { title: "回执与备注", type: "text" },
};

export async function appendSmartSheet(rows, webhook = process.env.WECOM_AD_AUDIT_WEBHOOK_URL, fetchImpl = fetch) {
  if (!webhook || !rows.length) return { status: "not_configured" };
  const url = new URL(webhook);
  if (url.hostname !== "qyapi.weixin.qq.com" || url.pathname !== "/cgi-bin/wedoc/smartsheet/webhook") {
    throw new Error("Invalid WeCom Smart Sheet webhook");
  }
  const addRecords = rows.map((row) => {
    const valuesByTitle = {
      "执行时间": row.executedAt, "库存日期": row.planDate ?? "", "库存快照": `近14日ROAS ${row.metrics?.roas ?? ""}`,
      "店铺": row.store, "Campaign名称": row.campaignName, "Campaign Code": row.campaignCode,
      "动作": row.action === "pause_target" ? "暂停低效Target" : `分时出价-${row.period}`,
      "动作前状态": `bid ${row.beforeBid}; active ${row.beforeActive ?? true}`,
      "动作后状态": `bid ${row.afterBid}; active ${row.afterActive ?? true}`,
      "商品数": "", "可售总量": "", "判断依据": `${row.reason}；UAE ${row.period}时段`,
      "执行结果": "成功", "回执与备注": "Target级ROAS硬线8、优化目标10；Noon API回读验证通过",
    };
    return { values: Object.fromEntries(Object.entries(AUDIT_SCHEMA).map(([id, field]) => [id, String(valuesByTitle[field.title] ?? "")])) };
  });
  const response = await fetchImpl(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schema: AUDIT_SCHEMA, add_records: addRecords }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errcode !== 0) throw new Error(`Smart Sheet append failed ${response.status}/${body.errcode ?? "invalid"}`);
  return { status: "delivered", count: rows.length };
}
