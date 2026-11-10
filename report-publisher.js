import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONFIG = Object.freeze({
  binary: 'lark-cli',
  cwd: process.cwd(),
  expectedUserName: '',
  productDirectory: '',
  historyDirectory: '',
  timeout: 60_000,
  writeTimeout: 15 * 60_000,
});

export class PublicationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PublicationError';
    this.code = code;
    Object.assign(this, details);
  }
}
const fail = (code, message, details) => { throw new PublicationError(code, message, details); };
const hash = value => createHash('sha256').update(value).digest('hex');
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const decode = value => value.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
const text = value => decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const compact = value => value.normalize('NFC').replace(/\s+/gu, '');
const attr = (xml, key) => decode(new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(xml)?.[1] ?? '');
const statuses = { passed: '通过', failed: '失败', blocked: '阻塞', deferred: '暂缓', in_progress: '执行中', not_started: '未执行' };

const providerTypes = new Set(['validation', 'authentication', 'authorization', 'config', 'network', 'api', 'policy', 'internal', 'confirmation']);
const transportCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);
const stages = new Set(['identity', 'docs_fetch', 'docs_create', 'docs_update', 'drive_metadata', 'cli']);
const commandStage = argv => argv.includes('whoami') ? 'identity' : argv.includes('+create') ? 'docs_create' : argv.includes('+update') ? 'docs_update' : argv.includes('+fetch') ? 'docs_fetch' : argv.includes('metas') ? 'drive_metadata' : 'cli';

/** Keep machine identifiers only; provider messages, hints and command output are never persisted. */
export function publicationDiagnostics(value = {}) {
  const result = {};
  if (stages.has(value.stage)) result.stage = value.stage;
  if (typeof value.causeCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value.causeCode)) result.causeCode = value.causeCode;
  if (transportCodes.has(value.transportCode) || Number.isInteger(value.transportCode)) result.transportCode = value.transportCode;
  if (typeof value.timedOut === 'boolean') result.timedOut = value.timedOut;
  if (Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0) result.timeoutMs = value.timeoutMs;
  if (providerTypes.has(value.providerType)) result.providerType = value.providerType;
  if (typeof value.providerSubtype === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value.providerSubtype)) result.providerSubtype = value.providerSubtype;
  return result;
}

/** The npm entry is a Node wrapper with a native child. Invoke the verified sibling directly so timeout reaches the CLI. */
export async function resolveCliBinary(binary) {
  let installed;
  try { installed = await realpath(binary); } catch { return binary; }
  if (path.basename(installed) !== 'run.js' || path.basename(path.dirname(installed)) !== 'scripts') return binary;
  const root = path.dirname(path.dirname(installed));
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const wrapper = await readFile(installed, 'utf8');
    if (pkg.name !== '@larksuite/cli' ||
        !wrapper.includes('const { execFileSync } = require("child_process");') ||
        !wrapper.includes('const bin = path.join(__dirname, "..", "bin", "lark-cli" + ext);') ||
        !wrapper.includes('execFileSync(bin, args, { stdio: "inherit" });')) return binary;
    const native = path.join(root, 'bin', process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli');
    if (await realpath(native) !== native) return binary;
    const info = await stat(native);
    if (!info.isFile() || (process.platform !== 'win32' && !(info.mode & 0o111))) return binary;
    return native;
  } catch { return binary; }
}

/** execFile only: no shell, caller-controlled command strings, or credential logging. */
export async function execFileRunner(binary, argv, options = {}) {
  const executable = await resolveCliBinary(binary);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = execFile(executable, argv, { cwd: options.cwd, timeout: options.timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', shell: false }, (error, stdout, stderr) => {
      const diagnostics = publicationDiagnostics({ stage: commandStage(argv), timeoutMs: options.timeout, timedOut: Boolean(error?.killed && error.signal === 'SIGTERM' && options.timeout > 0 && Date.now() - started >= options.timeout), transportCode: error?.code });
      if (error) {
        // Partial failures use stdout, typed errors stderr. Inspect independently;
        // unrelated progress output must not hide the structured error envelope.
        for (const output of [stdout, stderr]) {
          try {
            const result = JSON.parse(output.trim());
            if (result.ok === false) { resolve({ stdout: JSON.stringify(result), diagnostics }); return; }
          } catch { /* Ambiguous transport/partial output stays unknown. */ }
        }
        reject(new PublicationError('CLI_EXECUTION_FAILED', 'Lark CLI did not return a confirmed result.', { ...diagnostics, diagnostics }));
      } else resolve({ stdout, diagnostics });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}

function allEvidence(snapshot, explicit) {
  const source = explicit ?? snapshot.cases.flatMap(c => (c.evidence ?? []).map(e => ({ ...e, caseId: c.id, scene: c.title })));
  if (!Array.isArray(source)) fail('INVALID_EVIDENCE', 'Evidence must be an array.');
  const ids = new Set();
  return source.map(e => {
    if (!e?.id || ids.has(e.id) || !e.path || !e.caption?.trim()) fail('INVALID_EVIDENCE', 'Every evidence item needs a unique id, local path and visible caption.');
    ids.add(e.id);
    if (!/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|application\/pdf)$/.test(e.mime ?? '')) fail('UNSUPPORTED_MEDIA', 'Evidence media type is not supported by this adapter.');
    return { ...e, image: e.mime.startsWith('image/') };
  });
}

/** Pure preparation. Caller-supplied Markdown remains authoritative; no business verdict is inferred. */
export function prepareReport({ snapshot, markdown, title, evidence } = {}, config = {}) {
  if (!snapshot?.id || !snapshot.requirementId || !Array.isArray(snapshot.cases)) fail('INVALID_SNAPSHOT', 'A stable round snapshot with requirementId and cases is required.');
  title = title ?? snapshot.title;
  if (!title?.trim()) fail('INVALID_TITLE', 'A report title is required.');
  const cwd = path.resolve(config.cwd ?? DEFAULT_CONFIG.cwd);
  const items = allEvidence(snapshot, evidence).map(e => {
    const absolutePath = path.resolve(cwd, e.path);
    const relativePath = path.relative(cwd, absolutePath);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) fail('EVIDENCE_OUTSIDE_ROOT', 'Evidence must be inside the configured publication cwd.');
    const resource = e.image
      ? `<img path="@./${esc(relativePath)}" caption="${esc(e.caption)}"/>`
      : `<p>${esc(e.caption)}</p><figure view-type="${e.mime.startsWith('video/') ? 'Preview' : 'Card'}"><source path="@./${esc(relativePath)}" name="${esc(e.name ?? path.basename(e.path))}"/></figure>`;
    return { ...e, absolutePath, relativePath, resource };
  });
  let content;
  let format;
  if (markdown !== undefined) {
    if (typeof markdown !== 'string' || !markdown.trim()) fail('INVALID_MARKDOWN', 'Supplied Markdown must be nonempty.');
    // Never let supplied rich markup upload arbitrary local/remote files.
    if (/<\s*(img|source|whiteboard|iframe|script)\b/i.test(markdown)) fail('UNTRUSTED_RESOURCE_MARKUP', 'Use evidence markers for uploaded resources.');
    content = markdown.replace(/^#\s+[^\n]+\n?/, '');
    for (const e of items) {
      const marker = `<!-- evidence:${e.id} -->`;
      const count = content.split(marker).length - 1;
      if (count > 1) fail('DUPLICATE_EVIDENCE_MARKER', 'An evidence marker occurs more than once.');
      if (count === 1) content = content.replace(marker, e.resource);
      else {
        // Existing renderers can emit local Markdown images. Match only the exact registered file.
        let matched = 0;
        content = content.replace(/!\[[^\]]*\]\((?:<([^>]+)>|([^\n)]+))\)/g, (whole, bracketed, simple) => {
          const target = bracketed ?? simple;
          if (path.resolve(cwd, target.replace(/^@/, '')) !== e.absolutePath) return whole;
          matched++;
          return e.resource;
        });
        if (matched !== 1) fail('EVIDENCE_PLACEMENT_REQUIRED', 'Each evidence item needs one scene-adjacent marker or matching local image.', { evidenceId: e.id });
      }
    }
    if (/!\[[^\]]*\]\(|<!--\s*evidence:/i.test(content)) fail('UNREGISTERED_EVIDENCE', 'A report resource is not registered in this snapshot.');
    format = 'markdown';
  } else {
    const parts = [`<p>环境：${esc(snapshot.environment || '待补充')}；版本：${esc(snapshot.version || '待补充')}；范围：${esc(snapshot.scope || '本轮已登记场景')}。</p>`, '<p>本报告反映当前记录；未执行、暂缓和已移出场景不计为通过。结论效力以已批准的测试范围为准。</p>'];
    for (const c of snapshot.cases) {
      parts.push(`<h1>${esc(c.title)}</h1>`);
      if (c.removed) parts.push(`<p>已移出本轮：${esc(c.removed.reason)}。历史结果与证据保留。</p>`);
      const steps = c.steps ?? [];
      for (const [i, s] of steps.entries()) {
        const result = (c.execution?.stepResults ?? c.execution?.steps ?? [])[i];
        parts.push(`<p>${i + 1}. 操作：${esc(s.action)}；要求：${esc(s.expected)}；实际：${esc(result?.actual ?? '未记录逐步结果')}。</p>`);
      }
      if (c.expected) parts.push(`<p>要求：${esc(c.expected)}</p>`);
      parts.push(`<p>实际结果：${esc(c.execution?.actual || (c.execution?.status === 'passed' ? '已标记通过，未填写补充说明' : '尚未记录'))}；测试结果：${esc(statuses[c.execution?.status] ?? '未执行')}。</p>`);
      if (c.execution?.issue) parts.push(`<p>问题：${esc(typeof c.execution.issue === 'object' ? JSON.stringify(c.execution.issue) : c.execution.issue)}</p>`);
      const media = items.filter(e => e.caseId === c.id || (c.evidence ?? []).some(ce => ce.id === e.id));
      parts.push(...media.map(e => e.resource));
      if (!media.length) parts.push('<p>证据：本场景尚未登记媒体，展示证据存在缺口。</p>');
    }
    const unbound = items.filter(e => !snapshot.cases.some(c => c.id === e.caseId || (c.evidence ?? []).some(ce => ce.id === e.id)));
    if (unbound.length) fail('EVIDENCE_SCENE_REQUIRED', 'Every evidence item must belong to a report scene.');
    content = parts.join('');
    format = 'xml';
  }
  return { title, content, format, evidence: items, sourceHash: hash(JSON.stringify({ title, content, evidence: items.map(e => [e.id, e.caption, e.relativePath]) })), roundId: snapshot.id, requirementId: snapshot.requirementId };
}

// Minimal structural scanner, not a permissive HTML parser. Unsupported wrappers fail closed.
export function blocks(xml) {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY|<!--/i.test(xml)) fail('UNSUPPORTED_READBACK', 'Unexpected document XML.');
  const result = [];
  const stack = [];
  let start = 0;
  let cursor = 0;
  const tags = /<\/?([\w-]+)\b[^>]*>/g;
  for (let m; (m = tags.exec(xml));) {
    if (!stack.length && xml.slice(cursor, m.index).trim()) fail('UNSUPPORTED_READBACK', 'Unwrapped text in document XML.');
    const close = m[0].startsWith('</');
    const self = m[0].endsWith('/>');
    if (!stack.length) start = m.index;
    if (close) {
      if (stack.pop() !== m[1]) fail('UNSUPPORTED_READBACK', 'Unbalanced document XML.');
    } else if (!self) stack.push(m[1]);
    if (!stack.length) {
      const raw = xml.slice(start, tags.lastIndex);
      if (m[1] !== 'title') {
        const open = /^<[^>]+>/.exec(raw)?.[0] ?? '';
        const id = attr(open, 'id') || attr(open, 'block-id');
        const tag = /^<([\w-]+)/.exec(raw)[1];
        if (!id && ['ol', 'ul'].includes(tag) && new RegExp(`^<${tag}\\s*>`).test(open)) {
          // Feishu groups consecutive list-item blocks in an unaddressable ol/ul.
          // Each direct li remains a native addressable block; reject any other child.
          const children = blocks(raw.slice(open.length, raw.lastIndexOf(`</${tag}>`)));
          if (!children.length || children.some(child => child.tag !== 'li')) fail('UNSUPPORTED_READBACK', 'List groups must contain addressable list-item blocks only.');
          result.push(...children);
        } else {
          if (!id) fail('UNSUPPORTED_READBACK', 'Top-level block ids are required.');
          result.push({ id, tag, raw });
        }
      }
      cursor = tags.lastIndex;
    }
  }
  if (stack.length || xml.slice(cursor).trim()) fail('UNSUPPORTED_READBACK', 'Incomplete document XML.');
  return result;
}
export const regionHash = bs => hash(bs.map(b => b.raw).join(''));
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
export const referenceHash = document => hash(JSON.stringify(stable(document.reference_map ?? {})));
function managedRegion(bs, managed) {
  const start = bs.findIndex(b => b.id === managed?.startBlockId);
  const end = bs.findIndex(b => b.id === managed?.endBlockId);
  if (start < 0 || end < start) fail('CONTENT_CONFLICT', 'The managed report range was moved, removed or replaced.');
  const range = bs.slice(start, end + 1);
  if (regionHash(range) !== managed.hash) fail('CONTENT_CONFLICT', 'Managed report content was edited; preserve the user changes and reconcile explicitly.');
  return { range, before: bs.slice(0, start), after: bs.slice(end + 1) };
}
export function checkReadback(prepared, range, document) {
  if (!range.length) fail('READBACK_MISMATCH', 'Published report body is empty.');
  const xml = range.map(b => b.raw).join('');
  const actual = compact(text(xml));
  const prose = prepared.content.replace(/<img\b[^>]*\/>/g, '').replace(/<figure\b[\s\S]*?<\/figure>/g, '');
  const fragments = prepared.format === 'xml' ? [text(prose)] : prose.split('\n').map(line => text(line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[\s#>*+\d.-]+/, '').replace(/[|*_`~]/g, ' '))).filter(line => line && !/^[-: ]+$/.test(line));
  let position = 0;
  for (const fragment of fragments) {
    const next = actual.indexOf(compact(fragment), position);
    if (next < 0) fail('READBACK_MISMATCH', 'Published body does not contain the prepared report text in scenario order.');
    position = next + compact(fragment).length;
  }
  const images = [...xml.matchAll(/<img\b[^>]*\/?>(?:[\s\S]*?<\/img>)?/g)].map(m => m[0]);
  // The report groups evidence by scenario/step; insertion order in the ledger may differ.
  const orderedEvidence = [...prepared.evidence];
  if (orderedEvidence.every(e => typeof e.resource === 'string')) {
    if (orderedEvidence.some(e => !prepared.content.includes(e.resource))) fail('MEDIA_READBACK_MISMATCH', 'Prepared evidence is missing from the report body.');
    orderedEvidence.sort((a, b) => prepared.content.indexOf(a.resource) - prepared.content.indexOf(b.resource));
  }
  const imageEvidence = orderedEvidence.filter(e => e.image);
  if (images.length !== imageEvidence.length) fail('MEDIA_READBACK_MISMATCH', 'Uploaded image count differs from prepared evidence.');
  const receipts = imageEvidence.map((e, i) => {
    const image = images[i];
    const ref = attr(image, 'ref');
    const sidecar = document.reference_map?.img?.[ref];
    const token = attr(image, 'token') || attr(image, 'src') || sidecar?.token || sidecar?.src;
    const caption = attr(image, 'caption');
    // Feishu may flatten hard breaks inside a caption and add one paragraph terminator.
    // Accept only those serialized forms; do not discard spaces or added caption text.
    const captionForms = [e.caption, e.caption.replace(/\r\n?|\n/g, '')];
    const captionMatches = captionForms.some(expected => caption === expected || caption === expected + '\n' || caption === expected + '\r\n');
    if (!/^[A-Za-z0-9_-]+$/.test(token ?? '') || !captionMatches) fail('MEDIA_READBACK_MISMATCH', 'Native image caption or uploaded media token is missing.', { evidenceId: e.id });
    return { evidenceId: e.id, caption: e.caption, uploaded: true };
  });
  const files = [...xml.matchAll(/<source\b[^>]*>/g)].map(m => m[0]);
  const fileEvidence = orderedEvidence.filter(e => !e.image);
  if (files.length !== fileEvidence.length) fail('MEDIA_READBACK_MISMATCH', 'Uploaded attachment count differs from prepared evidence.');
  for (const [i, e] of fileEvidence.entries()) {
    if (!actual.includes(compact(e.caption)) || !(attr(files[i], 'token') || attr(files[i], 'src')) || attr(files[i], 'name') !== (e.name ?? path.basename(e.path))) fail('MEDIA_READBACK_MISMATCH', 'Uploaded attachment/player identity was not verified.');
    receipts.push({ evidenceId: e.id, caption: e.caption, uploaded: true });
  }
  return receipts;
}

/**
 * All mutations require a durable checkpoint callback. Caller owns locks and storage.
 * runner(binary, argv, {cwd,timeout,input}) -> parsed JSON OR {stdout: JSON string}.
 */
export async function publishReport(input, deps = {}) {
  const config = { ...DEFAULT_CONFIG, ...deps.config };
  const runner = deps.runner ?? execFileRunner;
  const checkpoint = deps.checkpoint ?? deps.onCheckpoint;
  if (typeof checkpoint !== 'function') fail('CHECKPOINT_REQUIRED', 'A durable publication checkpoint callback is required before publishing.');
  const prepared = prepareReport(input, config);
  if (!input.jobId) fail('JOB_ID_REQUIRED', 'A stable publication jobId is required.');
  let publication = structuredClone(input.publication ?? {});
  if (publication.roundId && publication.roundId !== prepared.roundId) fail('PUBLICATION_IDENTITY_MISMATCH', 'The prior publication belongs to another round.');
  if (publication.requirementId && publication.requirementId !== prepared.requirementId) fail('PUBLICATION_IDENTITY_MISMATCH', 'The prior publication belongs to another requirement.');
  if (publication.pending) fail('RECONCILIATION_REQUIRED', 'An earlier external write is unresolved; do not repeat it.', { publication });
  const save = async patch => {
    publication = { ...publication, ...patch, roundId: prepared.roundId, requirementId: prepared.requirementId };
    try { await checkpoint(structuredClone(publication)); }
    catch { fail('CHECKPOINT_FAILED', 'Publication checkpoint could not be persisted; stop before further writes.', { publication }); }
  };
  const call = async (argv, inputText) => {
    const stage = commandStage(argv);
    const timeoutMs = ['docs_create', 'docs_update'].includes(stage) ? config.writeTimeout : config.readTimeout ?? config.timeout;
    let raw;
    try { raw = await runner(config.binary, [...(config.profile ? ['--profile', config.profile] : []), ...argv, '--as', 'user'], { cwd: config.cwd, timeout: timeoutMs, input: inputText }); }
    catch (error) {
      const diagnostics = publicationDiagnostics({ ...(error instanceof PublicationError ? error.diagnostics : {}), stage, timeoutMs, causeCode: error instanceof PublicationError ? error.code : 'CLI_EXECUTION_FAILED', transportCode: error?.transportCode ?? error?.code, timedOut: error?.timedOut });
      fail('CLI_EXECUTION_FAILED', 'Lark CLI result is unknown or unavailable.', { ...diagnostics, diagnostics });
    }
    let result;
    const baseDiagnostics = publicationDiagnostics({ ...raw?.diagnostics, stage, timeoutMs });
    try { result = typeof raw === 'string' ? JSON.parse(raw) : typeof raw?.stdout === 'string' ? JSON.parse(raw.stdout) : raw; }
    catch { fail('CLI_INVALID_JSON', 'Lark CLI returned an unreadable response.', { ...baseDiagnostics, diagnostics: baseDiagnostics }); }
    const providerError = result?.error ?? (Array.isArray(result?.data?.local_resource_failures) ? result.data.local_resource_failures.find(failure => failure?.error)?.error : undefined);
    const diagnostics = publicationDiagnostics({ ...baseDiagnostics, providerType: providerError?.type, providerSubtype: providerError?.subtype });
    const details = { ...diagnostics, diagnostics, returnedDocumentId: result?.data?.document?.document_id, returnedURL: result?.data?.document?.url };
    if (result?.ok === false && ['revision_conflict', 'revision_mismatch'].includes(result.error?.subtype)) fail('REVISION_CONFLICT', 'The document revision changed before the write was applied.', details);
    if (!result || result.ok === false || (result.code !== undefined && result.code !== 0)) fail('CLI_REJECTED', 'Lark CLI did not confirm the requested operation.', details);
    if (result.identity && result.identity !== 'user') fail('IDENTITY_MISMATCH', 'Lark CLI used an unexpected identity.', details);
    return result;
  };
  const fetchDoc = async id => {
    const response = await call(['docs', '+fetch', '--doc', id, '--doc-format', 'xml', '--detail', 'full']);
    const d = response.data?.document;
    if (!d?.document_id || !Number.isInteger(d.revision_id) || d.revision_id < 0 || typeof d.content !== 'string') fail('UNSUPPORTED_READBACK', 'Document identity, revision and full content are required.');
    return { ...d, blocks: blocks(d.content) };
  };
  try {
  let who = await call(['whoami']);
  const matchesUser = identity => {
    const person = identity.onBehalfOf ?? identity.data?.onBehalfOf;
    return identity.identity === 'user' && Boolean(person?.openId) && (!config.expectedUserName || person.userName === config.expectedUserName) && (!config.expectedOpenId || person.openId === config.expectedOpenId);
  };
  // whoami reports token state without refreshing it. An ordinary read through
  // the CLI can refresh the existing user authorization without a write/login.
  if (who.tokenStatus === 'needs_refresh' && matchesUser(who)) {
    const refreshTarget = config.directoryUrl || (config.directoryKind === 'history' ? config.historyDirectory : config.productDirectory) || publication.documentId;
    if (!refreshTarget) fail('AUTH_REFRESH_REQUIRED', 'Refresh the existing user authorization with Lark CLI before publishing.');
    try { await call(['docs', '+fetch', '--doc', refreshTarget, '--doc-format', 'xml', '--detail', 'full']); }
    catch { fail('AUTH_REFRESH_FAILED', 'Existing user authorization could not be refreshed through a read-only request.'); }
    const previousOpenId = (who.onBehalfOf ?? who.data?.onBehalfOf).openId;
    who = await call(['whoami']);
    if ((who.onBehalfOf ?? who.data?.onBehalfOf)?.openId !== previousOpenId) fail('IDENTITY_MISMATCH', 'User identity changed while refreshing authorization.');
  }
  const user = who.onBehalfOf ?? who.data?.onBehalfOf;
  if (!matchesUser(who) || who.available !== true || who.tokenStatus !== 'ready') fail('IDENTITY_MISMATCH', 'Ready user identity must match the configured report owner.');
  if (publication.ownerId && publication.ownerId !== user.openId) fail('OWNER_MISMATCH', 'Saved report owner differs from the active user.');
  const ownership = async id => {
    const response = await call(['drive', 'metas', 'batch_query', '--user-id-type', 'open_id', '--data', JSON.stringify({ request_docs: [{ doc_token: id, doc_type: 'docx' }], with_url: true })]);
    const data = response.data ?? response;
    const meta = data.metas?.find(m => m.doc_token === id && m.doc_type === 'docx');
    if (data.failed_list?.length || !meta || meta.owner_id !== user.openId) fail('OWNER_MISMATCH', 'Report ownership was not verified as the active user.');
    let url;
    try { url = new URL(meta.url); } catch { fail('INVALID_DOCUMENT_URL', 'Document metadata lacks a valid persisted URL.'); }
    if (url.protocol !== 'https:' || !['feishu.cn', 'larksuite.com'].some(s => url.hostname === s || url.hostname.endsWith(`.${s}`)) || !url.pathname.endsWith(`/docx/${id}`)) fail('INVALID_DOCUMENT_URL', 'Document URL does not match the persisted identity.');
    return meta;
  };
  // Realpath prevents a local evidence symlink from escaping the approved media root.
  const root = await realpath(config.cwd);
  const mediaDigests = [];
  for (const e of prepared.evidence) {
    let resolved, info;
    try { resolved = await realpath(e.absolutePath); info = await stat(resolved); }
    catch { fail('EVIDENCE_UNAVAILABLE', 'A registered local evidence file is unavailable.', { evidenceId: e.id }); }
    const relative = path.relative(root, resolved);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !info.isFile() || info.size === 0 || info.size > (config.maxEvidenceBytes ?? 20 * 1024 * 1024)) fail('EVIDENCE_UNAVAILABLE', 'Evidence is outside the root, empty or above the upload limit.', { evidenceId: e.id });
    mediaDigests.push([e.id, hash(await readFile(resolved))]);
  }
  if (mediaDigests.length) prepared.sourceHash = hash(JSON.stringify([prepared.sourceHash, mediaDigests]));
  let before, outside;
  if (publication.documentId) {
    await ownership(publication.documentId);
    before = await fetchDoc(publication.documentId);
    if (before.document_id !== publication.documentId) fail('PUBLICATION_IDENTITY_MISMATCH', 'Readback returned a different report document.');
    outside = managedRegion(before.blocks, publication.managed);
    if (!publication.managed.referenceHash || publication.managed.referenceHash !== referenceHash(before)) fail('CONTENT_CONFLICT', 'Document resource or comment references changed; preserve them and reconcile explicitly.');
    if (publication.sourceHash === prepared.sourceHash) {
      const media = checkReadback(prepared, outside.range, before);
      await save({ readback: { status: 'verified', revision: before.revision_id, ownerVerified: true, userReadable: true, media }, pending: null });
    }
  }
  if (!publication.documentId || publication.sourceHash !== prepared.sourceHash) {
    const operation = publication.documentId ? 'update' : 'create';
    await save({ ...(operation === 'create' ? { title: prepared.title } : {}), pending: { operation, jobId: input.jobId, sourceHash: prepared.sourceHash }, status: `${operation}_pending` });
    let response;
    try {
      response = operation === 'create'
        ? await call(['docs', '+create', '--title', prepared.title, '--doc-format', prepared.format, ...(config.parentToken ? ['--parent-token', config.parentToken] : ['--parent-position', 'my_library']), '--content', '-'], prepared.content)
        : await call(['docs', '+update', '--doc', publication.documentId, '--command', 'block_replace', '--start-block-id', outside.range[0].id, '--end-block-id', outside.range.at(-1).id, '--revision-id', String(before.revision_id), '--doc-format', prepared.format, '--content', '-'], prepared.content);
    } catch (error) {
      if (operation === 'create' && error.returnedDocumentId) await save({ documentId: error.returnedDocumentId, url: error.returnedURL ?? null, pending: { ...publication.pending, operation: 'ownership_reconciliation' }, status: 'readback_pending' });
      if (operation === 'update' && error.code === 'REVISION_CONFLICT') {
        await save({ pending: null, status: 'content_conflict' });
        fail('CONTENT_CONFLICT', 'The base document revision changed; preserve user edits and refetch before retrying.', { publication });
      }
      const diagnostics = publicationDiagnostics({ ...error.diagnostics, causeCode: error.code });
      fail(operation === 'create' ? 'CREATE_STATUS_UNKNOWN' : 'UPDATE_STATUS_UNKNOWN', 'External write was not confirmed. Reconcile the saved intent before retrying.', { publication, ...diagnostics, diagnostics });
    }
    const document = response.data?.document;
    if (operation === 'create' && document?.document_id) {
      // Persist the new identity even if warnings, media verification, owner lookup or directory fail later.
      await save({ documentId: document.document_id, url: document.url ?? null, ownerId: user.openId, pending: { ...publication.pending, operation: 'readback' }, status: 'readback_pending' });
    }
    if (!publication.documentId) fail('CREATE_STATUS_UNKNOWN', 'Create returned no durable document identity.', { publication });
    if (response.data?.result !== undefined && response.data.result !== 'success' || response.data?.warnings?.length) {
      const diagnostics = publicationDiagnostics({ stage: operation === 'create' ? 'docs_create' : 'docs_update', timeoutMs: config.writeTimeout });
      fail('WRITE_PARTIAL', 'The document write reported warnings or partial completion; reconcile it.', { publication, ...diagnostics, diagnostics });
    }
    const meta = await ownership(publication.documentId);
    const after = await fetchDoc(publication.documentId);
    if (!Number.isInteger(document?.revision_id) || document.revision_id < 0) fail('READBACK_REVISION_UNCONFIRMED', 'The write returned no confirmed revision; preserve the document and reconcile before adopting a managed baseline.', { publication });
    if (after.revision_id !== document.revision_id) fail('READBACK_CONCURRENT_EDIT', 'Document changed after the confirmed write or readback is stale; preserve all content and reconcile before another update.', { publication });
    if (after.document_id !== publication.documentId) fail('PUBLICATION_IDENTITY_MISMATCH', 'Published document readback identity changed.', { publication });
    let range = after.blocks;
    if (outside) {
      const first = outside.before.length;
      const last = after.blocks.length - outside.after.length;
      if (regionHash(after.blocks.slice(0, first)) !== regionHash(outside.before) || regionHash(after.blocks.slice(last)) !== regionHash(outside.after)) fail('READBACK_CONCURRENT_EDIT', 'Content outside the managed region changed; reconcile before another update.', { publication });
      range = after.blocks.slice(first, last);
    }
    const media = checkReadback(prepared, range, after);
    await save({ documentId: after.document_id, url: meta.url, ownerId: user.openId, sourceHash: prepared.sourceHash, managed: { startBlockId: range[0].id, endBlockId: range.at(-1).id, hash: regionHash(range), referenceHash: referenceHash(after), revision: after.revision_id }, pending: null, status: 'published_directory_pending', readback: { status: 'verified', revision: after.revision_id, ownerVerified: true, userReadable: true, media } });
  }
  // Directory failures are a separate recoverable obligation, never a reason to create another report.
  let directory;
  const directoryURL = config.directoryUrl || (config.directoryKind === 'history' ? config.historyDirectory : config.productDirectory);
  if (!directoryURL) {
    directory = {status:'not_configured'};
  } else try {
    directory = await syncDirectory({ input, config, publication, call, fetchDoc, save });
  } catch (error) {
    if (error.code === 'CHECKPOINT_FAILED') throw error;
    directory = { ...publication.directory, status: 'pending', code: error.code ?? 'DIRECTORY_SYNC_FAILED', url: config.directoryUrl || (config.directoryKind === 'history' ? config.historyDirectory : config.productDirectory) };
  }
  await save({ directory, status: ['verified','not_configured'].includes(directory.status) ? 'published' : 'published_directory_pending' });
  return structuredClone(publication);
  } catch (error) {
    if (error instanceof PublicationError) {
      error.publication = structuredClone(publication);
      throw error;
    }
    fail('PUBLICATION_FAILED', 'Publication stopped without a verified result.', { publication: structuredClone(publication) });
  }
}

async function syncDirectory({ input, config, publication, call, fetchDoc, save }) {
  const url = config.directoryUrl || (config.directoryKind === 'history' ? config.historyDirectory : config.productDirectory);
  const index = await fetchDoc(url); // CLI resolves Wiki URL afresh; never guess its obj_token.
  const escapedURL = esc(publication.url);
  const linkCount = raw => [...raw.matchAll(/<a\b[^>]*>/g)].filter(m => attr(m[0], 'href') === publication.url).length;
  const matches = index.blocks.filter(b => linkCount(b.raw));
  if (matches.reduce((n, b) => n + linkCount(b.raw), 0) > 1) fail('DIRECTORY_DUPLICATE', 'The report link has multiple directory entries.');
  const scope = String(input.snapshot.scope || input.snapshot.title);
  const environment = String(input.snapshot.environment || '环境待补充');
  const purpose = config.reportPurpose ?? '阶段测试报告';
  const active = input.snapshot.cases.filter(c => !c.removed);
  const count = status => active.filter(c => (c.execution?.status ?? 'not_started') === status).length;
  const summary = config.directorySummary ?? `有效场景${active.length}项，通过${count('passed')}项、失败${count('failed')}项、阻塞${count('blocked')}项、暂缓${count('deferred')}项、未执行${count('not_started')}项、执行中${count('in_progress')}项；移出本轮${input.snapshot.cases.length - active.length}项。当前记录的适用范围与限制见报告正文。`;
  const content = `<p>${esc(scope)}｜${esc(environment)}｜${esc(purpose)}｜<a href="${escapedURL}">${esc(input.title ?? input.snapshot.title)}</a>｜${esc(summary)}</p>`;
  if (matches[0]?.tag !== 'p' && matches.length) fail('DIRECTORY_STRUCTURE_UNSUPPORTED', 'Existing directory entry is not an isolated paragraph; preserve its rich structure.');
  if (matches.length && compact(text(matches[0].raw)) === compact(text(content))) {
    const savedSection = publication.directory?.sectionTitle;
    if (savedSection) {
      const position = index.blocks.findIndex(b => b.id === matches[0].id);
      const preceding = index.blocks.slice(0, position).filter(b => /^h[1-9]$/.test(b.tag)).at(-1);
      if (preceding?.tag !== 'h2' || text(preceding.raw) !== savedSection) fail('DIRECTORY_READBACK_MISMATCH', 'The report entry is outside its previously established scope section.');
    }
    return { status: 'verified', url, documentId: index.document_id, revision: index.revision_id, entryBlockId: matches[0].id, entryHash: hash(matches[0].raw), reportUrl: publication.url, deduplicated: true, ...(savedSection ? { sectionTitle: savedSection } : {}) };
  }
  if (publication.directory?.writeUncertain) fail('DIRECTORY_RECONCILIATION_REQUIRED', 'An earlier directory write is unresolved; reconcile its entry before retrying.');
  if (matches.length && (!publication.directory?.entryHash || hash(matches[0].raw) !== publication.directory.entryHash)) fail('DIRECTORY_CONTENT_CONFLICT', 'Directory entry changed outside this publisher; preserve its annotations.');
  const sectionTitle = `${input.snapshot.title}｜${environment}｜${purpose}`;
  let heading = index.blocks.filter(b => /^h[1-9]$/.test(b.tag) && text(b.raw) === (config.directorySection || scope));
  if (!heading.length && !config.directorySection) heading = index.blocks.filter(b => b.tag === 'h2' && text(b.raw) === sectionTitle);
  let appendSection = false;
  if (!matches.length && heading.length !== 1) {
    const title = [...index.content.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/g)].map(m => text(m[1]));
    const firstTable = index.blocks.find(b => b.tag === 'table');
    const headers = [...(firstTable?.raw ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m => text(m[1]));
    // Appending a new scope is opt-in; never infer an organization's directory policy.
    const knownRoot = config.directoryAppendSection === true && title.length === 1 && (!config.directoryTitle || title[0] === config.directoryTitle) && JSON.stringify(headers) === JSON.stringify(['需求', '报告', '当前结论']) && index.blocks.some(b => b.tag === 'h2') && !index.blocks.some(b => b.tag === 'h1');
    if (heading.length || config.directorySection || !knownRoot) fail('DIRECTORY_MAPPING_REQUIRED', 'Directory root does not match the verified report-section contract.');
    appendSection = true;
  }
  const argv = ['docs', '+update', '--doc', index.document_id, '--command', appendSection ? 'append' : matches.length ? 'block_replace' : 'block_insert_after', ...(!appendSection ? ['--block-id', matches[0]?.id ?? heading[0].id] : []), '--revision-id', String(index.revision_id), '--doc-format', 'xml', '--content', '-'];
  await save({ directory: { ...publication.directory, status: 'write_pending', writeUncertain: true, url, documentId: index.document_id, jobId: input.jobId, ...(appendSection ? { sectionTitle } : {}) } });
  const result = await call(argv, appendSection ? `<h2>${esc(sectionTitle)}</h2>${content}` : content);
  if (result.data?.result && result.data.result !== 'success' || result.data?.warnings?.length) fail('DIRECTORY_WRITE_PARTIAL', 'Directory write did not fully complete.');
  const readback = await fetchDoc(index.document_id);
  const entries = readback.blocks.filter(b => linkCount(b.raw));
  if (entries.length !== 1 || linkCount(entries[0].raw) !== 1 || compact(text(entries[0].raw)) !== compact(text(content))) fail('DIRECTORY_READBACK_MISMATCH', 'Directory link and summary were not verified.');
  if (appendSection) {
    const sections = readback.blocks.filter(b => b.tag === 'h2' && text(b.raw) === sectionTitle);
    const entryPosition = readback.blocks.findIndex(b => b.id === entries[0].id);
    if (sections.length !== 1 || readback.blocks[entryPosition - 1]?.id !== sections[0].id || regionHash(readback.blocks.slice(0, -2)) !== regionHash(index.blocks)) fail('DIRECTORY_READBACK_MISMATCH', 'The appended report section or preserved directory content was not verified.');
  }
  return { status: 'verified', url, documentId: index.document_id, revision: readback.revision_id, entryBlockId: entries[0].id, entryHash: hash(entries[0].raw), reportUrl: publication.url, deduplicated: !!matches.length, ...(appendSection ? { sectionTitle } : {}) };
}
