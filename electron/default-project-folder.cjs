const path = require('node:path');
const { createHash } = require('node:crypto');
const { safeFolder, key, checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { prepareSelectedProjectFolder } = require('./project-folder.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), birthtimeMs: String(stat.birthtimeMs) });
const sameIdentity = (left, right) => ['dev', 'ino', 'birthtimeMs'].every(field => left?.[field] === right[field]);
const fail = message => Object.assign(Error(message), { code: 'PROJECT_CREATION_RECOVERY_REQUIRED' });
function defaultDirectoryKey(filename, platform = process.platform) {
  const resolved = path.resolve(filename);
  return platform === 'win32' ? resolved.toLowerCase().split(path.sep).map(part => part.replace(/[. ]+$/g, '')).join(path.sep) : resolved;
}

async function prepareDefaultProjectFolder({ fs, controlDirectory, workspace, input, inspectFolder, assertPathAvailable, isLocationAvailable }) {
  const folder = path.join(controlDirectory, 'default-project-creations-v1'), filename = path.join(folder, input.projectId + '.json');
  await checkedDirectory(fs, folder, true); let intent;
  try {
    const stat = await checkedFile(fs, filename); if (stat.size > 16384) throw fail('作品创建记录过大，原文件保持不变。');
    const envelope = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (envelope.version !== 1 || envelope.sha256 !== hash(envelope.intent)) throw fail('作品创建记录无法核验，原目录与登记保留。');
    intent = envelope.intent;
    if (!intent || intent.type !== 'workspace-default-project' || intent.version !== 1 || intent.projectId !== input.projectId || intent.workspaceId !== input.workspaceId || intent.name !== input.name || key(intent.workspaceDirectory) !== key(workspace.directory) || typeof intent.directory !== 'string' || key(path.dirname(intent.directory)) !== key(workspace.directory) || !['allocated', 'created', 'prepared'].includes(intent.phase) || intent.phase !== 'allocated' && !['dev', 'ino', 'birthtimeMs'].every(field => typeof intent.identity?.[field] === 'string')) throw fail('这次新建请求的名称、工作区或保存位置已变化，请先恢复原创建结果或重新发起新建。');
  } catch (error) { if (error.code !== 'ENOENT') throw error.code === 'PROJECT_CREATION_RECOVERY_REQUIRED' ? error : fail('作品创建记录暂不可读取，原目录与登记均未覆盖。'); }
  const persist = async () => {
    const envelope = { version: 1, sha256: hash(intent), intent };
    if (Buffer.byteLength(JSON.stringify(envelope, null, 2) + '\n') > 16384) throw fail('作品保存位置记录过长，请使用较短的工作区路径。');
    await atomicJson(fs, filename, envelope);
  };
  if (!intent) {
    // Reuse the existing Windows-safe name sanitizer, without its ID suffix.
    let stem = safeFolder(input.name, input.projectId).replace(/-[a-f0-9]{12}$/, '').replace(/[.\s]+$/g, '').trim() || '项目'; let chosen;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '项目-' + stem;
    for (let index = 0; index < 128; index++) {
      const candidate = path.join(workspace.directory, stem + (index ? ' (' + (index + 1) + ')' : '')); assertPathAvailable(candidate);
      if (!isLocationAvailable(candidate)) continue;
      try { await fs.lstat(candidate); }
      catch (error) { if (error.code !== 'ENOENT') throw error; chosen = candidate; break; }
    }
    if (!chosen) throw fail('同名作品文件夹较多，请换一个作品名称后再创建。');
    intent = { type: 'workspace-default-project', version: 1, projectId: input.projectId, workspaceId: input.workspaceId, name: input.name, workspaceDirectory: workspace.directory, directory: chosen, phase: 'allocated' };
    await persist();
  }
  assertPathAvailable(intent.directory);
  if (!isLocationAvailable(intent.directory)) throw fail('原分配位置已有项目或历史位置登记，未重建或接管该目录。');
  if (intent.phase === 'allocated') {
    try { await fs.mkdir(intent.directory); }
    catch (error) { if (error.code === 'EEXIST') throw fail('原分配位置已存在，但创建身份尚未确认。没有接管或另建文件夹，请保留该位置后重新选择保存位置。'); throw error; }
    await checkedDirectory(fs, intent.directory); intent.identity = identity(await fs.lstat(intent.directory)); intent.phase = 'created'; await persist();
  }
  await checkedDirectory(fs, intent.directory);
  if (!sameIdentity(intent.identity, identity(await fs.lstat(intent.directory)))) throw fail('已准备的作品文件夹已被替换，未接管新目录或重建原位置。');
  await inspectFolder({ ...input, directory: intent.directory });
  await prepareSelectedProjectFolder(fs, intent.directory, input.projectId);
  if (intent.phase !== 'prepared') { intent.phase = 'prepared'; await persist(); }
  return { projectId: input.projectId, workspaceId: input.workspaceId, name: input.name, directory: intent.directory };
}
async function removeDefaultProjectIntent({ fs, controlDirectory, projectId, workspaceId }) {
  const folder = path.join(controlDirectory, 'default-project-creations-v1'), filename = path.join(folder, projectId + '.json');
  try { await fs.lstat(folder); await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await checkedDirectory(fs, folder); const before = await checkedFile(fs, filename); if (before.size > 16384) throw fail('作品创建记录过大，尚未清理该自有记录。');
  const envelope = JSON.parse(await fs.readFile(filename, 'utf8')), intent = envelope.intent;
  if (envelope.version !== 1 || envelope.sha256 !== hash(intent) || intent?.type !== 'workspace-default-project' || intent.projectId !== projectId || intent.workspaceId !== workspaceId) throw fail('作品创建记录的归属无法核验，尚未清理该记录。');
  const after = await checkedFile(fs, filename); if (!['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(field => before[field] === after[field])) throw fail('作品创建记录清理前发生变化，原记录保留。');
  await fs.unlink(filename);
}
module.exports = { prepareDefaultProjectFolder, removeDefaultProjectIntent, defaultDirectoryKey };
