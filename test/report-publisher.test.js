import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, PublicationError, prepareReport, publishReport, execFileRunner, resolveCliBinary, publicationDiagnostics, blocks, checkReadback, regionHash, referenceHash } from '../report-publisher.js';

const owner = 'ou_test_owner';
const reportURL = 'https://example.feishu.cn/docx/report';
const snapshot = (actual = '保存后刷新仍显示正确结果') => ({ id: 'ROUND-1', requirementId: 'REQ-1', title: '保存资料测试', environment: 'SIT', version: 'v1', scope: '资料管理', revision: 1, cases: [{ id: 'C1', title: '保存并刷新资料', steps: [{ action: '保存资料并刷新', expected: '资料完整保留' }], execution: { status: 'passed', actual, stepResults: [{ actual: '刷新后资料完整保留' }] }, evidence: [] }] });
const json = data => ({ ok: true, identity: 'user', data });
function harness(options = {}) {
  let revision = 1;
  let counter = 0;
  let report = options.report ?? '';
  let directory = options.directory ?? '<title id="index">测试报告目录</title><h1 id="section">资料管理</h1>';
  const calls = [];
  const checkpoints = [];
  const addIds = content => content.replace(/<(p|h[1-9]|img|figure|source|table|td|th)\b/g, (_, tag) => `<${tag} id="b${++counter}"`).replace(/<img\b([^>]*?)path="[^"]*"/g, '<img$1token="uploaded-image"').replace(/<source\b([^>]*?)path="[^"]*"/g, '<source$1token="uploaded-file"');
  const flag = (args, name) => args[args.indexOf(name) + 1];
  const runner = async (binary, args, opts) => {
    calls.push({ binary, args, input: opts.input });
    assert.equal(binary, 'lark-cli');
    assert.deepEqual(args.slice(-2), ['--as', 'user']);
    if (options.intercept) {
      const response = await options.intercept(args, opts, { get report() { return report; }, set report(v) { report = v; } });
      if (response !== undefined) return response;
    }
    const command = args.find(a => a.startsWith('+'));
    if (args.includes('whoami')) return { identity: options.identity ?? 'user', available: true, tokenStatus: 'ready', onBehalfOf: { userName: options.userName ?? 'Test Maintainer', openId: owner } };
    if (args.includes('metas')) return json({ metas: [{ doc_token: 'report', doc_type: 'docx', owner_id: options.owner ?? owner, title: '保存资料测试', url: reportURL }] });
    if (command === '+create') {
      report = `<title id="report">保存资料测试</title>${addIds(opts.input)}`;
      if (options.createTimeout) throw new Error('simulated timeout containing private output');
      return json({ document: { document_id: 'report', url: reportURL, revision_id: revision }, warnings: options.warnings ?? [] });
    }
    if (command === '+fetch') {
      const doc = flag(args, '--doc');
      const index = doc !== 'report';
      if (index && options.directoryTimeout) throw new Error('directory unavailable');
      return json({ document: { document_id: index ? 'index' : 'report', revision_id: revision, content: index ? directory : report } });
    }
    if (command === '+update') {
      assert.notEqual(flag(args, '--revision-id'), '-1');
      revision++;
      if (flag(args, '--doc') === 'report') {
        if (options.updateTimeout) throw new Error('simulated timeout');
        const startId = flag(args, '--start-block-id');
        const endId = flag(args, '--end-block-id');
        const from = report.indexOf(`<`, report.indexOf(`id="${startId}"`) - 8);
        // Fixtures use p/h1 ranges; deliberately retain outside human content.
        const start = report.lastIndexOf('<', report.indexOf(`id="${startId}"`));
        const closing = report.indexOf('</', report.indexOf(`id="${endId}"`));
        const end = report.indexOf('>', closing) + 1;
        assert.ok(from >= 0);
        report = report.slice(0, start) + addIds(opts.input) + report.slice(end);
      } else {
        const block = flag(args, '--block-id');
        if (flag(args, '--command') === 'append') directory += addIds(opts.input);
        else if (flag(args, '--command') === 'block_insert_after') directory = directory.replace(`</h1>`, `</h1>${addIds(opts.input)}`);
        else {
          const start = directory.lastIndexOf('<', directory.indexOf(`id="${block}"`));
          const end = directory.indexOf('</p>', start) + 4;
          directory = directory.slice(0, start) + addIds(opts.input) + directory.slice(end);
        }
      }
      return json({ result: 'success', document: { revision_id: revision }, warnings: [] });
    }
    assert.fail(`Unexpected command ${args[0]}`);
  };
  return { deps: { runner, checkpoint: async p => { checkpoints.push(structuredClone(p)); }, config: { cwd: DEFAULT_CONFIG.cwd, expectedUserName:'Test Maintainer', productDirectory:'https://example.feishu.cn/wiki/product-index', historyDirectory:'https://example.feishu.cn/wiki/history-index', directoryAppendSection:true, directoryTitle:'示例报告目录' } }, calls, checkpoints, get report() { return report; }, set report(v) { report = v; }, get directory() { return directory; }, set directory(v) { directory = v; } };
}
const publish = (h, extra = {}, inputSnapshot = snapshot()) => publishReport({ snapshot: inputSnapshot, jobId: 'JOB-1', ...extra }, h.deps);

test('prepare retains removed, unexecuted and step result facts without treating them as passes', () => {
  const s = snapshot();
  s.cases[0].removed = { reason: '范围缩减' };
  s.cases.push({ id: 'C2', title: '未开始的权限场景', steps: [{ action: '查询', expected: '拒绝' }], execution: { status: 'not_started' } });
  const prepared = prepareReport({ snapshot: s });
  assert.match(prepared.content, /已移出本轮：范围缩减/);
  assert.match(prepared.content, /刷新后资料完整保留/);
  assert.match(prepared.content, /测试结果：未执行/);
  assert.match(prepared.content, /证据存在缺口/);
});

test('create checkpoints intent before command, then identity before owner/readback and directory', async () => {
  const h = harness();
  const p = await publish(h);
  assert.equal(p.documentId, 'report');
  assert.equal(p.url, reportURL);
  assert.equal(p.title, snapshot().title);
  assert.equal(h.checkpoints[0].title, snapshot().title);
  assert.equal(p.status, 'published');
  assert.equal(p.readback.userReadable, true);
  assert.equal(p.readback.ownerVerified, true);
  assert.match(p.managed.hash, /^[a-f0-9]{64}$/);
  assert.equal(p.directory.status, 'verified');
  assert.equal(h.checkpoints[0].pending.operation, 'create');
  assert.equal(h.checkpoints[1].documentId, 'report');
  assert.equal(h.checkpoints[1].pending.operation, 'readback');
  const create = h.calls.find(c => c.args.includes('+create'));
  assert.equal(create.args[create.args.indexOf('--content') + 1], '-');
  assert.ok(create.input.includes('保存后刷新'));
});

test('update same document with revision CAS and preserve human content outside managed range', async () => {
  const h = harness();
  const original = await publish(h);
  h.report += '<p id="human">人工补充：尚需真机复核</p>';
  const updated = await publish(h, { publication: original, jobId: 'JOB-2' }, snapshot('补测结果：资料正确'));
  assert.equal(updated.documentId, original.documentId);
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 1);
  const update = h.calls.find(c => c.args.includes('+update') && c.args.includes('report'));
  assert.ok(update.args.includes('block_replace'));
  assert.ok(update.args.includes('--revision-id'));
  assert.ok(!update.args.includes('overwrite'));
  assert.match(h.report, /人工补充：尚需真机复核/);
  assert.match(h.report, /补测结果：资料正确/);
});

test('round rename updates the same document while retaining first-publication and manual native titles', async () => {
  const h = harness();
  const first = await publish(h);
  h.report = h.report.replace('>保存资料测试</title>', '>用户在飞书中修改的标题</title>');
  const renamed = { ...snapshot('新轮次名称下的补测结果'), title: '资料维护补测' };
  const result = await publish(h, { publication: first, title: renamed.title }, renamed);
  assert.equal(result.title, first.title);
  assert.equal(result.documentId, first.documentId);
  assert.match(h.report, /用户在飞书中修改的标题<\/title>/);
  assert.match(h.report, /新轮次名称下的补测结果/);
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 1);
  assert.equal(h.calls.some(c => c.args.includes('+update-title')), false);
  const bodyUpdate = h.calls.find(c => c.args.includes('--start-block-id'));
  assert.ok(bodyUpdate);
  assert.equal(bodyUpdate.args.includes('--title'), false);
});

test('user edits inside managed region fail before any further write', async () => {
  const h = harness();
  const original = await publish(h);
  h.report = h.report.replace('保存后刷新仍显示正确结果', '人工修订：尚未通过');
  const writes = h.calls.filter(c => c.args.includes('+update')).length;
  await assert.rejects(publish(h, { publication: original }, snapshot('更新结果')), { code: 'CONTENT_CONFLICT' });
  assert.equal(h.calls.filter(c => c.args.includes('+update')).length, writes);
  assert.match(h.report, /人工修订/);
});

test('ambiguous create never repeats and error contains durable pending identity', async () => {
  const h = harness({ createTimeout: true });
  await assert.rejects(publish(h), error => error.code === 'CREATE_STATUS_UNKNOWN' && error.publication.pending.operation === 'create' && !error.message.includes('private'));
  const pending = h.checkpoints.at(-1);
  await assert.rejects(publish(h, { publication: pending }), { code: 'RECONCILIATION_REQUIRED' });
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 1);
});

test('known identity survives partial create warnings and stops later writes', async () => {
  const h = harness({ warnings: ['media degraded'] });
  await assert.rejects(publish(h), { code: 'WRITE_PARTIAL' });
  assert.equal(h.checkpoints.at(-1).documentId, 'report');
  assert.equal(h.checkpoints.at(-1).pending.operation, 'readback');
  assert.equal(h.calls.filter(c => c.args.includes('+update')).length, 0);
});

test('missing checkpoint and failed checkpoint cause no external mutation', async () => {
  const h = harness();
  await assert.rejects(publishReport({ snapshot: snapshot(), jobId: 'job' }, { runner: h.deps.runner }), { code: 'CHECKPOINT_REQUIRED' });
  h.deps.checkpoint = async () => { throw new Error('disk full'); };
  await assert.rejects(publish(h), { code: 'CHECKPOINT_FAILED' });
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 0);
});

test('identity mismatch stops before create; ownership mismatch stops readback delivery', async () => {
  const wrongUser = harness({ userName: '其他人' });
  await assert.rejects(publish(wrongUser), { code: 'IDENTITY_MISMATCH' });
  assert.equal(wrongUser.calls.filter(c => c.args.includes('+create')).length, 0);
  const wrongOwner = harness({ owner: 'ou_somebody_else' });
  await assert.rejects(publish(wrongOwner), { code: 'OWNER_MISMATCH' });
  assert.equal(wrongOwner.checkpoints.at(-1).documentId, 'report');
  assert.ok(wrongOwner.checkpoints.at(-1).pending);
});

test('directory failure returns pending receipt while retaining report; retry does not create or rewrite report', async () => {
  const h = harness({ directoryTimeout: true });
  const p = await publish(h);
  assert.equal(p.status, 'published_directory_pending');
  assert.equal(p.directory.status, 'pending');
  assert.equal(p.pending, null);
  const again = await publish(h, { publication: p });
  assert.equal(again.documentId, p.documentId);
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 1);
  assert.equal(h.calls.filter(c => c.args.includes('+update')).length, 0);
});

test('directory section mismatch stays pending without inventing hierarchy', async () => {
  const h = harness();
  h.deps.config.directorySection = '不存在的目录';
  const p = await publish(h);
  assert.equal(p.directory.code, 'DIRECTORY_MAPPING_REQUIRED');
  assert.equal(p.status, 'published_directory_pending');
});

test('directory existing link is deduplicated and unchanged source is read back without writes', async () => {
  const h = harness();
  const p = await publish(h);
  const writes = h.calls.filter(c => c.args.includes('+update')).length;
  const second = await publish(h, { publication: p });
  assert.equal(second.directory.deduplicated, true);
  assert.equal(h.calls.filter(c => c.args.includes('+update')).length, writes);
  assert.equal(h.directory.split(reportURL).length - 1, 1);
});

test('unknown update status remains checkpointed and blocks automatic replay', async () => {
  const h = harness({ updateTimeout: true });
  const p = await publish(h);
  await assert.rejects(publish(h, { publication: p }, snapshot('新结果')), { code: 'UPDATE_STATUS_UNKNOWN' });
  const pending = h.checkpoints.at(-1);
  assert.equal(pending.pending.operation, 'update');
  await assert.rejects(publish(h, { publication: pending }, snapshot('新结果')), { code: 'RECONCILIATION_REQUIRED' });
});

test('report publication cannot be reused across round or requirement identities', async () => {
  const h = harness();
  const p = await publish(h);
  await assert.rejects(publish(h, { publication: { ...p, roundId: 'another' } }), { code: 'PUBLICATION_IDENTITY_MISMATCH' });
});

test('registered local images use uploads and native captions; no shell interpolation', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'publisher-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const mediaPath = path.join(cwd, 'a $(touch never).png');
  await writeFile(mediaPath, Buffer.from('local test bytes'));
  const s = snapshot();
  s.cases[0].evidence = [{ id: 'E1', mime: 'image/png', path: mediaPath, caption: '保存并刷新资料｜刷新后资料仍完整' }];
  const h = harness();
  h.deps.config.cwd = cwd;
  const p = await publish(h, {}, s);
  assert.deepEqual(p.readback.media, [{ evidenceId: 'E1', caption: s.cases[0].evidence[0].caption, uploaded: true }]);
  const create = h.calls.find(c => c.args.includes('+create'));
  assert.match(create.input, /<img path="@\.\/a \$\(touch never\)\.png" caption=/);
  assert.equal(create.args.some(a => a.includes('touch never')), false);
});

test('Markdown scene markers become native captioned images and unregistered remote images fail closed', () => {
  const s = snapshot();
  const evidence = [{ id: 'E1', mime: 'image/png', path: path.join(DEFAULT_CONFIG.cwd, 'e.png'), caption: '保存并刷新资料｜结果', caseId: 'C1' }];
  const p = prepareReport({ snapshot: s, evidence, markdown: '# 标题\n\n## 保存并刷新资料\n\n实际结果：成功\n\n<!-- evidence:E1 -->' });
  assert.equal(p.format, 'markdown');
  assert.match(p.content, /<img path="@\.\/e.png" caption="保存并刷新资料｜结果"\/>/);
  assert.throws(() => prepareReport({ snapshot: s, markdown: '![remote](https://example.com/private.png)' }), { code: 'UNREGISTERED_EVIDENCE' });
  assert.throws(() => prepareReport({ snapshot: s, markdown: '<img href="https://example.com/a.png"/>' }), { code: 'UNTRUSTED_RESOURCE_MARKUP' });
  assert.throws(() => prepareReport({ snapshot: s, evidence, markdown: '没有证据占位' }), { code: 'EVIDENCE_PLACEMENT_REQUIRED' });
});

test('evidence root traversal and symlink escapes are rejected before create', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'publisher-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'publisher-outside-'));
  t.after(async () => { await rm(cwd, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const target = path.join(outside, 'private.png');
  await writeFile(target, 'data');
  const s = snapshot();
  s.cases[0].evidence = [{ id: 'E1', mime: 'image/png', path: target, caption: '示例' }];
  assert.throws(() => prepareReport({ snapshot: s }, { cwd }), { code: 'EVIDENCE_OUTSIDE_ROOT' });
  const link = path.join(cwd, 'linked.png');
  await symlink(target, link);
  s.cases[0].evidence[0].path = link;
  const h = harness();
  h.deps.config.cwd = cwd;
  await assert.rejects(publish(h, {}, s), { code: 'EVIDENCE_UNAVAILABLE' });
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 0);
});

test('malformed or incomplete readback keeps identity pending instead of declaring success', async () => {
  const h = harness({ intercept: async args => args.includes('+fetch') && args.includes('report') ? json({ document: { document_id: 'report', revision_id: 1, content: '<p>no block id</p>' } }) : undefined });
  await assert.rejects(publish(h), { code: 'UNSUPPORTED_READBACK' });
  assert.equal(h.checkpoints.at(-1).documentId, 'report');
  assert.equal(h.checkpoints.at(-1).pending.operation, 'readback');
});

test('changed media bytes change source identity even when caption/path stay the same', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'publisher-media-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const mediaPath = path.join(cwd, 'image.png');
  await writeFile(mediaPath, 'first image bytes');
  const s = snapshot();
  s.cases[0].evidence = [{ id: 'E1', mime: 'image/png', path: mediaPath, caption: '保存并刷新资料｜结果' }];
  const h = harness();
  h.deps.config.cwd = cwd;
  const first = await publish(h, {}, s);
  await writeFile(mediaPath, 'second image bytes');
  // Stop at the write boundary; the assertion concerns the content identity, not fake image replacement.
  let attempted = false;
  const original = h.deps.runner;
  h.deps.runner = async (...args) => {
    if (args[1].includes('--start-block-id')) { attempted = true; throw new Error('stop after recorded intent'); }
    return original(...args);
  };
  await assert.rejects(publish(h, { publication: first }, s), { code: 'UPDATE_STATUS_UNKNOWN' });
  assert.equal(attempted, true);
  assert.notEqual(h.checkpoints.at(-1).pending.sourceHash, first.sourceHash);
});

test('structured revision conflict is classified without blind write retry', async () => {
  const h = harness();
  const p = await publish(h);
  const original = h.deps.runner;
  h.deps.runner = async (...args) => args[1].includes('--start-block-id') ? { ok: false, error: { subtype: 'revision_conflict' } } : original(...args);
  await assert.rejects(publish(h, { publication: p }, snapshot('新结果')), error => error.code === 'CONTENT_CONFLICT' && error.publication.pending === null);
  assert.equal(h.checkpoints.at(-1).status, 'content_conflict');
});

test('resource sidecar edits are protected even when visible XML stays the same', async () => {
  const h = harness();
  const p = await publish(h);
  const original = h.deps.runner;
  h.deps.runner = async (...args) => {
    const response = await original(...args);
    if (args[1].includes('+fetch') && args[1].includes('report')) response.data.document.reference_map = { img: { i1: { token: 'user-added-resource' } } };
    return response;
  };
  await assert.rejects(publish(h, { publication: p }, snapshot('新结果')), { code: 'CONTENT_CONFLICT' });
});

test('manually annotated directory entry is preserved instead of overwritten', async () => {
  const h = harness();
  const p = await publish(h);
  h.directory = h.directory.replace('有效场景', '人工批注：下周复查。有效场景');
  h.deps.config.directorySummary = '补测后更新';
  const result = await publish(h, { publication: p });
  assert.equal(result.directory.code, 'DIRECTORY_CONTENT_CONFLICT');
  assert.match(h.directory, /人工批注：下周复查/);
});

test('unknown directory write is read back before retry; absence never triggers duplicate append', async () => {
  const h = harness();
  const original = h.deps.runner;
  let directoryWrites = 0;
  h.deps.runner = async (...args) => {
    if (args[1].includes('block_insert_after')) { directoryWrites++; throw new Error('uncertain directory write'); }
    return original(...args);
  };
  const p = await publish(h);
  assert.equal(p.directory.writeUncertain, true);
  const retry = await publish(h, { publication: p });
  assert.equal(retry.directory.code, 'DIRECTORY_RECONCILIATION_REQUIRED');
  assert.equal(directoryWrites, 1);
});

test('missing native image caption fails after identity checkpoint', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'publisher-caption-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const file = path.join(cwd, 'image.png');
  await writeFile(file, 'image');
  const s = snapshot();
  s.cases[0].evidence = [{ id: 'E1', mime: 'image/png', path: file, caption: '必须有原生图注' }];
  const h = harness();
  h.deps.config.cwd = cwd;
  const original = h.deps.runner;
  h.deps.runner = async (...args) => {
    const response = await original(...args);
    if (args[1].includes('+fetch') && args[1].includes('report')) response.data.document.content = response.data.document.content.replace(/ caption="[^"]*"/, '');
    return response;
  };
  await assert.rejects(publish(h, {}, s), error => error.code === 'MEDIA_READBACK_MISMATCH' && error.publication.documentId === 'report');
});

test('Markdown publication validates report text and refuses reordered scene readback', async () => {
  const markdown = '# 报告\n\n## 场景甲\n\n实际结果：结果甲\n\n## 场景乙\n\n实际结果：结果乙';
  const h = harness({ intercept: async args => args.includes('+fetch') && args.includes('report') ? json({ document: { document_id: 'report', revision_id: 1, content: '<title id="report">报告</title><h1 id="a">场景甲</h1><p id="b">实际结果：结果甲</p><h1 id="c">场景乙</h1><p id="d">实际结果：结果乙</p>' } }) : undefined });
  const p = await publish(h, { markdown });
  assert.equal(p.readback.status, 'verified');
  const reordered = harness({ intercept: async args => args.includes('+fetch') && args.includes('report') ? json({ document: { document_id: 'report', revision_id: 1, content: '<title id="report">报告</title><h1 id="a">场景乙</h1><p id="b">实际结果：结果乙</p><h1 id="c">场景甲</h1><p id="d">实际结果：结果甲</p>' } }) : undefined });
  await assert.rejects(publish(reordered, { markdown }), { code: 'READBACK_MISMATCH' });
});

const knownProductRoot = '<title id="index">示例报告目录</title><p id="intro">当前结论以正文为准。</p><table id="overview"><thead><tr><th><p id="th1">需求</p></th><th><p id="th2">报告</p></th><th><p id="th3">当前结论</p></th></tr></thead><tbody></tbody></table><h2 id="existing">其他专项｜SIT测试报告</h2><p id="existing-entry">保留其他范围的报告与人工说明。</p>';

test('verified product directory root permits one CAS append of native scope heading and entry', async () => {
  const h = harness({ directory: knownProductRoot });
  const p = await publish(h);
  assert.equal(p.directory.status, 'verified');
  assert.equal(p.directory.sectionTitle, '保存资料测试｜SIT｜阶段测试报告');
  assert.ok(h.directory.startsWith(knownProductRoot));
  const append = h.calls.filter(c => c.args.includes('append'));
  assert.equal(append.length, 1);
  assert.match(append[0].input, /^<h2>保存资料测试｜SIT｜阶段测试报告<\/h2><p>/);
  assert.ok(append[0].args.includes('--revision-id'));
  assert.ok(!append[0].args.includes('--block-id'));
  assert.equal(h.checkpoints.find(p => p.directory?.status === 'write_pending').directory.sectionTitle, p.directory.sectionTitle);
  const again = await publish(h, { publication: p });
  assert.equal(again.directory.deduplicated, true);
  assert.equal(h.calls.filter(c => c.args.includes('append')).length, 1);
});

test('changed root contract or explicit missing section cannot create a new directory scope', async () => {
  for (const directory of [knownProductRoot.replace('示例报告目录', '另一个目录'), knownProductRoot.replace('<p id="th3">当前结论', '<p id="th3">备注'), knownProductRoot.replace('<h2 id="existing">', '<h1 id="existing">').replace('</h2>', '</h1>')]) {
    const h = harness({ directory });
    const p = await publish(h);
    assert.equal(p.directory.code, 'DIRECTORY_MAPPING_REQUIRED');
    assert.equal(h.calls.filter(c => c.args.includes('append')).length, 0);
  }
  const explicit = harness({ directory: knownProductRoot });
  explicit.deps.config.directorySection = '用户指定但不存在的章节';
  assert.equal((await publish(explicit)).directory.code, 'DIRECTORY_MAPPING_REQUIRED');
});

test('unknown scope append reconciles by readback and never duplicates the section', async () => {
  const h = harness({ directory: knownProductRoot });
  const original = h.deps.runner;
  let writes = 0;
  h.deps.runner = async (...args) => {
    const response = await original(...args);
    if (args[1].includes('append')) { writes++; throw new Error('timeout after successful append'); }
    return response;
  };
  const p = await publish(h);
  assert.equal(p.directory.writeUncertain, true);
  const reconciled = await publish(h, { publication: p });
  assert.equal(reconciled.directory.status, 'verified');
  assert.equal(writes, 1);
  assert.equal(h.directory.split('保存资料测试｜SIT｜阶段测试报告').length - 1, 1);
});

test('needs_refresh uses one read-only directory fetch then rechecks the same user before create', async () => {
  let identities = 0;
  const h = harness({ intercept: async args => {
    if (args.includes('whoami') && ++identities === 1) return { identity: 'user', available: false, tokenStatus: 'needs_refresh', onBehalfOf: { userName: 'Test Maintainer', openId: owner } };
    return undefined;
  } });
  const p = await publish(h);
  assert.equal(p.status, 'published');
  const whoPositions = h.calls.flatMap((c, i) => c.args.includes('whoami') ? [i] : []);
  const createPosition = h.calls.findIndex(c => c.args.includes('+create'));
  assert.equal(whoPositions.length, 2);
  assert.ok(h.calls.slice(whoPositions[0] + 1, whoPositions[1]).some(c => c.args.includes('+fetch')));
  assert.ok(whoPositions[1] < createPosition);
});

test('refresh failure or identity drift stops before all document writes', async () => {
  const failed = harness({ directoryTimeout: true, intercept: async args => args.includes('whoami') ? { identity: 'user', available: false, tokenStatus: 'needs_refresh', onBehalfOf: { userName: 'Test Maintainer', openId: owner } } : undefined });
  await assert.rejects(publish(failed), { code: 'AUTH_REFRESH_FAILED' });
  assert.equal(failed.calls.filter(c => c.args.includes('+create')).length, 0);
  let count = 0;
  const drift = harness({ intercept: async args => args.includes('whoami') ? { identity: 'user', available: ++count > 1, tokenStatus: count === 1 ? 'needs_refresh' : 'ready', onBehalfOf: { userName: 'Test Maintainer', openId: count === 1 ? owner : 'different-user' } } : undefined });
  await assert.rejects(publish(drift), { code: 'IDENTITY_MISMATCH' });
  assert.equal(drift.calls.filter(c => c.args.includes('+create')).length, 0);
});

test('concurrent edit after create is never adopted into the managed region or overwritten', async () => {
  let created=false;
  const h=harness({intercept:async(args,opts,state)=>{
    if(args.includes('+create'))created=true;
    if(created&&args.includes('+fetch')&&args[args.indexOf('--doc')+1]==='report'){
      state.report+='<p id="human">人工补充：必须永久保留</p>';
      return json({document:{document_id:'report',revision_id:2,content:state.report}});
    }
  }});
  let saved;
  await assert.rejects(publish(h),error=>{saved=error.publication;return error.code==='READBACK_CONCURRENT_EDIT';});
  assert.equal(saved.documentId,'report');assert.ok(saved.pending);assert.equal(saved.managed,undefined);
  assert.match(h.report,/人工补充/);
  await assert.rejects(publish(h,{publication:saved}),{code:'RECONCILIATION_REQUIRED'});
  assert.equal(h.calls.filter(c=>c.args.includes('+create')).length,1);
  assert.equal(h.calls.filter(c=>c.args.includes('+update')).length,0);
});

test('concurrent edit after update retains old managed baseline and requires reconciliation', async () => {
  let interfere=false;
  const h=harness({intercept:async(args,opts,state)=>{
    if(interfere&&args.includes('+fetch')&&args[args.indexOf('--doc')+1]==='report'){
      state.report+='<p id="human">更新期间的人工补充</p>';interfere=false;
      return json({document:{document_id:'report',revision_id:99,content:state.report}});
    }
    if(args.includes('+update')&&args[args.indexOf('--doc')+1]==='report')interfere=true;
  }});
  const p=await publish(h);let saved;
  await assert.rejects(publish(h,{publication:p},snapshot('第二次保存刷新正确')),error=>{saved=error.publication;return error.code==='READBACK_CONCURRENT_EDIT';});
  assert.ok(saved.pending);assert.deepEqual(saved.managed,p.managed);assert.match(h.report,/更新期间的人工补充/);
  await assert.rejects(publish(h,{publication:saved},snapshot('再次更新')),{code:'RECONCILIATION_REQUIRED'});
  assert.equal(h.calls.filter(c=>c.args.includes('+update')&&c.args[c.args.indexOf('--doc')+1]==='report').length,1);
});

test('missing confirmed write revision retains identity and cannot adopt a baseline', async () => {
  const h=harness({intercept:async(args,opts,state)=>{
    if(args.includes('+create')){state.report='<title id="report">报告</title><p id="body">待核对</p>';return json({document:{document_id:'report',url:reportURL}});}
  }});
  await assert.rejects(publish(h),error=>error.code==='READBACK_REVISION_UNCONFIRMED'&&error.publication.documentId==='report'&&Boolean(error.publication.pending)&&!error.publication.managed);
});

test('failed transport never leaks private runner messages into public error', async () => {
  const h = harness({ intercept: async () => { throw new Error('secret-token-do-not-repeat'); } });
  await assert.rejects(publish(h), error => error instanceof PublicationError && !error.message.includes('secret-token'));
});

test('read calls retain 60s timeout while create and directory writes receive 15 minutes', async () => {
  const options = [];
  const h = harness({ intercept: async (args, opts) => { options.push({ args, timeout: opts.timeout }); } });
  await publish(h);
  assert.ok(options.some(c => c.args.includes('+create')));
  assert.ok(options.some(c => c.args.includes('+update')));
  for (const call of options) assert.equal(call.timeout, call.args.includes('+create') || call.args.includes('+update') ? 900_000 : 60_000);
  options.length = 0;
  h.deps.config.timeout = 123;
  h.deps.config.readTimeout = 456;
  h.deps.config.writeTimeout = 789;
  await publish(h);
  for (const call of options) assert.equal(call.timeout, call.args.includes('+create') || call.args.includes('+update') ? 789 : 456);
});

test('timeout diagnostics survive unknown create with no private runner output and no replay', async () => {
  const h = harness({ intercept: async args => {
    if (args.includes('+create')) throw new PublicationError('CLI_EXECUTION_FAILED', 'private-token-do-not-persist', { transportCode: 'ETIMEDOUT', timedOut: true, diagnostics: { stage: 'docs_create', transportCode: 'ETIMEDOUT', timedOut: true, stderr: 'private-token-do-not-persist' } });
  } });
  let saved;
  await assert.rejects(publish(h), error => {
    saved = error.publication;
    assert.deepEqual(error.diagnostics, { stage: 'docs_create', causeCode: 'CLI_EXECUTION_FAILED', transportCode: 'ETIMEDOUT', timedOut: true, timeoutMs: 900_000 });
    assert.equal(JSON.stringify(error).includes('private-token'), false);
    return error.code === 'CREATE_STATUS_UNKNOWN';
  });
  await assert.rejects(publish(h, { publication: saved }), { code: 'RECONCILIATION_REQUIRED' });
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 1);
});

test('structured provider error preserves safe taxonomy and returned document id', async () => {
  const h = harness({ intercept: async args => args.includes('+create') ? { ok: false, identity: 'user', error: { type: 'network', subtype: 'timeout', message: 'private-token', hint: 'private-token' }, data: { document: { document_id: 'report', url: reportURL } } } : undefined });
  await assert.rejects(publish(h), error => {
    assert.equal(error.code, 'CREATE_STATUS_UNKNOWN');
    assert.deepEqual(error.diagnostics, { stage: 'docs_create', causeCode: 'CLI_REJECTED', timeoutMs: 900_000, providerType: 'network', providerSubtype: 'timeout' });
    assert.equal(error.publication.documentId, 'report');
    assert.ok(error.publication.pending);
    assert.equal(JSON.stringify(error).includes('private-token'), false);
    return true;
  });
  assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 1);
  assert.equal(h.calls.filter(c => c.args.includes('+update')).length, 0);
});

test('CLI media partial failure retains known document and safe nested provider classification', async () => {
  const h = harness({ intercept: async args => args.includes('+create') ? { ok: false, identity: 'user', data: { document: { document_id: 'report', url: reportURL }, local_resource_failures: [{ status: 'upload_failed', error: { type: 'api', subtype: 'rate_limit', message: 'private-token' }, server_warnings: ['private-token'] }] } } : undefined });
  await assert.rejects(publish(h), error => {
    assert.equal(error.code, 'CREATE_STATUS_UNKNOWN');
    assert.equal(error.publication.documentId, 'report');
    assert.equal(error.diagnostics.providerType, 'api');
    assert.equal(error.diagnostics.providerSubtype, 'rate_limit');
    assert.equal(JSON.stringify(error).includes('private-token'), false);
    return true;
  });
});

test('structured failed and partial result retain created identity and require reconciliation', async () => {
  for (const result of ['failed', 'partial_success', '']) {
    const h = harness({ intercept: async args => args.includes('+create') ? json({ result, document: { document_id: 'report', url: reportURL, revision_id: 1 } }) : undefined });
    let publication;
    await assert.rejects(publish(h), error => {
      publication = error.publication;
      assert.equal(error.diagnostics.stage, 'docs_create');
      return error.code === 'WRITE_PARTIAL' && publication.documentId === 'report' && publication.pending.operation === 'readback';
    });
    await assert.rejects(publish(h, { publication }), { code: 'RECONCILIATION_REQUIRED' });
    assert.equal(h.calls.filter(c => c.args.includes('+create')).length, 1);
    assert.equal(h.calls.filter(c => c.args.includes('+update')).length, 0);
  }
});

test('update transport diagnostics preserve old managed baseline and pending write', async () => {
  const h = harness();
  const publication = await publish(h);
  const original = h.deps.runner;
  h.deps.runner = async (...args) => {
    if (args[1].includes('--start-block-id')) throw Object.assign(new Error('private-token'), { code: 'ETIMEDOUT', timedOut: true });
    return original(...args);
  };
  await assert.rejects(publish(h, { publication }, snapshot('更新结果')), error => {
    assert.equal(error.code, 'UPDATE_STATUS_UNKNOWN');
    assert.deepEqual(error.publication.managed, publication.managed);
    assert.equal(error.publication.pending.operation, 'update');
    assert.equal(error.diagnostics.transportCode, 'ETIMEDOUT');
    assert.equal(error.diagnostics.stage, 'docs_update');
    assert.equal(error.diagnostics.timedOut, true);
    assert.equal(JSON.stringify(error).includes('private-token'), false);
    return true;
  });
});

test('runner parses nonzero structured stderr independently of stdout progress', async () => {
  const script = `process.stdout.write('progress containing private-token');process.stderr.write(JSON.stringify({ok:false,error:{type:'network',subtype:'timeout',message:'private-token'}}));process.exitCode=4;`;
  const raw = await execFileRunner(process.execPath, ['-e', script], { timeout: 2000 });
  const result = JSON.parse(raw.stdout);
  assert.equal(result.ok, false);
  assert.equal(result.error.subtype, 'timeout');
  assert.equal(raw.diagnostics.transportCode, 4);
  assert.equal(raw.diagnostics.timedOut, false);
});

test('runner marks an actual killed timeout without forwarding output', async () => {
  await assert.rejects(execFileRunner(process.execPath, ['-e', "process.stderr.write('private-token');setInterval(()=>{},1000)"], { timeout: 100 }), error => {
    assert.equal(error.code, 'CLI_EXECUTION_FAILED');
    assert.equal(error.diagnostics.timedOut, true);
    assert.equal(error.diagnostics.timeoutMs, 100);
    assert.equal(JSON.stringify(error).includes('private-token'), false);
    return true;
  });
});

test('native binary resolution requires the installed package and recognized npm wrapper structure', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'publisher-native-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'scripts'));
  await mkdir(path.join(cwd, 'bin'));
  const wrapper = path.join(cwd, 'scripts', 'run.js');
  const native = path.join(cwd, 'bin', process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli');
  const packageFile = path.join(cwd, 'package.json');
  await writeFile(packageFile, JSON.stringify({ name: '@larksuite/cli' }));
  await writeFile(wrapper, 'const { execFileSync } = require("child_process");\nconst bin = path.join(__dirname, "..", "bin", "lark-cli" + ext);\nexecFileSync(bin, args, { stdio: "inherit" });');
  await writeFile(native, 'test native binary', { mode: 0o700 });
  assert.equal(await resolveCliBinary(wrapper), await realpath(native));
  await writeFile(packageFile, JSON.stringify({ name: 'other-package' }));
  assert.equal(await resolveCliBinary(wrapper), wrapper);
  await writeFile(packageFile, JSON.stringify({ name: '@larksuite/cli' }));
  await writeFile(wrapper, 'unrecognized wrapper');
  assert.equal(await resolveCliBinary(wrapper), wrapper);
  assert.equal(await resolveCliBinary(path.join(cwd, 'missing')), path.join(cwd, 'missing'));
});

test('diagnostic allowlist drops raw data and exported readback helpers preserve the contract', () => {
  assert.deepEqual(publicationDiagnostics({ stage: 'docs_create', causeCode: 'CLI_REJECTED', transportCode: 'secret-token', providerType: 'network', providerSubtype: 'timeout', timeoutMs: 60, timedOut: true, stderr: 'secret-token', message: 'secret-token', token: 'secret-token' }), { stage: 'docs_create', causeCode: 'CLI_REJECTED', timedOut: true, timeoutMs: 60, providerType: 'network', providerSubtype: 'timeout' });
  const document = { content: '<p id="body">内容</p>', reference_map: {} };
  const range = blocks(document.content);
  assert.deepEqual(checkReadback({ content: '<p>内容</p>', format: 'xml', evidence: [] }, range, document), []);
  assert.match(regionHash(range), /^[a-f0-9]{64}$/);
  assert.match(referenceHash(document), /^[a-f0-9]{64}$/);
});

test('native unaddressable list groups expose only their addressable li blocks', () => {
  const document={content:'<title id="doc">报告</title><p id="intro">说明</p><ol><li id="one" seq="1" seq-marker="1.">打开页面</li><li id="two" seq="2" seq-marker="2.">刷新回读</li></ol><ul><li id="three">截图说明</li></ul><p id="end">结果保持</p>'};
  const range=blocks(document.content);
  assert.deepEqual(range.map(b=>b.id),['intro','one','two','three','end']);
  assert.deepEqual(checkReadback({content:'说明\n1. 打开页面\n2. 刷新回读\n- 截图说明\n结果保持',format:'markdown',evidence:[]},range,document),[]);
});

test('list wrapper support still rejects non-item children, missing native ids, and unsupported attributes', () => {
  for(const xml of ['<ol><p id="p">非列表项</p></ol>','<ul><li>无标识</li></ul>','<ol class="human-style"><li id="one">内容</li></ol>','<div><li id="one">未知分组</li></div>','<ol></ol>'])assert.throws(()=>blocks(xml),{code:'UNSUPPORTED_READBACK'});
});

test('media verification follows report step order instead of evidence insertion order', () => {
  const early={id:'early',image:true,caption:'操作前',resource:'<img path="@./early.png" caption="操作前"/>'};
  const late={id:'late',image:true,caption:'操作后',resource:'<img path="@./late.png" caption="操作后"/>'};
  const prepared={content:`<p>保存过程</p>${early.resource}${late.resource}`,format:'xml',evidence:[late,early]};
  const document={content:'<p id="body">保存过程</p><img id="one" src="NativeEarly" caption="操作前&#xA;"/><img id="two" src="NativeLate" caption="操作后&#xA;"/>'};
  assert.deepEqual(checkReadback(prepared,blocks(document.content),document).map(r=>r.evidenceId),['early','late']);
  const reversed={content:'<p id="body">保存过程</p><img id="one" src="NativeLate" caption="操作后&#xA;"/><img id="two" src="NativeEarly" caption="操作前&#xA;"/>'};
  assert.throws(()=>checkReadback(prepared,blocks(reversed.content),reversed),{code:'MEDIA_READBACK_MISMATCH'});
  assert.throws(()=>checkReadback({...prepared,content:'<p>保存过程</p>'+early.resource},blocks(document.content),document),{code:'MEDIA_READBACK_MISMATCH'});
});

test('native flattened caption preserves source words and spaces', () => {
  const evidence={id:'multiline',image:true,caption:'操作前\n操作后 保持一致'};
  const prepared={content:'<p>场景</p>',format:'xml',evidence:[evidence]};
  const document={content:'<p id="body">场景</p><img id="image" src="NativeAsset123" caption="操作前操作后 保持一致&#xA;"/>'};
  assert.equal(checkReadback(prepared,blocks(document.content),document)[0].uploaded,true);
  const changed={content:document.content.replace('操作后 保持一致','操作后保持一致')};
  assert.throws(()=>checkReadback(prepared,blocks(changed.content),changed),{code:'MEDIA_READBACK_MISMATCH'});
});

test('native image captions may contain one serialized paragraph terminator only', () => {
  const prepared={content:'<p>场景</p><img path="@./proof.png" caption="操作结果"/>',format:'xml',evidence:[{id:'evidence',image:true,caption:'操作结果'}]};
  for(const ending of ['','&#xA;','&#10;','&#13;&#10;']){
    const document={content:`<p id="body">场景</p><img id="image" src="NativeAsset123" caption="操作结果${ending}"/>`};
    assert.equal(checkReadback(prepared,blocks(document.content),document)[0].uploaded,true);
  }
  for(const caption of ['改写图注','操作结果&#xA;&#xA;',' 操作结果','操作结果附加内容']){
    const document={content:`<p id="body">场景</p><img id="image" src="NativeAsset123" caption="${caption}"/>`};
    assert.throws(()=>checkReadback(prepared,blocks(document.content),document),{code:'MEDIA_READBACK_MISMATCH'});
  }
});


test('community users can publish under their own configured identity',async()=>{
 const h=harness({userName:'Community Maintainer'});h.deps.config.expectedUserName='Community Maintainer';
 const p=await publish(h);assert.equal(p.ownerId,owner);assert.equal(p.status,'published');
});
test('optional directory can be omitted without leaving publication pending',async()=>{
 const h=harness();Object.assign(h.deps.config,{productDirectory:'',historyDirectory:'',directoryUrl:''});
 const p=await publish(h);assert.equal(p.status,'published');assert.equal(p.directory.status,'not_configured');
 assert.equal(h.calls.some(c=>c.args.includes('product-index')),false);
});
