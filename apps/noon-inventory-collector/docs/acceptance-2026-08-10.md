# Noon 实时库存采集器切产记录（2026-08-10）

## 结论

采集器已合并到 `master`，完成正式十二文件运行、历史 OneDrive 路径同步、企微成功通知和 Windows 08:00 计划任务安装。计划任务随后由 Task Scheduler 手动触发一次，退出结果为 `0`。

## 正式运行

- 运行日期：`2026-08-10`
- 本地 UAE：`D:\文件\库存文件\UAE\2026-08-10`
- 本地 KSA：`D:\文件\库存文件\KSA\2026-08-10`
- UAE OneDrive：`2. UAE资料\1. 出入库\4.2026\2026.08\2026.08.10`
- KSA OneDrive：`1. KSA资料\1. 出入库\1. Pending表\2026\2026.8\2026.08.10`
- 本地与 OneDrive：每站均为六份文件，十二组 SHA-256 逐一一致。
- UAE 文件均为 `country_code=AE`；KSA 文件均为 `country_code=SA`。
- 六店 partner 映射均与凭据配置一致。
- 企微通知状态：`success`。

## 计划任务

- 名称：`NoonRealtimeInventoryCollector`
- 状态：`Ready`
- 触发：每天 `08:00`，Windows 时区 `China Standard Time`
- 下一次触发：`2026-08-11 08:00`
- 重叠策略：`IgnoreNew`
- 错过触发：`StartWhenAvailable=true`
- 账号：当前 Windows 用户，`Interactive` 登录
- 稳定脚本：`D:\codex\stock_auto\apps\noon-inventory-collector\scripts\run-collector.ps1`
- 手动任务验收：`LastTaskResult=0`

任务仅在当前 Windows 用户保持登录时运行。第一次自然 08:00 运行后，应检查 `LastRunTime`、`LastTaskResult`、当天十二份文件快照时间和企微通知。

## 软件验证

- 测试文件：13 个
- 测试：101 个通过
- TypeScript 类型检查通过
- 生产构建通过
- 发布成功后清理空 `.staging` 父目录；失败时仍保留 staging 供排障
- API 凭据与企微地址未写入 Git 仓库
