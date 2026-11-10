# DSH 测试执行台

[English](README.md) · [接口文档](docs/API.md) · [参与贡献](CONTRIBUTING.md)

在 DeepSeek Harness 侧栏导入用例、建立测试轮次、记录人工结果和逐步证据、管理范围变化，并根据保存的记录生成报告。

首发版本 `0.1.0`，面向 DSH `>=0.2.2-rc.1`、Node.js `>=22`。当前界面和报告标签使用简体中文。

## 安装

安装到实际使用的 DSH profile：

```sh
dsh plugin --profile web add github:lichufeng123/dsh-test-workbench
```

将 `web` 换成自己的普通 CLI profile 名称。普通 profile 确实叫 `desktop` 时可用 `--profile desktop`；这不代表桌面应用内部管理的 profile。桌面应用请通过其插件安装器填写 `github:lichufeng123/dsh-test-workbench`。

计划使用的公开 npm 包名为 `dsh-test-workbench`。版本发布到 npm 后可用：

```sh
dsh plugin --profile web add dsh-test-workbench
```

本文不表示 npm 已发布或市场已审核收录。插件运行在 DSH 内，无须另起应用服务器；安装依赖由宿主包管理器解析。

## 配置与开始使用

在当前 profile 的 Cordis patch 中配置插件。推荐填写绝对路径；未设置 `workspaceRoot` 时使用 DSH Host 进程的当前工作目录。

```yaml
- id: dsh-test-workbench
  config:
    workspaceRoot: /absolute/path/to/test-project
    report:
      enabled: false
```

打开侧栏“测试执行台”，导入[合成示例](examples/cases.json)或粘贴 JSON。支持用例数组，也支持 `{ "requirement_id": "REQ-DEMO", "title": "设置页", "cases": [...] }`；导入数组时另填需求编号和标题。新工作区无须预先建立用例注册文件。

1. 导入用例并选择来源版本。
2. 创建轮次，填写环境、被测版本和范围。
3. 按顺序执行，对照预期和独立判定依据，保存状态与实际结果。
4. 添加带图注的图片、视频或 PDF，可绑定具体步骤。文件先保存为本机草稿，再由“上传”动作正式关联到用例。
5. 生成本地 Markdown 报告预览，如实保留失败、未测和证据缺口。

导入来源只具有临时或待审效力。JSON 中填写 `approved` 不能授予正式基线效力，导入的旧执行状态也不会直接成为本轮已完成结果。每条用例的 `oracle` / `Oracle`、`oracles`、`source` JSON 元数据会保留供查看；插件不替这些说明作真实性或充分性裁决。

## 能力与边界

- 支持未开始、进行中、通过、失败、阻塞、暂缓六种状态，以人工记录为主。
- 支持满足依赖的规则排序、人工调整和可选 AI 编排；排序不会执行测试。
- 新执行尝试保留历史结果与证据；移出本轮必须说明原因，恢复后仍保留范围历史。
- 修订检查防止并发覆盖；附件草稿跨页面保留，并绑定原执行尝试。
- 本地报告包含阶段结果、移除情况和缺证说明；勾选通过不能代替发布决策。

AI 排序和概述复用 DSH 中配置的模型，可能将用例文本或执行记录发送给该模型服务商。没有 AI 也能生成本地预览。目前外部发布还需要可用的 DSH 模型和下述发布配置。插件不包含自主操作浏览器或调用业务 API 的执行器。

## 可选飞书发布

默认关闭。需要时另外安装并用自己的用户身份授权 `lark-cli`，填写自己的身份校验条件和报告目录：

```yaml
- id: dsh-test-workbench
  config:
    workspaceRoot: /absolute/path/to/test-project
    report:
      enabled: true
      binary: lark-cli
      expectedUserName: Your Name
      expectedOpenId: YOUR_OPEN_ID
      productDirectory: https://example.feishu.cn/wiki/PRODUCT_DIRECTORY
      historyDirectory: https://example.feishu.cn/wiki/HISTORY_DIRECTORY
```

替换全部示例值。不要把口令、Token 写进配置或仓库。发布器以用户身份调用 CLI，核对身份与正文可读性，并登记目录同步结果。目标目录结构和写权限必须符合发布器合同，不会自动理解任意 wiki 布局。

创建或更新结果未知时，先核对已有文档再重试；文档创建成功但目录同步失败仍会保留未完成状态。关闭发布不影响人工记录和本地预览。

## 数据、开发与许可

工作项、导入来源、轮次、证据和报告任务保存在所配置工作区的 `.ai-test/` 下；浏览器输入草稿还使用本地存储。这些都是用户数据，不应提交到公开仓库。详见[安全说明](SECURITY.md)。

```sh
git clone https://github.com/lichufeng123/dsh-test-workbench.git
cd dsh-test-workbench
npm ci --ignore-scripts
npm test
npm run check
npm run validate
npm pack
```

以上是贡献前检查步骤，不表示某次检查已通过。另见[贡献指南](CONTRIBUTING.md)、[界面规范](docs/ui-design-spec.md)和[变更记录](CHANGELOG.md)。

[MIT 许可](LICENSE)允许保留必要署名及许可声明后私用修改、再分发和商业使用，软件按原样提供。可以在自己的 fork 修复，也可以向上游提 PR。官方插件管理器遵循用户安装的包或来源，不会自动改装你的 fork。
