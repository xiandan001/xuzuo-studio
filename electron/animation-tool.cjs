const fsDefault = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { resolveMacSystemPath } = require('./macos-system-paths.cjs');

const cancelled = () => Object.assign(Error('动画处理已取消，原稿和已发生的费用保留。'), { name: 'AbortError' });
function cleanEnvironment(source = process.env) {
  const result = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'SystemDrive', 'ComSpec', 'COMSPEC', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ']) if (source[key]) result[key] = source[key];
  return { ...result, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' };
}
function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } return Promise.resolve(); }
  return new Promise(resolve => {
    const killer = spawn(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore', env: cleanEnvironment() });
    const done = () => { clearTimeout(timer); if (child.exitCode === null) child.kill(); resolve(); };
    const timer = setTimeout(() => { killer.kill(); done(); }, 5000);
    killer.once('error', done); killer.once('close', done);
  });
}

function createAnimationTool({ executablePath, directory, developmentPython = process.platform === 'win32' ? 'python' : 'python3', packaged = Boolean(process.resourcesPath && !process.defaultApp), timeoutMs = 120000, spawnProcess = spawn, terminateProcess = stopProcessTree, fileSystem = fsDefault } = {}) {
  const fs = fileSystem, source = path.resolve(__dirname, '../tools/gif-factory/main.py');
  let tail = Promise.resolve(), active, closed = false, quiescing = false, cachedStatus, probing;
  const stops = new Set();
  const blocked = () => closed || quiescing;
  async function inspectComponents(filename, kind) {
    const root = path.parse(filename).root; let current = root;
    for (const part of filename.slice(root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part); const info = await fs.lstat(current);
      if (info.isSymbolicLink() || (current === filename ? kind === 'file' ? !info.isFile() : !info.isDirectory() : !info.isDirectory())) throw Error('动画素材或工作目录不是常规本机文件。');
    }
  }
  async function ordinary(filename, kind = 'file') {
    const resolved = await resolveMacSystemPath(fs, filename); await inspectComponents(resolved, kind);
    const canonical = await fs.realpath(resolved);
    if (canonical.toLowerCase() === resolved.toLowerCase()) return fs.stat(resolved);
    const originalRoot = path.parse(resolved).root, canonicalRoot = path.parse(canonical).root;
    const originalParts = resolved.slice(originalRoot.length).split(path.sep), canonicalParts = canonical.slice(canonicalRoot.length).split(path.sep);
    const shortName = /^(?=.{1,8}(?:\.|$))[^\\/. ]{1,6}~[1-9]\d{0,5}(?:\.[^\\/. ]{1,3})?$/i;
    if (process.platform !== 'win32' || originalRoot.toLowerCase() !== canonicalRoot.toLowerCase() || originalParts.length !== canonicalParts.length || originalParts.some((part, index) => part.toLowerCase() !== canonicalParts[index].toLowerCase() && !shortName.test(part))) throw Error('动画素材或工作目录发生了重定向。');
    const before = await fs.stat(resolved, { bigint: true }); await inspectComponents(canonical, kind);
    const target = await fs.stat(canonical, { bigint: true }), after = await fs.stat(resolved, { bigint: true });
    if (before.dev !== target.dev || before.ino !== target.ino || after.dev !== target.dev || after.ino !== target.ino || (await fs.realpath(resolved)).toLowerCase() !== canonical.toLowerCase()) throw Error('动画素材或工作目录身份发生了改变。');
    return fs.stat(resolved);
  }
  async function command() {
    const bundled = executablePath || path.join(process.resourcesPath || path.resolve(__dirname, '..'), 'animation-tool', process.platform === 'win32' ? 'xuzuo-animation.exe' : 'xuzuo-animation');
    try { await ordinary(bundled); return { file: bundled, prefix: [] }; } catch (error) { if (executablePath || packaged) throw Error('动画后台工具尚未就绪，请使用包含动画运行时的完整桌面版本。'); }
    await ordinary(source);
    if (typeof developmentPython !== 'string' || !developmentPython || /[\r\n\0]/.test(developmentPython)) throw Error('开发环境Python路径无效。');
    return { file: developmentPython, prefix: [source] };
  }
  function execute(commandValue, args, input, { signal, deadline = timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      if (blocked() || signal?.aborted) { reject(cancelled()); return; }
      const child = spawnProcess(commandValue.file, [...commandValue.prefix, ...args], { cwd: directory || (commandValue.prefix.length ? path.dirname(source) : path.dirname(commandValue.file)), windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnvironment() });
      let failure, settled = false, stopping = false, bytes = 0; const stdout = [], stderr = [];
      const terminate = error => { if (settled || stopping) return; failure = error; stopping = true; const task = Promise.resolve().then(() => terminateProcess(child)); stops.add(task); void task.finally(() => stops.delete(task)).catch(() => undefined); };
      const abort = () => terminate(cancelled());
      active = { child, abort };
      try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* The owned worker also restricts its own priority and affinity. */ }
      const timer = setTimeout(() => terminate(Error('动画后台处理超时，请缩小尺寸或分批处理；原稿仍保留。')), Math.max(50, Math.min(300000, deadline)));
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (active?.child === child) active = undefined; error ? reject(error) : resolve(result); };
      child.once('error', () => finish(Error('动画后台工具无法启动，请检查完整运行时是否安装。')));
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { terminate(Error('动画返回数据过大，请分批制作。')); return; } stdout.push(Buffer.from(chunk)); });
      child.stderr.on('data', chunk => { if (stderr.reduce((sum, value) => sum + value.length, 0) < 16384) stderr.push(Buffer.from(chunk).subarray(0, 16384)); });
      child.stdin.on('error', () => undefined);
      child.once('close', code => {
        if (failure) { finish(failure); return; }
        let value; try { value = JSON.parse(Buffer.concat(stdout).toString('utf8')); } catch { finish(Error('动画后台未返回完整结果；原稿未被覆盖。')); return; }
        if (code !== 0 || value.error) { finish(Error(typeof value.error === 'string' ? value.error.slice(0, 1000) : '动画后台处理失败；请检查素材和参数。')); return; }
        finish(undefined, value);
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted || blocked()) abort();
      child.stdin.end(input || '');
    });
  }
  async function status() {
    if (blocked()) return { available: false, reason: '动画后台正在停止。' };
    if (cachedStatus) return cachedStatus;
    if (probing) return probing;
    probing = (async () => { try { const selected = await command(), value = await execute(selected, ['status'], undefined, { deadline: 5000 }); if (value.available !== true || value.protocol !== 1 || value.offline !== true) throw Error('动画后台协议不匹配。'); cachedStatus = { available: true }; return cachedStatus; } catch (error) { return { available: false, reason: error.message }; } finally { probing = undefined; } })();
    return probing;
  }
  async function resultFile(output, value, extension, expectedSize) {
    if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) throw Error('动画后台返回了无效文件路径。');
    const filename = path.resolve(output, value), relative = path.relative(output, filename);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) || path.extname(filename).toLowerCase() !== extension) throw Error('动画产物超出了专属输出目录。');
    const info = await ordinary(filename);
    if (info.size <= 0 || info.size > (extension === '.zip' ? 100 : 64) * 1024 * 1024) throw Error('动画产物为空或超出单文件体积限制。');
    const handle = await fs.open(filename, 'r'), magic = Buffer.alloc(24);
    try { await handle.read(magic, 0, 24, 0); } finally { await handle.close(); }
    if (extension === '.png' && !magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || extension === '.gif' && !['GIF87a', 'GIF89a'].includes(magic.subarray(0, 6).toString()) || extension === '.zip' && magic.readUInt32LE(0) !== 0x04034b50) throw Error('动画产物格式与扩展名不一致。');
    const dimensions = extension === '.png' ? [magic.readUInt32BE(16), magic.readUInt32BE(20)] : extension === '.gif' ? [magic.readUInt16LE(6), magic.readUInt16LE(8)] : undefined;
    if (dimensions && (!dimensions.every(number => number > 0) || dimensions[0] * dimensions[1] > 16000000 || expectedSize && dimensions.some((number, index) => number !== expectedSize[index]))) throw Error('动画产物实际尺寸与检查报告不一致。');
    return filename;
  }
  async function validateResult(result, manifest, output) {
    if (!result || !Array.isArray(result.outputs) || result.outputs.length !== manifest.entries.length) throw Error('动画后台返回的条目数量不完整。');
    const outputs = [], seen = new Set();
    for (const item of result.outputs) {
      if (!manifest.entries.some(entry => entry.id === item.entryId) || seen.has(item.entryId)) throw Error('动画后台返回了未知或重复条目。');
      seen.add(item.entryId); const report = item.report;
      if (!report || !Number.isInteger(report.width) || !Number.isInteger(report.height) || report.width <= 0 || report.height <= 0 || report.width * report.height > 16000000 || !Number.isInteger(report.frames) || report.frames < 1 || report.frames > 120 || !Number.isInteger(report.loopMs) || report.loopMs < 0 || report.loopMs > 30000 || report.loop !== 0 || typeof report.transparent !== 'boolean' || !Array.isArray(report.warnings) || report.warnings.length > 100 || report.warnings.some(warning => typeof warning !== 'string' || warning.length > 1000) || !Array.isArray(item.framePaths) || item.framePaths.length !== report.frames) throw Error('动画后台返回的实际媒体检查无效。');
      if (report.durationsMs !== undefined && (!Array.isArray(report.durationsMs) || report.durationsMs.length !== report.frames || report.durationsMs.some(duration => !Number.isInteger(duration) || duration <= 0 || duration % 10) || manifest.mode === 'gif' && report.durationsMs.reduce((sum, duration) => sum + duration, 0) !== report.loopMs)) throw Error('动画后台返回的逐帧时长不完整。');
      if (manifest.mode === 'gif' && (report.frames < 2 || report.width !== manifest.width || report.height !== manifest.height || report.width * report.height * report.frames > 48000000 || report.loopMs <= 0 || !item.gifPath) || manifest.mode === 'atlas' && item.gifPath) throw Error('动画后台结果与制作模式不一致。');
      const frames = []; for (const filename of item.framePaths) frames.push(await resultFile(output, filename, '.png', manifest.mode === 'gif' ? [report.width, report.height] : undefined));
      if (new Set(frames).size !== frames.length) throw Error('动画实际帧文件不能重复。');
      outputs.push({ entryId: item.entryId, coverPath: await resultFile(output, item.coverPath, '.png', [report.width, report.height]), framePaths: frames, ...(item.gifPath ? { gifPath: await resultFile(output, item.gifPath, '.gif', [report.width, report.height]) } : {}), report });
    }
    if (manifest.exportFrames && !result.archivePath || !manifest.exportFrames && result.archivePath) throw Error('帧包输出与导出选项不一致。');
    return { outputs, ...(result.archivePath ? { archivePath: await resultFile(output, result.archivePath, '.zip') } : {}) };
  }
  const api = {
    status,
    run(manifest, outputDirectory, { signal } = {}) {
      if (blocked()) return Promise.reject(cancelled());
      const task = tail.then(async () => {
        if (blocked() || signal?.aborted) throw cancelled();
        const only = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
        if (!only(manifest, ['version', 'mode', 'style', 'title', 'width', 'height', 'fps', 'loopMs', 'background', 'fontPath', 'atlases', 'entries', 'exportFrames']) || !Array.isArray(manifest.entries) || !Array.isArray(manifest.atlases) || manifest.atlases.some(value => !only(value, ['id', 'path'])) || manifest.entries.some(value => !only(value, ['id', 'caption', 'motion', 'frames']) || !Array.isArray(value.frames) || value.frames.some(frame => !only(frame, ['atlasId', 'cell', 'grid', 'crop', 'durationMs']))) || typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory)) throw Error('动画参数或输出位置无效；仅接受白名单制作参数。');
        const input = JSON.stringify(manifest); if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw Error('动画参数过大，请分批制作。');
        const available = await status(); if (!available.available) throw Error(available.reason);
        const output = path.resolve(outputDirectory); await ordinary(output, 'directory'); if ((await fs.readdir(output)).length) throw Error('动画输出目录须为空，原稿与已有文件不会被覆盖。');
        for (const atlas of manifest.atlases || []) { if (typeof atlas.path !== 'string' || !path.isAbsolute(atlas.path)) throw Error('源图路径无效。'); await ordinary(atlas.path); }
        const selected = await command(), result = await execute(selected, ['render', '--output', output], input, { signal });
        if (signal?.aborted || blocked()) throw cancelled();
        return validateResult(result, manifest, output);
      });
      tail = task.catch(() => undefined); return task;
    },
    async drain() { while (true) { const current = tail; await Promise.allSettled([current, probing, ...stops]); if (current === tail && !stops.size && !probing) break; } },
    async prepareClose() { quiescing = true; active?.abort(); try { await api.drain(); } finally { quiescing = false; } },
    async shutdown() { closed = true; await api.prepareClose(); },
  };
  return api;
}
module.exports = { createAnimationTool, cleanEnvironment };
