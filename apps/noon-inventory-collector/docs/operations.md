# Noon 实时库存采集器运维手册

## 运行边界

采集器每天北京时间 08:00 获取六店 UAE 和 KSA 实时库存，并分别以六份完整文件集发布。它不启动 Chrome、不读取邮箱验证码，也不使用影刀。计划任务采用当前 Windows 用户的 `Interactive` 登录方式，因此只有该用户处于登录状态时才会运行；如需在注销状态运行，应改用专用服务账号并单独评审凭据保存方式。

采集器先发布本地 `D:\文件\库存文件`，再把同一组六份完整文件发布到对应 OneDrive 历史源目录。只有两个位置都成功，站点才算成功。

- KSA：`1. Pending表\YYYY\YYYY.M\YYYY.MM.DD\SA1...SA6.csv`
- UAE：`1. 出入库\4.YYYY\YYYY.MM\YYYY.MM.DD\UAE1...UAE6.csv`

工作簿备份目录与 CSV 源目录分开，不能把 CSV 写入 `2. 库存表` 或 `2. 库存`。

## 首次构建

```powershell
cd D:\codex\stock_auto\apps\noon-inventory-collector
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
Test-Path .\dist\src\cli.js
```

最后一条必须返回 `True`。

## 凭据保护

六份凭据应保持在 `D:\noon-api\noon1-API.json` 至 `noon6-API.json`。以下命令移除继承权限，只授予当前用户完全控制；执行前应确认当前账号就是计划任务账号：

```powershell
icacls "D:\noon-api" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F"
```

私钥轮换后保持文件名与店铺编号不变，并先执行单店 dry-run。不得把凭据复制到项目、日志或聊天中。

## 配置已轮换的企微 Webhook

先在企业微信中轮换此前暴露过的机器人地址，然后在本机交互录入新地址：

```powershell
$secure = Read-Host "Paste the rotated WeCom webhook" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [Environment]::SetEnvironmentVariable("WECOM_WEBHOOK_URL", $plain, "User")
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable plain, secure -ErrorAction SilentlyContinue
}
```

关闭并重新打开终端后，用 `[Environment]::GetEnvironmentVariable("WECOM_WEBHOOK_URL", "User")` 只检查是否非空，不要打印完整值。

可选配置：

- `NOON_CREDENTIAL_DIR`：默认 `D:\noon-api`。
- `NOON_OUTPUT_ROOT`：默认 `D:\文件\库存文件`。
- `NOON_SNAPSHOT_MAX_AGE_MINUTES`：默认 `60`。
- `NOON_NODE_PATH`：覆盖计划任务使用的 `node.exe`。
- `NOON_KSA_ONEDRIVE_ROOT`：覆盖 KSA 的 `1. Pending表` 根目录。
- `NOON_UAE_ONEDRIVE_ROOT`：覆盖 UAE 的 `1. 出入库` 根目录。

## Dry-run

Dry-run 不发送企微通知、不写正式日期目录，必须显式提供隔离输出目录。

```powershell
node .\dist\src\cli.js dry-run --site UAE --store 1 --out "$env:TEMP\noon-uae1-dry-run"
node .\dist\src\cli.js dry-run --out "$env:TEMP\noon-all-dry-run"
```

退出码：`0` 成功，`1` 采集失败，`2` 参数或配置错误，`3` 已有实例持有运行锁。

## 安装和检查 08:00 计划任务

先预览，不修改系统：

```powershell
.\scripts\install-scheduled-task.ps1 -Preview
```

确认 Windows 时区为中国标准时间，再安装：

```powershell
Get-TimeZone
.\scripts\install-scheduled-task.ps1 -Confirm:$false
Get-ScheduledTask -TaskName NoonRealtimeInventoryCollector | Format-List TaskName,State
Get-ScheduledTaskInfo -TaskName NoonRealtimeInventoryCollector
```

手动触发和检查结果：

```powershell
Start-ScheduledTask -TaskName NoonRealtimeInventoryCollector
Start-Sleep -Seconds 5
Get-ScheduledTaskInfo -TaskName NoonRealtimeInventoryCollector
```

禁用、启用和卸载：

```powershell
Disable-ScheduledTask -TaskName NoonRealtimeInventoryCollector
Enable-ScheduledTask -TaskName NoonRealtimeInventoryCollector
Unregister-ScheduledTask -TaskName NoonRealtimeInventoryCollector -Confirm:$false
```

计划任务设置为 `IgnoreNew`，不会并发运行；电脑在 08:00 不可用时，恢复后会尝试补跑。进程日志位于 `%LOCALAPPDATA%\NoonInventoryCollector\process-logs`，结构化日志位于 `%LOCALAPPDATA%\NoonInventoryCollector\logs`。

## 故障含义与恢复

- `authentication`：API 凭据失效、项目不匹配或登录被拒绝；在 Noon API Users 中轮换对应店铺密钥。
- HTTP `429`：限流；程序会按 30 秒、90 秒重试，仍失败则等待下一次人工或定时运行。
- HTTP `5xx` / `timeout` / `network`：Noon 或网络瞬时故障，会自动重试三次。
- `stale snapshot`：Noon 返回快照超过 60 分钟；不得用日报或昨天文件代替。
- `country`：地区响应不符；检查 `en-ae`/`en-sa`、`Country-Code: ae/sa` 与 Noon 服务状态。`X-Locale` 本身不能完成 KSA 库存切换。
- `partner`：凭据项目与返回店铺不符；停止发布并检查凭据映射。
- `missing required header`：内部实时接口结构变化；更新解析器前不得降级到旧报表。
- `publish`：本地发布失败；程序会恢复原六份文件并保留 staging 供排查。
- `onedrive-staging` / `onedrive-publish`：本地文件已经成功，但 OneDrive 历史目录写入失败；该站点仍按失败处理，09:00 下游不得更新。
- `notification`：CSV 可能已经成功发布，但企微发送失败；以结构化日志和文件校验结果为准，修复 Webhook 后重新运行。
- 退出码 `3` 且确认没有 Node 进程：可能是上次异常退出留下锁文件，可在确认无运行实例后删除 `%LOCALAPPDATA%\NoonInventoryCollector\collector.lock`。

## 与 09:00 下游流程衔接

09:00 下游应直接读取上面两个站点的 `YYYY.MM.DD` 日期目录，并各自要求六个精确文件名全部存在。OneDrive 客户端必须保持登录和同步正常。
