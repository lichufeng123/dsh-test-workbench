# Contributing / 参与贡献

Small bug fixes, reproducible issue reports, documentation improvements, and focused pull requests are welcome. Describe the observed behavior, expected behavior, DSH/Node versions, and a synthetic reproduction. Never attach real credentials, customer records, or unredacted execution evidence.

欢迎小范围修复、可复现问题、文档改进和明确范围的 PR。请说明实际与预期、DSH/Node 版本，并用合成数据复现；不要附真实凭据、客户记录或未脱敏证据。

## Local checks / 本地检查

Use Node.js 22 or newer. Install the locked schema dependency with npm ci before running checks; no application server is needed. DSH provides host services when loading the plugin; Feishu publication additionally needs the separately installed and authorized CLI.

使用 Node.js 22 及以上。先用 npm ci 安装锁定的配置校验依赖；运行检查无须启动应用服务器。插件加载后的宿主服务由 DSH 提供；飞书发布另需安装和授权 CLI。

```sh
git clone https://github.com/lichufeng123/dsh-test-workbench.git
cd dsh-test-workbench
npm ci --ignore-scripts
npm test
npm run check
npm run validate
npm pack
```

Inspect the package contents before distribution. Include runtime modules, the Cordis patch, and the license; exclude workspaces, `.ai-test/`, browser state, downloaded evidence, credentials, and local configuration. Record the actual command results in your PR rather than copying a historical test count.

分发前检查打包内容：包含运行模块、Cordis patch 和许可，排除工作区、`.ai-test/`、浏览器状态、证据下载、凭据和本地配置。PR 写本次命令的实际结果，不沿用历史测试数量。

## Change contracts / 变更约束

- Preserve case identity, source hashes, execution-attempt ownership, and revision checks. / 保留用例身份、来源摘要、执行尝试归属与修订检查。
- Imports stay provisional; AI must not invent results or upgrade review authority. / 导入保持临时效力，AI 不得补造结果或提升审批效力。
- Keep local manual execution and previews usable without a model or external publisher. / 无模型、无外部发布配置时，人工记录与本地预览仍可用。
- Use synthetic tests for dependency errors, concurrent edits, evidence ownership, and uncertain publication outcomes when changing those behaviors. / 修改依赖、并发、证据归属或发布恢复时，补充相应合成测试。
- Keep UI changes consistent with the [design specification](docs/ui-design-spec.md). / 界面变更遵循[设计规范](docs/ui-design-spec.md)。

You may maintain a private fix or publish an attributed fork under the [MIT License](LICENSE). A PR proposes the change to this upstream repository; maintainers review and release it. The official DSH manager installs the package/source selected by each user and does not automatically discover or adopt fork fixes. Changes to a fork need an explicit installation or a release through the selected upstream source to reach users.

[MIT 许可](LICENSE)允许保留署名后维护私有修复或分发 fork。PR 是向本上游提出变更，由维护者审阅并发布。DSH 官方管理器遵循每个用户选择的包和来源，不会自动采用 fork 的修复；用户需要显式安装 fork，或等所选上游来源发布包含修复的版本。
