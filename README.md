# DSH Test Workbench

[简体中文](README.zh-CN.md) · [API](docs/API.md) · [Contributing](CONTRIBUTING.md)

A manual test execution workbench in the DeepSeek Harness sidebar. Import cases, create a test round, record actual results and step evidence, track scope changes, and generate a report from the saved records.

Version 0.1.0 targets DSH `>=0.2.2-rc.1` and Node.js `>=22`. The interface and generated report labels currently use Simplified Chinese.

## Install

Install the public source into the DSH profile you actually use:

```sh
dsh plugin --profile web add github:lichufeng123/dsh-test-workbench
```

Replace `web` with your ordinary CLI profile name. A profile named `desktop` uses `--profile desktop`; do not assume that name addresses a desktop application's managed profile. For Desktop-managed profiles, use that application's Plugins installer with `github:lichufeng123/dsh-test-workbench` as the package target.

The intended public npm package name is `dsh-test-workbench`. Once a version is published to npm, the equivalent command is:

```sh
dsh plugin --profile web add dsh-test-workbench
```

This README does not assert that npm publication or marketplace review has completed. The plugin runs inside DSH; it does not need a separate application server. Install-time dependencies are resolved by the host's package manager.

## Configure and start

Set the plugin entry in the active profile's Cordis patch. An explicit absolute workspace path is recommended; otherwise `workspaceRoot` defaults to the DSH Host process's current working directory.

```yaml
- id: dsh-test-workbench
  config:
    workspaceRoot: /absolute/path/to/test-project
    report:
      enabled: false
```

Open **测试执行台** in the sidebar. Import [the synthetic example](examples/cases.json), or paste a JSON case array. The object form accepts `{ "requirement_id": "REQ-DEMO", "title": "Settings", "cases": [...] }`. Supply a requirement ID and title when importing a bare array. A fresh workspace does not require a pre-existing case registry.

1. Import cases and select the source version.
2. Create a round with an environment, tested version, and scope.
3. Follow the execution order, compare the actual result with the expected result and your independent oracle, and save each case's status.
4. Add images, videos, or PDFs with captions and optional step bindings. Files first become local drafts; explicitly upload them to attach them to the case.
5. Generate a local Markdown report preview. Record missing work, failures, and evidence gaps as they stand.

Imports are always provisional or review-pending. An uploaded `approved` flag cannot grant formal baseline authority, and imported execution results do not become completed tests. Case `oracle` / `Oracle`, `oracles`, and `source` JSON metadata are retained for inspection; the workbench does not evaluate or certify those descriptions.

## Features and limits

- Six statuses: not started, in progress, passed, failed, blocked, and deferred. Manual recording is the primary workflow.
- Dependency-aware ordering, with manual changes and optional AI suggestions. Sorting never executes a test.
- New execution attempts preserve earlier results and evidence. Removing a case from a round requires a reason; restoration preserves the scope history.
- Revision checks protect concurrent edits. Evidence drafts survive page changes and are bound to their original execution attempt.
- Local reports retain partial results, removed cases, and missing evidence. A passed checkbox alone is not a release decision.

AI ordering and summaries reuse the model configured in DSH. When it is available, creating/replanning a round and generating a report can invoke it automatically and send case descriptions or execution records to that model provider. Local report preview works without AI. External report publication currently needs an available DSH model as well as the optional publishing setup below. The plugin does not provide an autonomous browser or API test runner.

## Optional Feishu / Lark publication

Publication is disabled by default. To enable it, install and authenticate `lark-cli` separately using your own user identity, then configure your own identity expectations and report directories:

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

Replace every example value. Do not put tokens or passwords in the patch or repository. The publisher calls the CLI as a user, verifies identity and document access, and records directory synchronization. Directory structure and write permission must match the publisher's contract; arbitrary wiki layouts are not automatically understood.

If creation or update has an unknown outcome, reconcile the existing report before retrying. A directory update failure remains visible even when the document itself was created. Preview and manual execution remain available when publishing is disabled.

## Data and development

Work items, imported sources, execution rounds, evidence, and report jobs are stored under `.ai-test/` in the configured workspace. Browser input drafts also use local storage. Treat both as user data and keep them out of public commits. See [Security](SECURITY.md).

```sh
git clone https://github.com/lichufeng123/dsh-test-workbench.git
cd dsh-test-workbench
npm ci --ignore-scripts
npm test
npm run check
npm run validate
npm pack
```

These are the contributor checks, not a claim about a particular test run. See [the contribution guide](CONTRIBUTING.md), [UI design specification](docs/ui-design-spec.md), and [changelog](CHANGELOG.md).

The [MIT License](LICENSE) permits private changes, redistribution, and commercial use with the required copyright and permission notice. A fork can be fixed privately or proposed upstream through a pull request. The official plugin manager follows the package/source you installed; it does not automatically switch users to your fork.
