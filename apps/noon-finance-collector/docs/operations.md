# Noon 财务报表采集器

每月 24 日北京时间 15:00 运行。默认区间为上月 1 日至本月 24 日，例如 2026-08-24 采集 2026-07-01 至 2026-08-24。

每个项目生成三个文件：

- UAE/KSA 各一份 Statements；分别使用 `AED`、`SAR` 币种导出并校验站点合同。
- Transaction View 是项目级报表，默认同时包含 AED/UAE 与 SAR/KSA，每店只下载一次。为延续历史目录命名，使用 `KSA 店铺N...transactionview...csv` 文件名，但内容为双站点。

六店共生成 18 个 CSV。文件名沿用历史前缀，例如：

- `UAE 店铺1noon_financeweb_statements.csv`
- `KSA 店铺1noon_financeweb_transactionviewreportonitemlevelwithcontractselection.csv`

本地默认目录为 `D:\文件\财务报表文件\YYYY\YYYY.MM`。OneDrive 默认目录为 `6. 财务数据\YYYY\YYYY.MM`，月份取区间起始月份。所有文件全部下载并校验后才发布；同名同内容跳过，同名不同内容停止且不覆盖。

计划任务名为 `NoonFinanceReportCollector`，设置为每月 24 日 15:00、`StartWhenAvailable`、`IgnoreNew`、执行上限两小时。任务使用当前用户交互式登录，允许锁屏，不允许注销、关机或睡眠。
