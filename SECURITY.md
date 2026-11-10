# Security / 安全说明

The plugin executes inside the DSH Host with the user's local permissions. DSH tool approvals do not sandbox plugin code. Review the source and install only a source you trust.

插件以宿主用户权限在 DSH Host 内运行；工具审批不等于插件代码沙箱。安装前请检查来源。

## Data boundaries / 数据边界

- Execution data, evidence drafts, attachments, and report snapshots live under the configured workspace's `.ai-test/`; input drafts also use browser local storage. These may contain sensitive material. Do not commit or publish them. / 执行数据、附件草稿、证据和报告快照位于工作区 `.ai-test/`；输入草稿还使用浏览器本地存储。请勿提交或公开这些数据。
- JSON imports are data, not instructions or review approvals. Oracle metadata is retained, not executed. / JSON 导入是资料，不是指令或审批；判定依据元数据仅保留，不执行。
- AI actions may transmit selected case or result text to the model configured in DSH. Avoid AI actions for material you cannot send to that provider. / AI 操作可能把选定用例或结果文本发送到 DSH 配置的模型；不能发送的内容请勿使用 AI 操作。
- External publication is opt-in. Use your own authorized CLI user, expected identity, and directory configuration. Keep authentication in the CLI's supported credential storage, never source files. / 外部发布需显式开启，使用自己的 CLI 用户授权、预期身份和目录；凭据留在 CLI 支持的安全存储中。
- The plugin uses DSH's authenticated connection and checks request origin. Do not expose a DSH Host publicly without its own supported access controls. / 插件使用 DSH 的认证连接并检查来源；对外开放宿主前应配置 DSH 支持的访问控制。

A timeout after a publication write can leave an unknown external outcome. Reconcile the saved publication intent with the existing document; do not blindly repeat creation. Removing evidence from a case is not a promise to erase every historical record or backup.

发布写入超时可能留下未知外部终态；应对照保存的发布意图核对现有文档，不能盲目重复创建。从用例移除附件不代表所有历史记录或备份均已清除。

## Reporting / 报告问题

Use the repository's GitHub private vulnerability reporting feature when available. If unavailable, open a minimal issue requesting a private contact without disclosing an exploit, token, or sensitive data. Do not include secrets in public issues or PRs. No guaranteed response time or paid bounty is offered.

优先使用仓库启用的 GitHub 私密漏洞报告；若未启用，可先提交不含利用细节与敏感数据的简短 issue 请求私下联系。不要在公开 issue 或 PR 中提交秘密。本项目不承诺固定响应时限或付费奖励。
