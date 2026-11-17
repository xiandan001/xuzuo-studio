const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const MAX_FILE = 16 * 1024 * 1024, MAX_BATCH = 16 * 1024 * 1024, MAX_CACHE = 4 * 1024 * 1024, MAX_TEXT = 200000;
const supported = mime => mime?.startsWith('text/') || ['application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime);
function cancelled(signal) { if (signal.aborted) throw Object.assign(Error('正文搜索已取消。'), { name: 'AbortError' }); }
function documentText(value) {
  const text = typeof value === 'string' ? value : value?.text;
  if (typeof text !== 'string') return '';
  if (!value?.documentSource || text.length > 4 * 1024 * 1024) return text.slice(0, MAX_TEXT);
  let source; try { source = JSON.parse(text); } catch { return text.slice(0, MAX_TEXT); }
  const pieces = [], containers = new Set(['blocks', 'slides', 'sheets', 'cells', 'rows', 'children', 'table', 'content']), fields = new Set(['title', 'name', 'text', 'body', 'notes', 'value', 'formula', 'caption', 'alt']);
  let count = 0, length = 0;
  function visit(item, inCells = false) {
    if (++count > 40000 || length >= MAX_TEXT || item === null || item === undefined) return;
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    if (typeof item !== 'object') { if (inCells && ['string', 'number'].includes(typeof item)) { const part = String(item).slice(0, MAX_TEXT - length); pieces.push(part); length += part.length; } return; }
    if (inCells) { for (const child of Object.values(item)) visit(child, typeof child !== 'object'); return; }
    for (const [key, child] of Object.entries(item)) {
      if (fields.has(key) && ['string', 'number'].includes(typeof child)) { const part = String(child).slice(0, MAX_TEXT - length); pieces.push(part); length += part.length; }
      else if (containers.has(key)) visit(child, key === 'cells' && !Array.isArray(child));
      if (length >= MAX_TEXT || count > 40000) break;
    }
  }
  visit(source); return pieces.join('\n').slice(0, MAX_TEXT);
}
function checkedRequest(input) {
  if (!input || !validId(input.requestId) || !validId(input.workspaceId) || typeof input.query !== 'string' || input.query.length > 120 || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 30)) throw Error('正文搜索条件无效。');
  let cursor;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 600) throw Error('正文检索位置无效。');
    try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')); } catch { throw Error('正文检索位置无效。'); }
    if (!cursor || !validId(cursor.projectId) || cursor.artifactId !== '' && !validId(cursor.artifactId) || Object.keys(cursor).length !== 2) throw Error('正文检索位置无效。');
  }
  return { ...input, query: normalize(input.query), limit: input.limit || 6, cursor };
}
function createContentSearch({ directory, listProjects, listArtifacts, readArtifact, documentSourceForArtifact, extractText, fileSystem = fs } = {}) {
  if (!path.isAbsolute(directory || '') || [listProjects, listArtifacts, readArtifact].some(value => typeof value !== 'function')) throw TypeError('正文搜索缺少受管文件接口。');
  const root = path.join(directory, 'content-search-v1'), caches = new Map(), requests = new Map();
  let tail = Promise.resolve(), closing = false;
  async function cacheFor(workspaceId) {
    if (caches.has(workspaceId)) { const cache = caches.get(workspaceId); caches.delete(workspaceId); caches.set(workspaceId, cache); return cache; }
    let value;
    try {
      const filename = path.join(root, workspaceId + '.json'), stat = await checkedFile(fileSystem, filename);
      if (stat.size <= MAX_CACHE) value = JSON.parse(await fileSystem.readFile(filename, 'utf8'));
    } catch { /* Derived indexes can be rebuilt from managed originals. */ }
    const entries = value?.version === 1 && value.workspaceId === workspaceId && Array.isArray(value.entries) ? value.entries.filter(item => item && validId(item.id) && validId(item.projectId) && /^[a-f0-9]{64}$/.test(item.identity || '') && /^[a-f0-9]{64}$/.test(item.sourceSha256 || '') && typeof item.text === 'string' && item.text.length <= MAX_TEXT && item.textSha256 === digest(item.text) && (item.partial === undefined || typeof item.partial === 'boolean') && (item.sourceRevision === undefined || Number.isSafeInteger(item.sourceRevision) && item.sourceRevision > 0)).slice(-128) : [];
    const cache = { version: 1, workspaceId, entries }; caches.set(workspaceId, cache);
    while (caches.size > 4) caches.delete(caches.keys().next().value);
    return cache;
  }
  async function saveCache(cache) {
    const sizes = cache.entries.map(item => Buffer.byteLength(JSON.stringify(item, null, 2)) + 64);
    let bytes = sizes.reduce((sum, size) => sum + size, 1024), offset = 0;
    while (cache.entries.length - offset > 128 || bytes > MAX_CACHE) bytes -= sizes[offset++];
    if (offset) cache.entries = cache.entries.slice(offset);
    try { await checkedDirectory(fileSystem, root, true); await atomicJson(fileSystem, path.join(root, cache.workspaceId + '.json'), { version: cache.version, workspaceId: cache.workspaceId, entries: cache.entries }); delete cache.unsaved; return true; } catch { cache.unsaved = true; return false; }
  }
  async function identity(artifact) {
    if (!artifact.path || !path.isAbsolute(artifact.path)) throw Error('文件未登记实际路径。');
    const stat = await checkedFile(fileSystem, artifact.path);
    if (stat.size !== artifact.bytes || stat.size > MAX_FILE) throw Error('文件已变化或超过单次正文索引上限。');
    return digest(JSON.stringify([artifact.id, artifact.projectId, artifact.mimeType, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]));
  }
  async function inspect(artifact, before, signal) {
    cancelled(signal);
    const file = await readArtifact(artifact.id);
    cancelled(signal);
    if (!file || file.id !== artifact.id || file.projectId !== artifact.projectId || file.mimeType !== artifact.mimeType || !(file.buffer instanceof Uint8Array) || file.buffer.length !== artifact.bytes) throw Error('正文来源与所选文件不一致。');
    const sourceSha256 = digest(file.buffer);
    const structured = documentSourceForArtifact ? await documentSourceForArtifact(artifact) : undefined;
    cancelled(signal);
    const value = structured?.text ? structured : extractText ? await extractText(file, { signal }) : file.mimeType.startsWith('text/') || file.mimeType === 'application/json' ? new TextDecoder('utf-8', { fatal: true }).decode(file.buffer) : '';
    cancelled(signal);
    if (await identity(artifact) !== before) throw Error('索引时文件发生变化，请重新查找。');
    const extracted = documentText(value), text = normalize(extracted), rawText = typeof value === 'string' ? value : value?.text || '';
    return { id: artifact.id, projectId: artifact.projectId, identity: before, sourceSha256, textSha256: digest(text), ...(extracted.length >= MAX_TEXT && rawText.length > MAX_TEXT ? { partial: true } : {}), ...(Number.isSafeInteger(structured?.sourceRevision) && structured.sourceRevision > 0 ? { sourceRevision: structured.sourceRevision } : {}), text };
  }
  async function run(input, signal) {
    const output = { items: [], scanned: 0, indexed: 0, cached: 0, skipped: 0 };
    if (!input.query) return output;
    cancelled(signal);
    const projects = (await listProjects(input.workspaceId)).filter(item => item && validId(item.id) && item.workspaceId === input.workspaceId && !item.trashedAt && !item.purgedAt).sort((a, b) => a.id.localeCompare(b.id));
    cancelled(signal);
    const cache = await cacheFor(input.workspaceId), tokens = input.query.split(' '); let bytes = 0, last, visited = 0;
    for (const project of projects) {
      if (input.cursor && project.id.localeCompare(input.cursor.projectId) < 0) continue;
      cancelled(signal);
      if (visited++ >= 12) { if (last) output.nextCursor = Buffer.from(JSON.stringify(last)).toString('base64url'); if ((output.indexed || cache.unsaved) && !await saveCache(cache)) output.cacheUnavailable = true; return output; }
      const artifacts = (await listArtifacts({ workspaceId: input.workspaceId, projectId: project.id })).filter(item => item?.projectId === project.id && validId(item.id) && supported(item.mimeType) && !item.trashedAt).sort((a, b) => a.id.localeCompare(b.id));
      if (!artifacts.length) last = { projectId: project.id, artifactId: '' };
      for (const artifact of artifacts) {
        if (input.cursor?.projectId === project.id && artifact.id.localeCompare(input.cursor.artifactId) <= 0) continue;
        cancelled(signal);
        if (output.scanned >= 12 || output.items.length >= input.limit || output.indexed && bytes + artifact.bytes > MAX_BATCH) {
          if (last) output.nextCursor = Buffer.from(JSON.stringify(last)).toString('base64url');
          if ((output.indexed || cache.unsaved) && !await saveCache(cache)) output.cacheUnavailable = true; return output;
        }
        last = { projectId: project.id, artifactId: artifact.id }; output.scanned++;
        try {
          if (artifact.unavailable || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.bytes > MAX_FILE) throw Error('文件不可用或过大。');
          const key = await identity(artifact); cancelled(signal);
          let entry = cache.entries.find(item => item.id === artifact.id && item.projectId === project.id && item.identity === key);
          if (entry) output.cached++;
          else { entry = await inspect(artifact, key, signal); bytes += artifact.bytes; output.indexed++; cache.entries = [...cache.entries.filter(item => item.id !== artifact.id), entry]; }
          if (entry.partial) output.skipped++;
          if (tokens.every(token => entry.text.includes(token))) {
            const at = Math.max(0, entry.text.indexOf(tokens[0]));
            output.items.push({ id: artifact.id, projectId: project.id, projectName: typeof project.name === 'string' ? project.name : project.id, artifact: structuredClone(artifact), snippet: entry.text.slice(Math.max(0, at - 35), at + 145), sourceSha256: entry.sourceSha256, ...(entry.sourceRevision ? { sourceRevision: entry.sourceRevision } : {}) });
          }
        } catch (error) { if (signal.aborted || error.name === 'AbortError') throw error; output.skipped++; }
      }
    }
    cancelled(signal); if ((output.indexed || cache.unsaved) && !await saveCache(cache)) output.cacheUnavailable = true; return output;
  }
  function search(raw) {
    if (closing) return Promise.reject(Error('应用正在退出，正文搜索未开始。'));
    const input = checkedRequest(raw), key = input.workspaceId + '/' + input.requestId;
    if (requests.has(key)) return requests.get(key).task;
    const controller = new AbortController(), task = tail.catch(() => undefined).then(() => run(input, controller.signal));
    requests.set(key, { controller, task }); tail = task.catch(() => undefined);
    void task.finally(() => requests.delete(key)).catch(() => undefined); return task;
  }
  function cancel(input) {
    if (!input || !validId(input.workspaceId) || !validId(input.requestId)) throw Error('正文搜索取消范围无效。');
    const request = requests.get(input.workspaceId + '/' + input.requestId); request?.controller.abort(); return { cancelled: !!request };
  }
  return { search, cancel, async shutdown() { closing = true; for (const request of requests.values()) request.controller.abort(); await Promise.allSettled([...requests.values()].map(request => request.task)); }, resume() { closing = false; } };
}
module.exports = { createContentSearch, documentText, checkedRequest };
