# Noon UAE/KSA 广告报表自动更新

`NoonAdvertisingReportCollector` 每天 09:20 分别检查两个站点。UAE 周期固定为周四至周三，周四处理新周期；KSA 周期固定为周五至周四，周五处理新周期。

程序使用 `D:\noon-api` 六店 API 凭据登录 Noon，直接调用广告后台导出接口，不依赖 Chrome。每个站点的六店报表全部通过 `(Product) Campaign` 表头校验后，程序先将 OneDrive 正式工作簿备份到 `1.3 运营日常资料\4. 广告数据`，再向 `Raw Data` 追加 Campaign 数据。可通过 `NOON_AD_BACKUP_DIRECTORY` 覆盖备份目录。去重键为周期、店铺、国家和 Campaign 名称。共享 `Config!B2` 仅在周五 KSA 更新完成后推进到新周，避免周四 UAE 先更新时 KSA 仪表板显示为 0。

企微成功通知分三条：站点广告数据源已下载、广告表已备份、站点广告表已更新。失败也会通知。每个站点、周期、阶段只成功投递一次。

安装任务：

```powershell
.\scripts\install-scheduled-task.ps1 -StartTime 09:20 -Confirm:$false
.\scripts\install-monitor-task.ps1 -StartTime 10:15 -Confirm:$false
```

手动运行：

```powershell
.\scripts\run-collector.ps1
```

日志位于 `%LOCALAPPDATA%\NoonAdCollector\process-logs`，机器可读结果位于 `%LOCALAPPDATA%\NoonAdCollector\last-result.json`。10:15 守护任务同时检查主任务的 `IgnoreNew`、`StartWhenAvailable`、`PT2H`、当天退出码与最新周期结果，异常时发送企微失败通知。任务允许锁屏，但当前用户必须保持登录；注销、关机或睡眠时不能运行，唤醒后由 `StartWhenAvailable` 补跑。
