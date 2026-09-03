# Noon UAE 分时出价

本程序不调用 Codex 或任何大模型。每天北京时间 10:25 使用当天库存文件和截至前一完整日的14天广告报表重建 UAE 六店分时计划，只纳入至少有一个 `Live + FBN + saleable>0` 商品的 Live Campaign。`auto keyword`、`auto category`和手动Target按各自的消耗、订单、收入与ROAS独立判断，不再共享Campaign总ROAS。每日五个时段边界读取本地计划，按 Target 修改 bid 或暂停0单高消耗Target，并回读验证。

- UAE 04:00-07:59：最低谷。
- UAE 08:00-18:59：基准时段。
- UAE 19:00-22:59：高峰。
- Target所属Campaign不足7天或Target近14日消耗低于AED10：保持当前bid，不做分时恢复。
- Target近14日0单且消耗达到AED10：降价15%；达到AED20：通过Target stash暂停。
- Target ROAS低于5：降价15%；ROAS 5-8：降价10%；ROAS 8-10保持；ROAS 10-12保持；仅ROAS>=12、订单>=3且消耗>=AED30允许高峰提价5%。
- 前一完整日全店ROAS低于8时禁止提价；0单探索Target的昨日消耗按店铺限制为总消耗的20%。
- 风险恶化立即执行；表现改善后的恢复受7天策略冷却保护。
- 2026-09-09 00:00 UAE前启用只降不升保护模式；到期后仍受昨日全店ROAS>=8的提价门槛约束。
- `C_YJ2S0828WZ` 与手动精准词试点 `C_YNLBNZN399` 始终排除。
- 无法唯一映射到14天Target报表的目标只跳过并记录，绝不回退到Campaign总ROAS猜测。
- 线上值与上次回读值冲突：跳过，不覆盖人工修改。
- 任何批次回读失败：回滚该广告组。
- 正常运行只写本地日志；默认仅失败发送企微通知。

```powershell
npm test
node src/cli.mjs seed
.\scripts\run.ps1 -Mode evaluate -DryRun
.\scripts\run.ps1 -Mode evaluate
.\scripts\run.ps1 -Mode apply -DryRun
.\scripts\install-scheduled-task.ps1 -Confirm:$false
```
