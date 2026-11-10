# Changelog / 变更记录

## 0.1.0 — 2026-11-10

Initial public release scope. This entry describes the source version, not confirmation of npm publication or marketplace acceptance.

首个公开版本范围；本条记录源码版本，不表示 npm 发布或市场收录已完成。

- Import case JSON into a fresh workspace as immutable provisional source versions; retain per-case oracle and coverage metadata. / 新工作区导入 JSON，形成不可覆盖的临时来源版本，保留判定依据与覆盖元数据。
- Create execution rounds and record manual status, actual results, step observations, issue references, and repeated attempts. / 建立轮次，记录人工状态、实际结果、逐步观察、问题关联与多次尝试。
- Order cases by dependency and priority, with manual changes and optional DSH model assistance. / 按依赖与优先级排序，支持人工调整与可选模型辅助。
- Save evidence drafts, explicitly attach media to attempts, and record removal/restoration reasons. / 保存附件草稿，显式上传并关联执行尝试，记录范围移除和恢复原因。
- Generate local Markdown previews without a model; optionally summarize through DSH and publish with an independently configured Feishu/Lark user CLI. / 无模型可生成本地 Markdown 预览，可选 DSH 概述与另行配置的飞书用户 CLI 发布。
- Preserve report snapshots and publication intent for retries and reconciliation. External publication is disabled by default and currently requires a model. / 保留报告快照与发布意图以支持重试和核对；外部发布默认关闭，目前需模型可用。
