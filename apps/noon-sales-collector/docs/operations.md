# Noon 销售报表 API 采集器

## 输出契约

- 根目录默认：`D:\文件\销售报表文件`。
- 每个站点目录：`UAE`、`KSA`。
- 日期目录：`YYYY-MM-DD至YYYY-MM-DD销售数据`。
- 六店 CSV：`<partnerId>销售数据-<site>.csv`。
- 汇总文件：`UAE数据整合.xlsx` 或 `KSA数据整合.xlsx`。
- 汇总文件按 partner ID 升序拼接，移除 CSV 表头、`dest_country`、`bayan_nr`，保留 16 列。
- 汇总文件排除 `Cancelled` 和 `Could Not Be Delivered` 状态的订单；六店原始 CSV 保持完整不删行。
- `order_timestamp` 在汇总文件中保留日期；发货和送达时间保留到分钟。

站点暂存目录位于输出根目录的 `.sales-staging`。只有六店 CSV 全部通过店铺、站点、日期和列契约校验，且汇总工作簿成功生成后，整个站点目录才会一次发布。目标日期目录已经存在时跳过，不覆盖历史文件。

## OneDrive 汇总同步

每个站点本地发布完成后，将汇总工作簿同步到：

- KSA：`3.销售订单\1.KSA`。
- UAE：`3.销售订单\2.UAE`。

OneDrive 文件名使用日期目录规则，例如 `2026-08-14至2026-08-16销售数据.xlsx`。复制暂存阶段校验原始文件 SHA-256，幂等判断使用工作表内容 SHA-256，以兼容 OneDrive/SharePoint 自动写入 Office 包元数据；同名同内容跳过，同名不同内容报错且不覆盖。

## 构建

```powershell
cd apps\noon-sales-collector
pnpm.cmd run typecheck
pnpm.cmd test
pnpm.cmd run build
```

## 手动运行

```powershell
.\scripts\run-collector.ps1 -Site ALL -From 2026-08-19 -To 2026-08-19
```

运行输出记录到 `%LOCALAPPDATA%\NoonSalesCollector\process-logs`。成功通知格式为 `日期 销售报表已成功备份`；失败通知包含日期、运行时间和脱敏错误。相同日期区间的成功通知只投递一次。

## 计划任务

```powershell
.\scripts\install-scheduled-task.ps1 -StartTime 09:20 -Confirm:$false
```

任务名为 `NoonSalesReportCollector`，周一至周五 09:20 运行，设置为 `IgnoreNew`、`StartWhenAvailable`、执行上限两小时。任务使用当前用户交互式登录：允许锁屏，不允许注销、关机或睡眠。

可选环境变量：

- `NOON_CREDENTIAL_DIR`：默认 `D:\noon-api`。
- `NOON_SALES_OUTPUT_ROOT`：默认 `D:\文件\销售报表文件`。
- `NOON_NODE_PATH`：Node.js 可执行文件。
- `NOON_ARTIFACT_TOOL_NODE_MODULES`：包含 `@oai/artifact-tool` 的工作区依赖目录。
- `NOON_SALES_KSA_ONEDRIVE_ROOT`：覆盖 KSA 汇总同步目录。
- `NOON_SALES_UAE_ONEDRIVE_ROOT`：覆盖 UAE 汇总同步目录。

未提供日期时按北京时间计算：周一采集上周五至周日，周二至周五采集前一天，周六和周日跳过。节假日多日区间必须明确传入 `--from` 和 `--to`。
