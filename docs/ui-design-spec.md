# UI design specification / 界面设计规范

Version 0.1.0 documents the existing light sidebar workbench and its inline JSON import form. It is an implementation reference, not a screenshot or a claim that visual validation has passed. The interface currently uses Simplified Chinese.

本规范提取当前浅色侧栏执行台及行内 JSON 导入表单，供实现维护参考；不充当截图或视觉验证通过证据。当前界面使用简体中文。

## Structure / 结构

A persistent header holds the title, source/round selectors, round actions, and counts. The scrollable body provides four tabs: **全部用例 / All cases**, **执行顺序 / Execution order**, **已移除 / Removed**, and **测试报告 / Reports**. Preserve selection and unsaved input when changing tabs.

固定头部承载标题、来源/轮次选择、轮次操作与统计；正文独立滚动，包含全部用例、执行顺序、已移除、测试报告四个页签。切换页签时保留选择和未保存输入。

The case detail presents preconditions, fixture, expected result, independent oracle metadata, steps, actual results, and evidence. Display imported metadata as text or structured JSON; do not interpret it as HTML or instructions. Keep status text alongside color. Distinguish evidence drafts from attachments already uploaded to a case.

用例详情展示前置、Fixture、预期、独立判定依据、步骤、实际结果和证据。导入元数据按文本或 JSON 展示，不执行 HTML 或指令。状态同时显示文字；草稿与正式用例附件明确区分。

## Tokens / 视觉令牌

| Role / 用途 | Value / 数值 |
| --- | --- |
| Background / 背景 | `#ffffff` |
| Secondary surface / 次级表面 | `#f5f7fa` |
| Main text / 正文 | `#242b38` |
| Muted text / 辅助文字 | `#566174` |
| Input border / 输入边框 | `#cdd4de` |
| Divider / 分隔线 | `#e3e7ed` |
| Accent / 主色 | `#365ab5` |
| Selected surface / 选中背景 | `#edf2ff` |
| Failure / 失败 | `#a02e32` on `#fff2f2` |
| Success / 成功 | `#246345` on `#edf7f0` |
| Warning / 警示 | `#805215` on `#fff7e9` |

Use the system sans-serif stack, 14 px body text with 1.55 line height, 18 px title, 16 px section headings, and 12–13 px controls and supporting copy. Standard buttons have a 34 px minimum height, 7 px corner radius, and 7–10 px internal padding. Inputs remain white with visible borders and a 2 px accent focus outline. These values describe current CSS rather than a dark-mode contract.

使用系统无衬线字体；正文 14 px、行高 1.55，标题 18 px，分区标题 16 px，控件与辅助文字 12–13 px。普通按钮最小高 34 px、圆角 7 px；输入框保持白底和可辨边框，键盘焦点为 2 px 主色描边。以上来自当前 CSS，不构成深色模式承诺。

## Responsive behavior / 响应式

Below a 700 px container width, stack the case list and detail; constrain the list to its own scrolling region. At 700 px and above, use list/detail columns with an approximately 1:2 ratio and a vertical divider. At 360 px and below, reduce horizontal padding to 10 px, collapse field grids to one column, and allow actions to wrap. Tabs may scroll horizontally. Wrap long identifiers and descriptions without hiding required controls.

容器宽度不足 700 px 时列表与详情纵向排列；700 px 及以上采用约 1:2 双栏与竖向分隔。360 px 及以下横向留白降至 10 px、字段改单列，操作可换行；页签可横向滚动。长编号与文本换行，不遮住必要操作。

## Inline import / 行内导入

Place JSON import in the same content flow as source selection. Provide labeled requirement ID/title fields and a JSON text area; accept an array or a source object. Keep the submitted text on validation/network errors, show the actionable error beside the form, disable duplicate submission while pending, and select the newly imported source after confirmed success. Show provisional authority explicitly. A successful import is not execution or approval.

JSON 导入位于来源选择附近的正常内容流中，提供有标签的需求编号、标题与文本区。校验或网络失败保留输入并就地说明；提交中防重复；确认成功后选择新来源，明确临时效力。导入成功不等于执行或审批。

Keyboard focus must remain visible; file inputs and evidence media need accessible names. Respect reduced motion. Check narrow layouts, long text, empty sources, dirty drafts, stale revisions, upload failures, and unknown publication outcomes when validating a release. No real screenshots or customer fixtures are supplied by this specification.

键盘焦点可见，文件输入与证据媒体有可访问名称，遵循减少动画偏好。发布验证需覆盖窄屏、长文案、空来源、未保存草稿、修订冲突、上传失败和发布终态未知。本规范不附真实截图或客户 Fixture。
