const fsDefault = require('node:fs/promises'), path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { checkedDirectory, checkedFile, atomicJson, inside } = require('./workspace-paths.cjs');
const { inspectOfficePreviewInput } = require('./office-preview-guard.cjs');
const { stripSavedTimestamp } = require('./saved-filename.cjs');

const executeFile = promisify(execFile), digest = value => createHash('sha256').update(value).digest('hex');
const downloadUrl = 'https://www.libreoffice.org/download/';
const types = { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);

function runRenderer(filename, args, { cwd, signal, timeout = 90000 }) {
  return new Promise((resolve, reject) => {
    let output = '', finished = false, timedOut = false;
    const child = spawn(filename, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => { if (child.exitCode === null && child.pid) { if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined); else child.kill('SIGKILL'); } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout); signal?.addEventListener('abort', stop, { once: true });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { if (output.length < 4096) output += bytes.toString('utf8').slice(0, 4096 - output.length); });
    const end = error => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); error ? reject(error) : resolve({ output }); };
    child.on('error', () => end(new Error('本地 Office 渲染器未能启动，请重新选择 LibreOffice。')));
    child.on('close', code => end(signal?.aborted ? new Error('已取消本次预览，原文件未改动。') : timedOut ? new Error('Office 转换超时，已停止本次私有预览任务，原文件未改动。') : code === 0 ? undefined : new Error('本地 Office 转换未完成，请检查文件与渲染器后重试。')));
    if (signal?.aborted) stop();
  });
}

function createOfficePreview({ directory, artifactStore, fileSystem = fsDefault, loadModule = require, rendererCandidates, execute = runRenderer, probeRenderer = executeFile, platform = process.platform }) {
  const fs = fileSystem, root = path.resolve(directory), active = new Map(), rendered = new Map();
  const config = path.join(root, 'renderer-v1.json'); let queue = Promise.resolve(), configured;
  const remember = result => { const { pdfBase64: _pdfBase64, ...metadata } = result; rendered.set(result.previewId, metadata); };
  const defaults = () => rendererCandidates || (platform === 'darwin'
    ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(os.homedir(), 'Applications/LibreOffice.app/Contents/MacOS/soffice')]
    : platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).flatMap(parent => [path.join(parent, 'LibreOffice/program/soffice.com'), path.join(parent, 'LibreOffice/program/soffice.exe')])
    : ['/usr/lib/libreoffice/program/soffice', '/usr/lib64/libreoffice/program/soffice']);
  async function inspectRenderer(selected) {
    if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw new Error('请选择已安装的 LibreOffice 渲染器。');
    const filename = platform === 'darwin' && /\.app$/i.test(selected) ? path.join(selected, 'Contents/MacOS/soffice') : selected;
    const validName = platform === 'win32' ? /^soffice\.(?:com|exe)$/i.test(path.basename(filename)) : path.basename(filename) === 'soffice';
    if (!validName) throw new Error(platform === 'win32' ? '请选择 LibreOffice 的 program/soffice.com 或 soffice.exe。' : platform === 'darwin' ? '请选择 LibreOffice.app 或其中的 Contents/MacOS/soffice。' : '请选择 LibreOffice 的 soffice 启动程序。');
    const stat = await checkedFile(fs, filename); if (!stat.size || stat.size > 20 * 1024 * 1024) throw new Error('LibreOffice 启动文件大小无效。');
    if (platform !== 'win32' && !(stat.mode & 0o111)) throw new Error('LibreOffice 启动文件没有执行权限，请重新安装 LibreOffice。');
    const result = await probeRenderer(filename, ['--headless', '--version'], { windowsHide: true, timeout: 10000, maxBuffer: 8192 });
    const version = (result.stdout || '').trim(); if (!/^LibreOffice\s+\d[\w. ]*/.test(version)) throw new Error('所选程序不是可识别的 LibreOffice。');
    return { name: 'LibreOffice', version: version.slice(0, 160), path: filename, sha256: digest(await fs.readFile(filename)) };
  }
  async function status() {
    if (!configured) { try { await checkedFile(fs, config); const value = JSON.parse(await fs.readFile(config, 'utf8')); if (value.version === 1 && typeof value.path === 'string') configured = value; } catch (error) { if (error.code !== 'ENOENT' && !/目录已不可用/.test(error.message)) return { available: false, reason: '渲染器配置无法读取，请重新选择。', downloadUrl }; } }
    for (const candidate of configured?.path ? [configured.path] : defaults()) {
      try { const renderer = await inspectRenderer(candidate); if (configured?.sha256 && configured.sha256 !== renderer.sha256) return { available: false, reason: '渲染器程序已变化，请重新选择后再使用。', downloadUrl }; return { available: true, renderer, downloadUrl }; } catch { /* Try another known local installation, without launching any visible Office UI. */ }
    }
    return { available: false, reason: '未检测到本地 LibreOffice。选择已安装的渲染器后，可预览真实 Office 文件的分页与图片。', downloadUrl };
  }
  async function configure(filename) { const renderer = await inspectRenderer(filename); await checkedDirectory(fs, root, true); await atomicJson(fs, config, { version: 1, path: renderer.path, sha256: renderer.sha256 }); configured = { version: 1, path: renderer.path, sha256: renderer.sha256 }; return { available: true, renderer, downloadUrl }; }
  async function cacheLocation(key) { const directory = path.join(root, 'cache'); await checkedDirectory(fs, directory, true); return { pdf: path.join(directory, key + '.pdf'), metadata: path.join(directory, key + '.json') }; }
  async function readCache(location, key, expected) {
    try { await checkedFile(fs, location.metadata); const meta = JSON.parse(await fs.readFile(location.metadata, 'utf8')); const stat = await checkedFile(fs, location.pdf); if (meta.version !== 1 || meta.previewId !== key || stat.size > 20 * 1024 * 1024 || stat.size !== meta.pdfBytes) return;
      if (expected && Object.entries(expected).some(([name, value]) => meta[name] !== value)) return;
      const pdf = await fs.readFile(location.pdf); if (digest(pdf) !== meta.pdfSha256 || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) return; return { ...meta, pdfBase64: pdf.toString('base64') };
    } catch (error) { if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error; }
  }
  async function removeJob(directory, nonce) {
    if (!inside(path.join(root, 'jobs'), directory) || path.dirname(directory) !== path.join(root, 'jobs')) throw new Error('预览临时目录越界，未清理。');
    await checkedDirectory(fs, directory); const owner = JSON.parse(await fs.readFile(path.join(directory, '.xuzuo-preview-job.json'), 'utf8')); if (owner.nonce !== nonce) throw new Error('临时目录身份不符，已保留。');
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  async function writePdf(filename, buffer) {
    try { await fs.lstat(filename); await checkedFile(fs, filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, buffer, { flag: 'wx' }); await fs.rename(temporary, filename); }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function prune(keep) {
    const directory = path.join(root, 'cache'), entries = [];
    for (const name of await fs.readdir(directory)) if (/^[a-f0-9]{64}\.pdf$/.test(name)) { const filename = path.join(directory, name), stat = await checkedFile(fs, filename); entries.push({ filename, size: stat.size, at: stat.mtimeMs, id: name.slice(0, -4) }); }
    entries.sort((a, b) => a.at - b.at); let total = entries.reduce((sum, item) => sum + item.size, 0), count = entries.length;
    for (const item of entries) if (item.id !== keep && (count > 12 || total > 80 * 1024 * 1024)) { await checkedFile(fs, item.filename); await fs.unlink(item.filename); const meta = item.filename.slice(0, -4) + '.json'; try { await checkedFile(fs, meta); await fs.unlink(meta); } catch (error) { if (error.code !== 'ENOENT') throw error; } rendered.delete(item.id); total -= item.size; count--; }
  }
  async function render(input) {
    if (!input || !validId(input.artifactId) || !validId(input.requestId) || input.refresh !== undefined && typeof input.refresh !== 'boolean') throw new Error('请选择已导出的 Office 文件。');
    if (active.has(input.requestId)) throw new Error('该预览请求已经在处理。');
    const controller = new AbortController(); active.set(input.requestId, controller);
    const task = queue.then(async () => {
      if (controller.signal.aborted) throw new Error('已取消本次预览。');
      const engine = await status(); if (!engine.available) throw new Error(engine.reason);
      const source = await artifactStore.read(input.artifactId), extension = types[source.mimeType];
      if (!extension || !source.projectId || source.buffer.length > 25 * 1024 * 1024) throw new Error('请选择本项目已导出的 DOCX/PPTX/XLSX，预览源文件最多 25 MB。');
      await inspectOfficePreviewInput(source, loadModule);
      const sourceSha256 = digest(source.buffer), previewId = digest(JSON.stringify([source.id, sourceSha256, engine.renderer.sha256, engine.renderer.version]));
      const location = await cacheLocation(previewId), previous = input.refresh ? undefined : await readCache(location, previewId, { artifactId: source.id, projectId: source.projectId, sourceSha256, renderer: engine.renderer.version });
      if (previous) { remember(previous); return previous; }
      const nonce = randomUUID(), job = path.join(root, 'jobs', nonce); await checkedDirectory(fs, job, true); await atomicJson(fs, path.join(job, '.xuzuo-preview-job.json'), { nonce });
      try {
        const profile = path.join(job, 'profile'); await checkedDirectory(fs, profile, true);
        const inputPath = path.join(job, 'input.' + extension), pdfPath = path.join(job, 'input.pdf'); await fs.writeFile(inputPath, source.buffer, { flag: 'wx' });
        await execute(engine.renderer.path, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--convert-to', 'pdf', '--outdir', job, inputPath], { cwd: job, signal: controller.signal });
        if (controller.signal.aborted) throw new Error('已取消本次预览。');
        const stat = await checkedFile(fs, pdfPath); if (stat.size > 20 * 1024 * 1024) throw new Error('预览 PDF 超过 20 MB，请减少配图或拆分文档。');
        const pdf = await fs.readFile(pdfPath); if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('渲染器未返回有效的 PDF，原 Office 文件未修改。');
        const metadata = { version: 1, previewId, artifactId: source.id, projectId: source.projectId, sourceSha256, sourceName: source.name, renderer: engine.renderer.version, generatedAt: new Date().toISOString(), pdfBytes: pdf.length, pdfSha256: digest(pdf) };
        await writePdf(location.pdf, pdf); await atomicJson(fs, location.metadata, metadata); await prune(previewId);
        const result = { ...metadata, pdfBase64: pdf.toString('base64') }; remember(result); return result;
      } finally { await removeJob(job, nonce); }
    });
    queue = task.catch(() => undefined); try { return await task; } finally { active.delete(input.requestId); }
  }
  return { status, configure, render, projectId: previewId => rendered.get(previewId)?.projectId, cancel(requestId) { active.get(requestId)?.abort(); }, async savePdf({ previewId } = {}) {
    const known = rendered.get(previewId); if (!known) throw new Error('请先预览当前文件，再保存 PDF。');
    const source = await artifactStore.read(known.artifactId); if (digest(source.buffer) !== known.sourceSha256) throw new Error('原文件已变化，请重新生成当前版本的预览。');
    const location = await cacheLocation(previewId), verified = await readCache(location, previewId, { artifactId: source.id, projectId: source.projectId, sourceSha256: known.sourceSha256, renderer: known.renderer }); if (!verified) throw new Error('预览缓存已失效，请重新生成。');
    const artifact = await artifactStore.write({ name: stripSavedTimestamp(source.name).replace(/\.(?:docx|pptx|xlsx)$/i, '') + '-预览.pdf', mimeType: 'application/pdf', buffer: Buffer.from(verified.pdfBase64, 'base64'), projectId: source.projectId, runId: source.runId }); return { artifact };
  }, async shutdown() { for (const controller of active.values()) controller.abort(); await queue; }, drain: () => queue };
}
module.exports = { createOfficePreview, runRenderer };
