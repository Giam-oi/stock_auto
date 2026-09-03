# Noon UAE ASN 创建工具操作说明

## 准备

- 六份 API JWT 凭据默认放在 `D:\noon-api`，文件名为 `noon1-API.json` 至 `noon6-API.json`。如需改目录，设置环境变量 `NOON_CREDENTIAL_DIR`。
- 企业微信机器人地址可放在 `D:\noon-api\noon-asn-wecom-webhook.txt`，或通过环境变量 `NOON_ASN_WECOM_WEBHOOK_URL` 配置。该文件不随 EXE 分发，也不进入 Git。
- 电脑需安装 Google Chrome。Chrome 只在 API 创建失败且服务器确认没有匹配 ASN 时打开，使用程序自己的隔离配置目录，不读取日常 Chrome 登录。
- 每个 `.xlsx` 文件对应一个 ASN。程序只扫描所选文件夹顶层，不扫描子文件夹，也会忽略 Excel 临时文件 `~$*.xlsx`。

## 表格规则

- 文件名必须且只能包含一个 `店铺1` 至 `店铺6`。
- 工作表名必须为 `约仓`，前三列依次为 `约仓SKU`、`数量`、`ASN`。D 列及之后的列均不校验，也不要求存在运单号列。
- SKU 位于 A 列，数量位于 B 列；数量必须是正整数，同一文件内 SKU 不得重复。
- 程序先精确核验 Noon ASN 的 SKU 和数量，再调用 Noon 官方 Seal 接口锁定；只有再次确认状态为 `sealed` 后才把 ASN 写入 `约仓!C2`。Seal 不可撤销。
- `C2` 已有内容的文件不会创建新 ASN；程序会精确核验并补执行 Seal，已经是 `sealed` 的 ASN 不会重复提交。

## 运行与恢复

双击 `NoonASNCreator.exe`，在弹窗中选择输入文件夹。控制台会立即显示发现的表格数量、当前处理文件和完成状态。程序按文件名顺序逐个处理；一个文件失败不会停止后面的文件。

程序拿到 `pendingAsn` 后会在同一次运行中立即查询并安全补齐。仍可直接安全重跑同一文件夹：已写入 `C2` 的文件会跳过；只要恢复日志已记录 `pendingAsn`，后续运行永远只查询或恢复该 ASN，不会因网络失败清零重建。若 ASN 已确认但 Excel 文件当时被占用，关闭 Excel 后重跑即可补写 `C2`。

状态说明：

- `written`：ASN 已在 Noon 精确核验、锁定并写入 `C2`。
- `skipped_existing`：`C2` 原本已有内容，ASN 已精确核验并确认锁定。
- `failed`：该文件未完成，可根据消息处理后重跑。
- `needs_review`：发现多个完全匹配 ASN、确认后原文件变化，或 Noon 路由要求把一个表拆成多个 ASN。程序不会自动写入或再创建。
- `invalid_input`：文件名、工作表、列名、SKU 或数量不符合规则。

启用企业微信机器人后，每个新完成或失败的文件会单独发送通知，最后发送本批次汇总。消息首行固定显示站点（当前程序为 `UAE`）；`skipped_existing` 不重复发送成功通知。机器人通知失败不会改变 ASN 处理结果，程序窗口会显示通知错误。

若消息为 `Noon routing requires this workbook to be split into multiple ASNs`，说明该表中的商品受 Noon 仓库或混储规则限制，不能合法放入一个 ASN。请按业务拆分规则生成多个表后再运行；原表和其不完整 ASN 不应继续提交。

若 Noon 目录返回 `unidentified` 仓储类型，或体积缺失/为 `0`，程序按操作约定把长、宽、高、重量设为 `1/1/1/1`，调用 Noon 官方尺寸分类接口取得体积和 `standard` 仓储类型，再创建商品行。此前因此进入 `needs_review` 且尚未创建主 ASN 的文件会在下次运行时自动恢复处理。

## 日志

- 恢复日志：`%LOCALAPPDATA%\NoonASNCreator\journal.json`
- 运行日志：`%LOCALAPPDATA%\NoonASNCreator\logs\YYYY-MM-DD.jsonl`
- 浏览器隔离目录：`%LOCALAPPDATA%\NoonASNCreator\browser-profile`

日志会脱敏，不记录私钥、JWT 或 Cookie。不要把凭据文件、原始认证抓包或输入表格提交到 Git。

若出现 `Noon ASN session was rejected`，说明对应 `noonN-API.json` 当前无法换取有效会话。更新该店铺 JWT 后重跑即可；已有 `pendingAsn` 不会因此被重新创建。

## 发布目录

交付目录包含 `NoonASNCreator.exe`、`noon-uae-asn.v1.json`、`操作说明.txt` 和 `LICENSES.txt`。四个文件应保持在同一目录；电脑不需要另外安装 Node.js。不要把任何 `noon*-API.json` 放入发布目录。
