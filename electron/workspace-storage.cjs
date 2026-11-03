const defaultFileSystem = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { key, inside, safeFolder, checkedDirectory, checkedFile, copyProjectTree, verifyProjectTree, atomicJson } = require('./workspace-paths.cjs');
const { inspectSelectedProjectFolder, prepareSelectedProjectFolder } = require('./project-folder.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const clone = value => structuredClone(value);
const empty = () => ({ version: 1, workspaces: [], projects: [], locations: [] });

function createWorkspaceStorage({ directory, fileSystem = defaultFileSystem }) {
  const fs = fileSystem, root = path.resolve(directory);
  const filename = path.join(root, 'workspace-directories-v1.json');
  const journalFile = path.join(root, 'workspace-directories-transition-v1.json');
  let state = empty(), transition, migrator, queue = Promise.resolve();
  const staged = [];
  const serial = action => { const task = queue.then(action); queue = task.catch(() => undefined); return task; };
  function validState(value) {
    if (!value || value.version !== 1 || !['workspaces', 'projects', 'locations'].every(name => Array.isArray(value[name]))) return false;
    if (value.workspaces.some(item => !validId(item.workspaceId) || typeof item.name !== 'string' || typeof item.directory !== 'string' || !path.isAbsolute(item.directory))) return false;
    if (new Set(value.workspaces.map(item => item.workspaceId)).size !== value.workspaces.length || new Set(value.projects.map(item => item.projectId)).size !== value.projects.length) return false;
    if (value.workspaces.some((item, index) => value.workspaces.slice(index + 1).some(other => inside(item.directory, other.directory) || inside(other.directory, item.directory)))) return false;
    if (value.projects.some(item => !validId(item.projectId) || !validId(item.workspaceId) || typeof item.name !== 'string' || typeof item.directory !== 'string' || !path.isAbsolute(item.directory) || !value.workspaces.some(workspace => workspace.workspaceId === item.workspaceId && inside(workspace.directory, item.directory) && key(workspace.directory) !== key(item.directory)))) return false;
    return value.locations.every(item => validId(item.projectId) && typeof item.directory === 'string' && path.isAbsolute(item.directory) && value.workspaces.some(workspace => inside(workspace.directory, item.directory) && key(workspace.directory) !== key(item.directory)));
  }
  function validTransition(value) {
    return value && value.version === 1 && validState(value.before) && validState(value.next) && Array.isArray(value.migrations) && new Set(value.migrations.map(item => item.projectId)).size === value.migrations.length && value.migrations.every(item => validId(item.projectId) && value.next.projects.some(project => project.projectId === item.projectId && project.directory === item.to) && (item.from === null || value.before.projects.some(project => project.projectId === item.projectId && project.directory === item.from)));
  }
  const ready = (async () => {
    await checkedDirectory(fs, root, true);
    try { await checkedFile(fs, filename); const value = JSON.parse(await fs.readFile(filename, 'utf8')); if (!validState(value)) throw new Error('invalid'); state = value; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('本地工作区目录登记无法读取，原记录已保留。'); }
    try { await checkedFile(fs, journalFile); const value = JSON.parse(await fs.readFile(journalFile, 'utf8')); if (!validTransition(value)) throw new Error('invalid'); transition = value; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('工作区迁移记录无法读取，现有目录均已保留。'); }
  })();
  async function marker(projectId, directoryName) {
    const control = path.join(directoryName, '.xuzuo', 'project-v1.json');
    await checkedFile(fs, control);
    const value = JSON.parse(await fs.readFile(control, 'utf8'));
    if (value.version !== 1 || value.projectId !== projectId) throw new Error('项目目录身份不匹配，未操作文件。');
  }
  async function checkedWorkspace(workspace) {
    await checkedDirectory(fs, workspace.directory);
    const filename = path.join(workspace.directory, '.xuzuo-workspace-v1.json');
    let value;
    try { await checkedFile(fs, filename); value = JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('工作区连接标记丢失，当前未改动原项目文件。请点击“检查并恢复工作区”恢复连接后重新读取。'), { code: 'WORKSPACE_MARKER_MISSING' });
      throw new Error('工作区连接标记无法读取，请保留原文件并检查目录权限或连接原工作区，未覆盖任何标记。');
    }
    if (!value || value.version !== 1 || value.workspaceId !== workspace.workspaceId) throw new Error('本地工作区目录身份不匹配，请连接原工作区。');
    return workspace.directory;
  }
  async function repairWorkspace(workspaceId) {
    const workspace = state.workspaces.find(item => item.workspaceId === workspaceId);
    if (!workspace) throw new Error('工作区尚未绑定本地文件夹，请先选择本地文件夹。');
    let missing = false;
    try { await checkedWorkspace(workspace); }
    catch (error) { if (error.code !== 'WORKSPACE_MARKER_MISSING') throw error; missing = true; }
    const projects = state.projects.filter(item => item.workspaceId === workspaceId);
    if (missing && !projects.length) throw new Error('工作区没有可核验的已登记项目，未自动创建连接标记。请保留原目录并连接原工作区。');
    for (const project of projects) {
      try { await checkedDirectory(fs, project.directory); await marker(project.projectId, project.directory); }
      catch { throw new Error('工作区中有项目目录或项目身份标记缺失、冲突或无法读取。请先连接原目录；未新建目录或覆盖原文件。'); }
    }
    if (!missing) return { ...clone(workspace), repaired: false };
    await checkedDirectory(fs, workspace.directory);
    const filename = path.join(workspace.directory, '.xuzuo-workspace-v1.json');
    try { await fs.writeFile(filename, `${JSON.stringify({ version: 1, workspaceId })}\n`, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw new Error('工作区连接标记未能保存，请检查目录权限后重试，原项目文件保持不变。');
      await checkedWorkspace(workspace);
      return { ...clone(workspace), repaired: false };
    }
    await checkedWorkspace(workspace);
    return { ...clone(workspace), repaired: true };
  }
  async function reconnectRoot({ workspaceId, directory: selected } = {}) {
    if (!validId(workspaceId)) throw new Error('工作区编号无效。');
    const workspace = state.workspaces.find(item => item.workspaceId === workspaceId);
    if (!workspace) throw new Error('工作区尚未绑定本地文件夹。');
    if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw new Error('请选择原工作区的本地绝对目录。');
    if (key(selected) !== key(workspace.directory)) throw new Error(`请选择此工作区原登记的文件夹：${workspace.directory}；需要新位置时请使用工作区搬迁。`);
    await checkedDirectory(fs, selected);
    let missingMarker = false;
    try { await checkedWorkspace(workspace); }
    catch (error) { if (error.code !== 'WORKSPACE_MARKER_MISSING') throw error; missingMarker = true; }
    const missingProjectIds = [];
    for (const project of state.projects.filter(item => item.workspaceId === workspaceId)) {
      try { await fs.lstat(project.directory); }
      catch (error) {
        if (error.code === 'ENOENT') { missingProjectIds.push(project.projectId); continue; }
        throw new Error('已存在的项目目录身份无法核验，请检查目录权限；原文件保持不变。');
      }
      try { await checkedDirectory(fs, project.directory); await marker(project.projectId, project.directory); }
      catch { throw new Error('已存在的项目目录或项目身份标记无法核验，未恢复工作区连接；原文件保持不变。'); }
    }
    if (!missingMarker) return { ...clone(workspace), repaired: false, missingProjectIds };
    await checkedDirectory(fs, workspace.directory);
    const filename = path.join(workspace.directory, '.xuzuo-workspace-v1.json');
    try { await fs.writeFile(filename, `${JSON.stringify({ version: 1, workspaceId })}\n`, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw new Error('工作区连接标记未能保存，请检查目录权限后重试，原项目文件保持不变。');
      await checkedWorkspace(workspace);
      return { ...clone(workspace), repaired: false, missingProjectIds };
    }
    await checkedWorkspace(workspace);
    return { ...clone(workspace), repaired: true, missingProjectIds };
  }
  async function workspaceDirectory(workspaceId) {
    const workspace = state.workspaces.find(item => item.workspaceId === workspaceId);
    if (!workspace) throw new Error('工作区尚未绑定本地文件夹。');
    return checkedWorkspace(workspace);
  }
  async function validateDirectory(directoryName, projectId) {
    await ready;
    const locations = [...state.locations, ...(transition?.next.locations || []), ...staged];
    const location = locations.find(item => key(item.directory) === key(directoryName) && (!projectId || item.projectId === projectId));
    if (!location) throw new Error('此目录尚未登记为项目目录，已拒绝读写。');
    const workspace = [...state.workspaces, ...(transition?.next.workspaces || [])].find(item => inside(item.directory, location.directory));
    if (!workspace) throw new Error('项目目录缺少所属工作区登记。');
    await checkedWorkspace(workspace);
    await checkedDirectory(fs, location.directory); await marker(location.projectId, location.directory);
    return location.directory;
  }
  async function finishTransition() {
    if (!transition) return;
    if (typeof migrator !== 'function') throw new Error('工作区文件迁移尚未就绪，请稍后重试。');
    for (const item of transition.migrations) await migrator(item.projectId, item.to, { rebase: Boolean(item.rebase) });
    await atomicJson(fs, filename, transition.next);
    state = transition.next;
    try { await fs.unlink(journalFile); transition = undefined; }
    catch { throw new Error('目录已保存，但迁移恢复记录尚未清理；请重新读取工作区。'); }
  }
  async function settle() { await ready; await finishTransition(); }
  async function createProjectLocation(input, workspace, old) {
    if (!validId(input.projectId) || !validId(input.workspaceId) || typeof input.name !== 'string' || !input.name.trim()) throw new Error('项目名称或编号无效。');
    await checkedWorkspace(workspace);
    let directoryName = old && old.workspaceId === input.workspaceId ? old.directory : path.join(workspace.directory, safeFolder(input.name, input.projectId));
    if (!old) {
      try { await fs.lstat(directoryName); directoryName += `-${randomUUID().slice(0, 8)}`; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!inside(workspace.directory, directoryName) || key(workspace.directory) === key(directoryName)) throw new Error('项目目录超出工作区。');
    if (old && old.workspaceId === input.workspaceId) await validateDirectory(directoryName, input.projectId);
    await checkedDirectory(fs, directoryName, true);
    for (const name of ['files', 'trash', '.xuzuo']) await checkedDirectory(fs, path.join(directoryName, name), true);
    const markerFile = path.join(directoryName, '.xuzuo', 'project-v1.json');
    try { await fs.writeFile(markerFile, `${JSON.stringify({ version: 1, projectId: input.projectId })}\n`, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await marker(input.projectId, directoryName); }
    const location = { projectId: input.projectId, workspaceId: input.workspaceId, name: input.name.trim(), directory: directoryName };
    staged.push({ projectId: location.projectId, directory: location.directory });
    return location;
  }
  async function commit(next, migrations) {
    const prepared = { version: 1, before: clone(state), next, migrations };
    if (!validTransition(prepared)) throw new Error('工作区迁移记录的目录身份无效。');
    try { await atomicJson(fs, journalFile, prepared); }
    catch { staged.length = 0; throw new Error('无法准备工作区迁移记录，原有登记和文件保持不变。'); }
    transition = prepared;
    try { await finishTransition(); }
    catch (error) { throw new Error(`工作区迁移尚未完成，原文件和恢复记录已保留；重新操作将继续迁移。${error.message}`); }
    finally { staged.length = 0; }
  }
  function addLocation(next, location) {
    next.projects = [...next.projects.filter(item => item.projectId !== location.projectId), location];
    if (!next.locations.some(item => item.projectId === location.projectId && key(item.directory) === key(location.directory))) next.locations.push({ projectId: location.projectId, directory: location.directory });
  }
  const publicList = () => clone({ workspaces: state.workspaces, projects: state.projects });
  async function inspectProjectFolder(input) {
    if (!input || !validId(input.workspaceId) || input.projectId !== undefined && !validId(input.projectId)) throw new Error('项目文件夹所属工作区或编号无效。');
    if (typeof input.directory !== 'string' || !path.isAbsolute(input.directory)) throw new Error('请选择有效的本地项目文件夹。');
    const workspace = state.workspaces.find(item => item.workspaceId === input.workspaceId);
    if (!workspace) throw new Error('请先为这个工作区选择本地文件夹。');
    await checkedWorkspace(workspace);
    const previous = input.projectId && state.projects.find(item => item.projectId === input.projectId);
    if (previous) {
      if (previous.workspaceId !== input.workspaceId || key(previous.directory) !== key(input.directory)) throw new Error('已有项目的位置不能在新建时更改，请使用项目移动或工作区搬迁。');
      await validateDirectory(previous.directory, previous.projectId);
      return { workspaceId: previous.workspaceId, directory: previous.directory, folderName: path.basename(previous.directory) };
    }
    return inspectSelectedProjectFolder({ fs, workspace, projects: state.projects, locations: state.locations, directory: input.directory, projectId: input.projectId });
  }
  return {
    setArtifactMigrator(value) { if (typeof value !== 'function') throw new TypeError('缺少产物迁移处理器。'); migrator = value; },
    validateDirectory,
    async validateWorkspace(workspaceId) { return serial(async () => { await settle(); return workspaceDirectory(workspaceId); }); },
    async repair({ workspaceId } = {}) { return serial(async () => { await settle(); if (!validId(workspaceId)) throw new Error('工作区编号无效。'); return repairWorkspace(workspaceId); }); },
    async reconnectRoot(input) { return serial(async () => { await settle(); return reconnectRoot(input); }); },
    async list() { return serial(async () => { await settle(); return publicList(); }); },
    async inspectProjectFolder(input) { return serial(async () => { await settle(); return inspectProjectFolder(input); }); },
    async claimProjectFolder(input) {
      return serial(async () => {
        await settle();
        if (!input || !validId(input.projectId) || typeof input.name !== 'string' || !input.name.trim()) throw new Error('项目名称或编号无效。');
        const selected = await inspectProjectFolder(input), previous = state.projects.find(item => item.projectId === input.projectId);
        if (previous) return clone(previous);
        await prepareSelectedProjectFolder(fs, selected.directory, input.projectId);
        const item = { projectId: input.projectId, workspaceId: input.workspaceId, name: input.name.trim(), directory: selected.directory };
        staged.push({ projectId: item.projectId, directory: item.directory });
        const next = clone(state); addLocation(next, item);
        await commit(next, [{ projectId: item.projectId, from: null, to: item.directory }]);
        return clone(item);
      });
    },
    async importLocations({ workspaces, projects }) {
      return serial(async () => {
        await settle();
        const next = clone(state);
        if (workspaces.some(item => state.workspaces.some(existing => existing.workspaceId === item.workspaceId && JSON.stringify(existing) !== JSON.stringify(item))) || projects.some(item => state.projects.some(existing => existing.projectId === item.projectId && JSON.stringify(existing) !== JSON.stringify(item)))) throw new Error('导入目录编号与现有登记不一致。');
        next.workspaces.push(...workspaces.filter(item => !state.workspaces.some(existing => existing.workspaceId === item.workspaceId)));
        next.projects.push(...projects.filter(item => !state.projects.some(existing => existing.projectId === item.projectId)));
        next.locations.push(...projects.filter(item => !state.locations.some(existing => existing.projectId === item.projectId && key(existing.directory) === key(item.directory))).map(({ projectId, directory }) => ({ projectId, directory })));
        if (!validState(next)) throw new Error('导入目录与现有工作区冲突，未覆盖任何登记。');
        for (const workspace of workspaces) await checkedWorkspace(workspace);
        for (const project of projects) { await checkedDirectory(fs, project.directory); await marker(project.projectId, project.directory); }
        await commit(next, projects.map(item => ({ projectId: item.projectId, from: null, to: item.directory, rebase: true })));
        return publicList();
      });
    },
    async relocate({ workspaceId, directory: selected, mode = 'reconnect' }) {
      return serial(async () => {
        await settle();
        if (!['reconnect', 'copy'].includes(mode)) throw new Error('工作区迁移方式无效。');
        const previous = state.workspaces.find(item => item.workspaceId === workspaceId);
        if (!previous) throw new Error('工作区尚未登记本地目录。');
        const target = await checkedDirectory(fs, selected);
        if (key(previous.directory) === key(target)) { await checkedWorkspace(previous); return publicList(); }
        if (state.workspaces.some(item => inside(item.directory, target) || inside(target, item.directory))) throw new Error('新位置不能与已登记工作区相同或互相嵌套。');
        const projects = state.projects.filter(item => item.workspaceId === workspaceId);
        const workspace = { ...previous, directory: target };
        if (mode === 'copy') {
          await checkedWorkspace(previous);
          const copyJournal = path.join(root, `workspace-copy-${workspaceId}-v1.json`);
          let resuming = false;
          try { await checkedFile(fs, copyJournal); const saved = JSON.parse(await fs.readFile(copyJournal, 'utf8')); resuming = saved.version === 1 && saved.workspaceId === workspaceId && key(saved.from) === key(previous.directory) && key(saved.to) === key(target) && ['copying', 'verified'].includes(saved.phase); }
          catch (error) { if (error.code !== 'ENOENT') throw new Error('搬迁恢复记录无法读取，现有副本均保留。'); }
          if (!resuming && (await fs.readdir(target)).length) throw new Error('主动搬迁请选择空文件夹，未覆盖目标文件。');
          await atomicJson(fs, copyJournal, { version: 1, workspaceId, from: previous.directory, to: target, phase: 'copying' });
          await copyProjectTree(fs, previous.directory, target);
          await verifyProjectTree(fs, previous.directory, target);
          await atomicJson(fs, copyJournal, { version: 1, workspaceId, from: previous.directory, to: target, phase: 'verified' });
        }
        await checkedWorkspace(workspace);
        const relocated = projects.map(item => ({ ...item, directory: path.join(target, path.relative(previous.directory, item.directory)) }));
        for (const project of relocated) { await checkedDirectory(fs, project.directory); await marker(project.projectId, project.directory); }
        const next = clone(state);
        next.workspaces = next.workspaces.map(item => item.workspaceId === workspaceId ? workspace : item);
        next.projects = next.projects.map(item => relocated.find(project => project.projectId === item.projectId) || item);
        next.locations = next.locations.filter(item => !inside(previous.directory, item.directory));
        for (const project of relocated) next.locations.push({ projectId: project.projectId, directory: project.directory });
        await commit(next, relocated.map(item => ({ projectId: item.projectId, from: projects.find(project => project.projectId === item.projectId).directory, to: item.directory, rebase: true })));
        if (mode === 'copy') await atomicJson(fs, path.join(root, `workspace-copy-${workspaceId}-v1.json`), { version: 1, workspaceId, from: previous.directory, to: target, phase: 'committed', sourceRetained: true });
        return publicList();
      });
    },
    async bindRoot({ workspaceId, name, directory: selected, projects = [] }) {
      return serial(async () => {
        await settle();
        if (!validId(workspaceId) || typeof name !== 'string' || !name.trim() || !Array.isArray(projects)) throw new Error('工作区名称或编号无效。');
        const directoryName = await checkedDirectory(fs, selected);
        if (state.workspaces.some(item => item.workspaceId !== workspaceId && (inside(item.directory, directoryName) || inside(directoryName, item.directory)))) throw new Error('工作区目录不能相同或互相嵌套，请选择独立文件夹。');
        const old = state.workspaces.find(item => item.workspaceId === workspaceId);
        if (old && key(old.directory) !== key(directoryName)) throw new Error('此工作区已绑定本地目录，请连接原目录；需要新位置时请新建工作区。');
        if (projects.some(item => item.workspaceId !== workspaceId || !validId(item.id)) || new Set(projects.map(item => item.id)).size !== projects.length) throw new Error('项目不属于要绑定的工作区，或包含重复项目。');
        const rootMarker = path.join(directoryName, '.xuzuo-workspace-v1.json');
        if (old) await workspaceDirectory(workspaceId);
        else {
          try { await fs.writeFile(rootMarker, `${JSON.stringify({ version: 1, workspaceId })}\n`, { encoding: 'utf8', flag: 'wx' }); }
          catch (error) {
            if (error.code !== 'EEXIST') throw error;
            await checkedFile(fs, rootMarker);
            const value = JSON.parse(await fs.readFile(rootMarker, 'utf8'));
            if (value.version !== 1 || value.workspaceId !== workspaceId) throw new Error('所选文件夹属于另一个工作区，请选择独立文件夹。');
          }
        }
        const location = { workspaceId, name: name.trim(), directory: directoryName };
        const next = clone(state); next.workspaces = [...next.workspaces.filter(item => item.workspaceId !== workspaceId), location];
        const migrations = [];
        for (const project of projects) {
          const previous = state.projects.find(item => item.projectId === project.id);
          if (previous && previous.workspaceId !== workspaceId) throw new Error('项目已经登记在另一个工作区，请使用移动项目。');
          const item = await createProjectLocation({ projectId: project.id, workspaceId, name: project.name }, location, previous);
          addLocation(next, item); migrations.push({ projectId: item.projectId, from: previous?.directory || null, to: item.directory });
        }
        await commit(next, migrations); return clone(location);
      });
    },
    async ensureProject(input) {
      return serial(async () => {
        await settle();
        const workspace = state.workspaces.find(item => item.workspaceId === input.workspaceId);
        if (!workspace) throw new Error('请先为这个工作区选择本地文件夹。');
        const previous = state.projects.find(item => item.projectId === input.projectId);
        if (previous && previous.workspaceId !== input.workspaceId) throw new Error('项目属于另一个工作区，请先移动项目。');
        const item = await createProjectLocation(input, workspace, previous);
        const next = clone(state); addLocation(next, item);
        await commit(next, [{ projectId: item.projectId, from: previous?.directory || null, to: item.directory }]);
        return clone(item);
      });
    },
    async projectDirectory(projectId) {
      return serial(async () => { await settle(); const item = state.projects.find(project => project.projectId === projectId); if (!item) throw new Error('项目尚未绑定本地目录，请先创建或绑定工作区。'); return validateDirectory(item.directory, projectId); });
    },
    async assertProject(projectId, workspaceId) {
      return serial(async () => {
        await settle(); const item = state.projects.find(project => project.projectId === projectId);
        if (!item || workspaceId && item.workspaceId !== workspaceId) throw new Error('项目的本地目录不属于当前工作区，请重新检查目录绑定。');
        await validateDirectory(item.directory, projectId);
        try {
          for (const area of ['.xuzuo', 'files']) {
            await checkedDirectory(fs, path.join(item.directory, area));
            const probe = path.join(item.directory, area, `.write-probe-${randomUUID()}`);
            await fs.writeFile(probe, '', { flag: 'wx' }); await fs.unlink(probe);
          }
        } catch { throw new Error('项目目录不可写，请连接原磁盘或检查文件夹权限后重试。'); }
        return clone(item);
      });
    },
    async moveProject(input) {
      return serial(async () => {
        await settle();
        const previous = state.projects.find(item => item.projectId === input.projectId);
        const workspace = state.workspaces.find(item => item.workspaceId === input.workspaceId);
        if (!previous || !workspace) throw new Error('请先为源项目和目标工作区绑定本地目录。');
        if (previous.workspaceId === input.workspaceId) return clone(previous);
        await validateDirectory(previous.directory, previous.projectId);
        const location = await createProjectLocation(input, workspace);
        await copyProjectTree(fs, previous.directory, location.directory);
        const next = clone(state); addLocation(next, location);
        await commit(next, [{ projectId: input.projectId, from: previous.directory, to: location.directory }]);
        return clone(location);
      });
    },
  };
}
module.exports = { createWorkspaceStorage };
