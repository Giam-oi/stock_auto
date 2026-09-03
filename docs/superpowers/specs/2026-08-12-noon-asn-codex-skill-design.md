# Noon ASN Codex 技能包设计

## 目标

创建可迁移的 Codex 技能 `noon-asn-operations`，使另一台 Windows 电脑上的 Codex 能按当前业务规则处理 Noon ASN、锁定、通知和绿通表追加。生成位置：

- 本机技能：`C:\Users\admin\.codex\skills\noon-asn-operations`
- 迁移压缩包：`D:\Noon-ASN-Codex技能包.zip`

## 技能范围

技能覆盖以下流程：

1. 从一个文件夹读取约仓 Excel 文件，一个文件对应一个 ASN。
2. 根据文件名中的店铺号选择同一套 Noon API 凭证，并根据实际项目识别 UAE 或 KSA。
3. 创建 ASN，精确核验服务器结果，将 ASN 写回原约仓表指定单元格。
4. 锁定（Seal）已创建 ASN；结果不确定时先恢复和核验，禁止重复创建。
5. 按站点前缀发送企业微信成功或失败通知。
6. 成功创建后，仅向 `D:\桌面\绿通申请表模板.xlsx` 追加缺失 ASN，不删除或覆盖旧数据。

## 绿通表规则

固定列映射沿用现有模板：

- 填写日期：执行当天。
- 客户经理：`Karen`。
- Category：按店铺既有映射填写。
- PID：实际店铺 Partner ID。
- ASN：已核验的 ASN 编号。
- Country：UAE=`AE`，KSA=`SA`。
- Type：`OOS`。
- WH code：优先使用 ASN 的实际目标仓；无法取得时 AE=`AUH01S`，SA=`RUH01S`。
- Date：留空，由人工填写送仓日期。
- QTY：ASN 所有 SKU 的创建数量合计。

追加前扫描 ASN 列；已存在的 ASN 必须跳过。只追加新行，并复制上一条数据行的样式、日期格式和表格范围规则。

## 可迁移配置

技能包不嵌入任何敏感信息。新电脑安装后通过本地配置指定：

- Noon API 凭证目录和各店凭证文件。
- 绿通模板路径。
- 企业微信机器人 Webhook，由本地环境变量或忽略版本控制的配置文件提供。
- 可执行程序或源码仓库路径。

API 私钥、JWT、Cookie、Webhook 密钥、原始业务表和运行日志不得进入技能包或 Git。

## 资源结构

```text
noon-asn-operations/
├── SKILL.md
├── agents/openai.yaml
├── scripts/
│   ├── preflight.ps1
│   └── install.ps1
├── references/
│   ├── setup.md
│   ├── workflow.md
│   ├── field-mapping.md
│   └── recovery.md
└── assets/
    └── config.example.json
```

`SKILL.md` 保持精简，详细安装、字段和恢复规则按需读取。脚本只做环境检查与安装，不包含凭证，也不直接创建或取消真实 ASN。

## 安装体验

另一台电脑解压后运行安装脚本，将技能复制到当前用户的 Codex skills 目录。安装说明指导用户：

1. 安装或复制 ASN 程序/仓库。
2. 放置 Noon API 凭证。
3. 创建本地配置并填入模板、凭证和机器人地址。
4. 重启 Codex。
5. 用“建立 ASN 并更新绿通表”等自然语言触发技能。

预检脚本只报告缺失项和路径，不打印敏感值。

## 安全与幂等

- 只处理用户明确选择的文件或文件夹。
- 写回 ASN 前必须精确核验 Noon 服务器记录。
- 存在 pending/recovery 状态时禁止重新创建。
- 单文件失败不阻断后续文件。
- 只有已核验成功的 ASN 才能锁定、通知和追加绿通表。
- 绿通表使用 ASN 去重；任何失败都不得删除旧行。
- Cancel ASN、预约日期、下载 PDF 等不属于默认自动动作，须用户明确授权。

## 验证

- 使用官方技能校验脚本检查目录、frontmatter 和 UI 元数据。
- 在无凭证测试环境运行预检，确认只报告缺失配置且不泄露值。
- 使用脱敏样例验证 AE/SA、仓库默认值、QTY 汇总和 ASN 去重。
- 检查 ZIP 内容，确认没有 `.json` 私钥、Cookie、JWT、Webhook 密钥、业务 Excel 或日志。
- 在临时 Codex skills 目录执行安装测试并确认技能可被发现。
