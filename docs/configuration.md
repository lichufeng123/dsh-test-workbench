# Configuration / 配置说明

[English overview](../README.md) · [中文介绍](../README.zh-CN.md) · [API](API.md) · [Security / 安全](../SECURITY.md)

Applies to `dsh-test-workbench` 0.1.0, DSH `>=0.2.2-rc.1`, and Node.js `>=22`.

适用于 `dsh-test-workbench` 0.1.0、DSH `>=0.2.2-rc.1`、Node.js `>=22`。

## Choose the workspace / 选择工作区

Configure the installed plugin entry in your active DSH profile's Cordis patch. Use an existing directory and an absolute path so records go to the workspace you intend. Changing `workspaceRoot` remounts the plugin.

在当前 DSH profile 的 Cordis patch 中配置已安装的插件条目。建议使用已存在目录的绝对路径，明确记录归属；修改 `workspaceRoot` 会重新挂载插件。

```yaml
- id: dsh-test-workbench
  config:
    workspaceRoot: /absolute/path/to/test-project
    report:
      enabled: false
```

If `workspaceRoot` is empty or omitted, it uses the **DSH Host process's working directory**, which may differ from the project open in your conversation. Work items, imported sources, rounds, evidence drafts, attachments, and report jobs live under that workspace's `.ai-test/`. Input drafts also use browser local storage. Keep both out of public repositories and shared screenshots.

`workspaceRoot` 留空或省略时，使用 **DSH Host 进程的当前工作目录**，不一定等于对话中打开的项目。工作项、导入来源、轮次、附件草稿、证据和报告任务保存在该目录的 `.ai-test/` 下；输入草稿还使用浏览器本地存储。不要公开这些数据。

## Model behavior / 模型行为

The plugin reuses DSH's configured model. When available, it can be invoked automatically when creating/replanning a round or generating a report. Ordering uses case descriptions, preconditions, fixture descriptions, dependencies, and status; summaries use expected and recorded results, step observations, and evidence counts. These texts may reach the configured model provider.

插件复用 DSH 配置的模型，可在创建／重新编排轮次、生成报告时自动调用。排序使用用例说明、前置条件、测试对象说明、依赖与状态；概述使用预期、已记录结果、步骤观察与证据数量。这些文本可能发送给所配置的模型服务商。

`report.enabled: false` disables **external publishing**; it is not an AI opt-out switch. There is no separate plugin model or AI-disable setting in version 0.1.0. Without an available host model, rule-based ordering, manual recording, and local report preview remain available. External publishing currently needs the host model.

`report.enabled: false` 关闭的是 **外部发布**，不关闭 AI。`0.1.0` 没有独立模型配置或插件级 AI 关闭开关。宿主模型不可用时，规则排序、人工记录和本地报告预览仍可使用；当前外部发布需要宿主模型。

## Optional Feishu / Lark publishing / 可选飞书发布

Publication is disabled by default. Separately install a compatible `lark-cli` and authenticate it using **your own user identity** through its supported authorization flow. The plugin does not install the CLI or obtain user authorization for you. Replace all example values below with your identity and directories; do not store tokens or passwords in the patch.

发布默认关闭。请单独安装兼容的 `lark-cli`，通过其支持的授权流程登录 **自己的用户身份**；插件不负责安装 CLI 或代办用户授权。以下示例值全部替换为自己的身份和目录，不要把口令、Token 写入配置。

```yaml
- id: dsh-test-workbench
  config:
    workspaceRoot: /absolute/path/to/test-project
    report:
      enabled: true
      binary: lark-cli
      profile: ""
      expectedUserName: Your Name
      expectedOpenId: YOUR_OPEN_ID
      productDirectory: https://example.feishu.cn/wiki/PRODUCT_DIRECTORY
      historyDirectory: https://example.feishu.cn/wiki/HISTORY_DIRECTORY
      directoryKind: product
```

The publisher calls the CLI with `--as user`, checks the active user against any configured identity expectations, and verifies report ownership and body access. Use the expectations to bind publication to your intended account. CLI credentials stay in the CLI's supported credential store.

发布器带 `--as user` 调用 CLI，按所配置的条件核对当前用户，并检查报告所有者和正文可读性。建议填写预期身份，绑定实际要使用的账号；凭据留在 CLI 支持的凭据存储中。

### Settings / 配置项

| Setting under `report` / 字段 | Default / 默认值 | Purpose / 用途 |
| --- | --- | --- |
| `enabled` | `false` | Enable external publication / 开启外部发布 |
| `binary` | `lark-cli` | CLI executable name or path / CLI 可执行文件名称或路径 |
| `profile` | Empty / 空 | Optional CLI profile / 可选 CLI profile |
| `expectedUserName` | Empty / 空 | Exact expected user name, when set / 设置后精确核对用户名 |
| `expectedOpenId` | Empty / 空 | Exact expected user Open ID, when set / 设置后精确核对用户 Open ID |
| `productDirectory` | Empty / 空 | Product report directory URL / 产品报告目录链接 |
| `historyDirectory` | Empty / 空 | History report directory URL / 历史报告目录链接 |
| `directoryKind` | `product` | Select `product` or `history` directory / 选择产品或历史目录 |
| `directoryUrl` | Empty / 空 | Override the directory selected above / 优先于上述选择的目标目录链接 |
| `directorySection` | Empty / 空 | Exact existing section heading; otherwise match scope / 指定已有分节标题，否则按范围匹配 |
| `directoryTitle` | Empty / 空 | Optional root title check when appending a section / 追加分节时可选的根标题核对 |
| `directoryAppendSection` | `false` | Allow a new section only in the recognized directory layout / 仅在识别的目录布局中允许追加分节 |
| `timeout` | `60000` | Read-command timeout, 1,000–120,000 ms / 读取命令超时，毫秒 |
| `writeTimeout` | `900000` | Write-command timeout, 1,000–900,000 ms / 写入命令超时，毫秒 |

Directory synchronization follows the publisher's existing report-section contract. A URL and write permission alone do not make an arbitrary wiki layout compatible. Check the target structure before enabling writes; a directory mapping error is reported rather than silently rearranging your wiki. When no directory URL is configured, directory synchronization is skipped.

目录同步遵循发布器已有的报告分节合同，提供链接和写权限不代表兼容任意 wiki 布局。开启写入前请核对目标结构；映射不匹配时会报告错误，不会擅自重排 wiki。未配置目录链接时跳过目录同步。

## Saved reports and recovery / 报告快照与恢复

Each report job freezes the round at its saved revision. Later case results and caption edits belong to later snapshots. In **测试报告**, use **查看 / 下载此快照** to inspect a particular job. The Markdown preview includes caption and evidence references; it is not a bundled export of all media files.

每个报告任务冻结当时的轮次修订，后续结果和图注修改属于后续快照。在 **测试报告** 中点击 **查看 / 下载此快照** 可核对指定任务。Markdown 预览包含图注与证据引用，不是打包所有媒体文件的离线导出。

- **Known failure / 已知失败:** inspect the error, correct its cause, then use **重试已知失败** when offered. A saved generated report is reused. / 先修正具体原因，再使用可用的重试入口；已有报告内容会复用。
- **Unknown write outcome / 写入终态未知:** reconcile the existing Feishu report first. Enter its URL in the recovery form and choose **核对已有报告并继续**. Recovery checks the owner, original snapshot content, and media before continuing directory registration; it does not create a replacement report. / 先填写已有飞书报告链接核对；恢复流程检查所有者、原快照正文和媒体，再继续登记目录，不另建替代报告。
- **Directory pending / 目录未完成:** a created document alone does not mean directory synchronization succeeded. Preserve the task record, correct permissions or mapping, and update the same report to continue. / 文档创建不等于目录同步完成；保留任务记录，修正权限或映射后更新同一份报告。
- **Plugin reload / 插件重载:** interrupted local generation can be retried; interrupted publishing may require reconciliation because the remote write could already have happened. / 本地生成中断可按状态重试；发布中断可能已经写入远端，需要先核对终态。

Manual execution and local report preview remain available with publishing disabled. For request formats, attachment limits, and job states, see the [API reference](API.md). For host permissions, data handling, and model boundaries, read [Security](../SECURITY.md).

关闭发布不影响人工记录与本地预览。请求格式、附件限制和任务状态见[接口文档](API.md)；宿主权限、数据处理和模型边界见[安全说明](../SECURITY.md)。
