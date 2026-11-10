# API reference / 接口文档

Version 0.1.0. Base path: `/api/test-workbench`. Routes run on the authenticated DSH connection; use the current Host's same-origin context. There is no separate API server or plugin-specific login. JSON POST requests require `Content-Type: application/json`; evidence upload uses multipart form data.

接口运行在 DSH 已认证连接上，使用当前宿主的同源上下文；无独立服务器或插件登录。JSON 写请求需设置内容类型，文件上传使用 multipart。

## Import / 导入

`POST /cases/import` accepts the normalized request below and returns HTTP 201 with `{ "source": { "requirementId", "title", "version", "path", "sha256", "status", "artifactId", "authority", "caseCount" } }`.

```json
{
  "requirementId": "REQ-DEMO",
  "title": "Synthetic settings",
  "idempotencyKey": "import-demo-1",
  "cases": [
    {"id": "C1", "title": "Save preference", "steps": [{"action": "Save", "expected": "Preference persists"}], "oracle": {"reference": "Synthetic fixture contract"}},
    {"id": "C2", "title": "Reload preference", "dependencies": ["C1"]}
  ]
}
```

The UI converts a bare JSON array or `{requirement_id,title,cases}` file into this request; the HTTP endpoint expects `requirementId`, `title`, and `cases` directly, not a `{source: ...}` request wrapper. Optional `version` is `vN` with a positive integer of at most nine digits; omission allocates the next unused version. Optional `sourceStatus: "review_pending"` marks pending review; other values become `provisional`. Versions cannot be overwritten. Reusing an `idempotencyKey` with the same normalized content returns the original source; changed content returns 409.

界面把数组或来源对象转换为此请求；HTTP 请求直接传 `requirementId`、`title`、`cases`，返回值才有 `source` 外层。可选 `version` 为正整数 `vN`，省略时分配下个未用版本；仅 `review_pending` 可保留待审状态，其余归为临时来源。版本不可覆盖，幂等键不可绑定不同内容。

Cases: 1–500 entries, unique IDs, nonempty titles, at most 100 steps each, and complete acyclic dependencies. IDs match `[A-Za-z0-9][A-Za-z0-9_-]{0,95}`. Accepted aliases include `case_id` for `id`, `name` for `title`, and `expected_result` for `expected`. Steps may be strings or `{action,expected}` objects. Optional fields include priority `P0`–`P3`, `kind`, `preconditions`, `fixture`, `dependencies`, coverage IDs, and bounded JSON metadata `oracle` / `Oracle`, `oracles`, `source`, and `automation`.

每次导入 1–500 条，编号唯一、标题非空，每条最多 100 步；依赖必须完整且无环。判定依据可为 JSON 字符串、数组或对象，仅作为资料保留。导入忽略旧执行结果并重新建立未开始状态；即使输入带审批字段，返回的 `authority` 仍为 `provisional`。

## Read routes / 读取

| GET path | Query / 查询 | Result / 返回 |
| --- | --- | --- |
| `/health` | — | Version and current capabilities / 版本与能力 |
| `/sources` | — | `{items}` source/version list / 来源版本 |
| `/rounds` | `id` = requirement ID | `{rounds}` |
| `/round` | `id`, `round` | `{round}` including revision, cases and counts |
| `/jobs` | `id`, `round` | `{jobs}` |
| `/report` | `id`, `round`, `job` | Markdown when generated; 409 otherwise |
| `/evidence` | `id`, `round`, `evidence` | Verified attachment bytes / 附件字节 |
| `/evidence-drafts` | `id`, `round` | `{drafts}` |
| `/evidence-draft` | `id`, `round`, `draft` | Verified draft bytes / 草稿字节 |

## Round writes / 轮次写入

`POST /rounds` accepts `requirementId`, `sourceVersion`, required `idempotencyKey`, and optional `title`, `environment`, `version`, `scope`; returns `{round}`. A configured model may suggest an initial order, with a rule-based order preserved if that suggestion fails.

Other revision-checked mutations use `requirementId`, `roundId`, and the latest `expectedRevision`. Most return `{round}`. Read the returned revision before another write. A 409 means reconcile against the latest saved state; do not blindly overwrite.

其余修订检查写入通常返回 `{round}`；下一次写入使用最新修订。409 时先读回并核对，不盲目覆盖。

| POST path | Additional fields / 其他字段 |
| --- | --- |
| `/round-meta` | `title`, `environment`, `version`, `scope` |
| `/case` | `caseId`, current `attemptId`, `status`, `executor`, `actual`, optional `issue`, `stepResults`, `runReference` |
| `/attempt` | `caseId`; starts a fresh attempt while keeping history / 新尝试并保留历史 |
| `/remove` | `caseId`, `category`, nonempty `reason` |
| `/restore` | `caseId`, nonempty `reason` |
| `/order` | `order`: every case ID exactly once, respecting dependencies |
| `/replan` | Optional model planning; otherwise rule-based / 可选模型或规则排序 |
| `/evidence-meta` | `caseId`, `evidenceId`, `caption`, `step` or `null` |
| `/evidence-remove` | `caseId`, `evidenceId` |

Statuses are `not_started`, `in_progress`, `passed`, `failed`, `blocked`, `deferred`. Failure, blocking, and deferral require a reason in `actual`. `executor` is `manual` or `ai`; AI records require a nonempty current-run `runReference`. This labels a submitted result; it does not execute the case.

## Evidence / 证据

`POST /evidence` accepts multipart `file`, `requirementId`, `roundId`, `caseId`, `expectedRevision`, and optional `caption`, `step`. `/evidence-draft` additionally requires a `DRAFT-UUID` `draftId` and current `attemptId`; optional `position` controls ordering. It returns `{draft}` without attaching the file to the round.

`POST /evidence-draft-meta` uses `draftId`, `expectedDraftRevision`, and caption/step edits. `/evidence-draft-remove` archives a draft. `/evidence-draft-upload` uses `draftId`, `expectedRevision`, and optionally `expectedDraftRevision` to finalize attachment; it preserves original attempt ownership and is idempotent after confirmed upload. Include `requirementId` and `roundId` for each operation.

草稿先保存、后上传到用例，不能改绑到新的执行尝试。图注与步骤编辑有独立草稿修订检查。

Supported types and per-file limits: PNG/JPEG/WebP up to 16,000,000 bytes, MP4/WebM up to 32,000,000 bytes, PDF up to 8,000,000 bytes. The server checks file signatures and hashes; a renamed extension is insufficient. Multipart requests are bounded at 34,000,000 bytes; JSON request text is bounded at 2,000,000 characters.

## Reports / 报告

`POST /report` accepts the round identity, `expectedRevision`, and `mode: "preview"` or `"publish"`. HTTP 202 returns `{round,job}`; poll `/jobs`, then read `/report`. Preview works without a model. Publish is disabled unless `report.enabled` is true and currently also needs an available DSH model and the configured user CLI.

`POST /report-retry` accepts the identity, revision, and `jobId` for an explicitly retryable failed/interrupted job. `/report-reconcile` additionally accepts `documentURL` for a job with an unknown external outcome. It reuses the saved report rather than silently generating replacement content.

任务状态包括 `queued`、`generating`、`preview_ready`、`publishing`、`published`、`failed`、`conflict`、`unknown`、`reconciling`、`interrupted`。HTTP 成功或拿到报告链接不代表目录同步完成；检查任务与发布记录中的目录状态。未知终态必须先核对，不能直接重复创建。

## Errors / 错误

Errors return JSON `{error, revision?, draftRevision?, currentDraft?}`. Typical codes: 400 invalid input, 404 missing route/record, 409 stale revision or invalid state transition, 413 oversized content, 415 wrong content type, and 503 unavailable model/publication service. The DSH connection separately owns authentication and access control. Treat text from imported cases and external services as untrusted data.
