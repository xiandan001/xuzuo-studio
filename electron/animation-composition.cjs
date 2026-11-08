const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function createAnimationComposition({ directory, artifactStore, tool, core, fileSystem = fsDefault }) {
  const fs = fileSystem, root = path.resolve(directory, 'animation-temp-v1');
  async function readOutput(filename, temporary, maximum = 32 * 1024 * 1024) {
    const resolved = path.resolve(temporary, filename), base = temporary.toLowerCase() + path.sep;
    if (!resolved.toLowerCase().startsWith(base)) throw Error('动画工具返回了工作目录以外的文件。');
    const stat = await checkedFile(fs, resolved); if (stat.size > maximum || stat.size < 1 || !(await fs.realpath(resolved)).toLowerCase().startsWith(base)) throw Error('动画输出为空、过大或位置已改变。');
    return fs.readFile(resolved);
  }
  async function run(document, entries, signal, operation, exportFrames = false) {
    await checkedDirectory(fs, root, true); const ownedRoot = await fs.realpath(root), temporary = await fs.mkdtemp(path.join(ownedRoot, 'render-'));
    const active = () => { if (signal?.aborted) throw Object.assign(Error('本地合成已取消，源稿和费用保留。'), { name: 'AbortError' }); };
    try {
      active(); const atlases = [], sources = []; let sourceBytes = 0, sourcePixels = 0;
      for (const id of new Set(entries.flatMap(entry => entry.frames.map(frame => frame.atlasArtifactId)))) {
        const file = await artifactStore.read(id); if (file.projectId !== document.projectId || file.trashedAt || file.unavailable || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) || file.buffer.length > 32 * 1024 * 1024) throw Error('有角色图集不可用，请重新选择或恢复对应源图。');
        sourceBytes += file.buffer.length; const size = rasterDimensions(file.buffer); if (sourceBytes > 128 * 1024 * 1024) throw Error('本次源图总量超过128MB，请缩小原图或分批处理，源稿仍保留。');
        for (const frame of entries.flatMap(entry => entry.frames).filter(frame => frame.atlasArtifactId === id)) { const box = frame.crop || [Math.floor(frame.cell[0] * size.width / frame.grid[0]), Math.floor(frame.cell[1] * size.height / frame.grid[1]), Math.floor((frame.cell[0] + 1) * size.width / frame.grid[0]), Math.floor((frame.cell[1] + 1) * size.height / frame.grid[1])]; if (box[0] < 0 || box[1] < 0 || box[2] > size.width || box[3] > size.height || box[2] <= box[0] || box[3] <= box[1]) throw Error('源关键帧裁切超出实际原图，请恢复完整画面或调整裁切后继续。'); sourcePixels += (box[2] - box[0]) * (box[3] - box[1]); }
        if (typeof fs.statfs === 'function') { const space = await fs.statfs(temporary), style = core.animationStyle(document.style), frames = document.mode === 'atlas' ? 1 : style.route === 'keyframes' ? Math.max(...entries.map(entry => entry.frames.length)) : Math.ceil(document.loopMs * document.fps / 1000), outputPixels = document.mode === 'atlas' ? sourcePixels : document.width * document.height * frames * entries.length; if (Number(space.bavail) * Number(space.bsize) < file.buffer.length + outputPixels * 9 + 32 * 1024 * 1024) throw Error('本地临时空间不足，请释放空间或降低GIF尺寸、帧数后本地继续；原图和已发生费用保留。'); }
        const extension = file.mimeType === 'image/png' ? '.png' : file.mimeType === 'image/jpeg' ? '.jpg' : '.webp', filename = path.join(temporary, id + extension);
        active(); await fs.writeFile(filename, file.buffer, { flag: 'wx' }); atlases.push({ id, path: filename }); sources.push({ artifactId: id, sha256: hash(file.buffer) });
      }
      if (!atlases.length || entries.some(entry => !entry.frames.length)) throw Error('请先生成角色图集或补齐当前条目的源帧。');
      const outputDirectory = path.join(temporary, 'output');
      await fs.mkdir(outputDirectory);
      const manifest = { version: 1, mode: document.mode, style: document.style, title: document.title, width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background, ...(exportFrames ? { exportFrames: true } : {}), atlases, entries: entries.map(entry => ({ id: entry.id, caption: entry.caption, motion: entry.motion, frames: entry.frames.map(frame => ({ atlasId: frame.atlasArtifactId, cell: frame.cell, grid: frame.grid, ...(frame.crop ? { crop: frame.crop } : {}), durationMs: frame.durationMs })) })) };
      const result = await tool.run(manifest, outputDirectory, { signal }); active();
      if (!Array.isArray(result.outputs) || result.outputs.length !== entries.length || new Set(result.outputs.map(row => row.entryId)).size !== entries.length || result.outputs.some(row => !entries.some(entry => entry.id === row.entryId))) throw Error('动画合成的条目数量或归属不一致。');
      return await operation({ result, temporary, outputDirectory, sources, active });
    } finally {
      const actual = await fs.realpath(temporary).catch(() => undefined);
      if (actual && path.dirname(actual).toLowerCase() === ownedRoot.toLowerCase() && /^render-[A-Za-z0-9]+$/.test(path.basename(actual))) await fs.rm(actual, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return {
    async render(document, entries, { signal, runId: parentRunId } = {}) {
      return run(document, entries, signal, async ({ result, outputDirectory, sources, active }) => {
        const outputs = [], groups = [];
        for (const output of result.outputs) {
          active(); const runId = parentRunId || randomUUID(), entry = entries.find(row => row.id === output.entryId), artifacts = [];
          const cover = await readOutput(output.coverPath, outputDirectory); if (imageType(cover).mimeType !== 'image/png') throw Error('动画封面不是有效PNG。');
          let main;
          if (document.mode === 'gif') {
            if (!output.gifPath) throw Error('本地合成没有返回GIF成品。'); const bytes = await readOutput(output.gifPath, outputDirectory), info = imageType(bytes);
            if (info.mimeType !== 'image/gif' || info.width !== document.width || info.height !== document.height || output.report.frames !== info.frames || output.report.loop !== 0 || output.report.loopMs < 1) throw Error('实际GIF与合成报告不一致，未登记成品。');
            main = await artifactStore.write({ name: `${entry.caption || document.title}-${entry.id}.gif`, mimeType: 'image/gif', buffer: bytes, projectId: document.projectId, runId, signal }); artifacts.push(main);
          }
          const thumbnail = await artifactStore.write({ name: `${entry.caption || document.title}-${entry.id}-封面.png`, mimeType: 'image/png', buffer: cover, projectId: document.projectId, runId, signal }); artifacts.push(thumbnail); main ||= thumbnail;
          outputs.push({ entryId: entry.id, outputArtifactId: main.id, coverArtifactId: thumbnail.id, renderedHash: core.animationRenderHash(document, [entry.id]), report: output.report });
          groups.push({ runId, artifacts, sources: sources.filter(source => entry.frames.some(frame => frame.atlasArtifactId === source.artifactId)), entryIds: [entry.id], mode: document.mode, renderHash: core.animationRenderHash(document, [entry.id]) });
        }
        return { outputs, groups };
      });
    },
    async frameReference(document, entry, frame, { signal } = {}) {
      const source = { ...document, mode: 'atlas', entries: [{ ...entry, caption: '', frames: [frame] }] };
      return run(source, source.entries, signal, async ({ result, outputDirectory, active }) => { active(); const output = result.outputs[0], bytes = await readOutput(output.framePaths[0] || output.coverPath, outputDirectory); if (imageType(bytes).mimeType !== 'image/png') throw Error('选中帧无法转换为PNG参考。'); return artifactStore.write({ name: `${document.title}-选中源帧.png`, mimeType: 'image/png', buffer: bytes, projectId: document.projectId, signal }); });
    },
    async exportFrames(document, entries, { signal } = {}) {
      return run(document, entries, signal, async ({ result, outputDirectory, active }) => {
        active(); if (!result.archivePath) throw Error('后台工具未返回实际帧压缩包。'); const buffer = await readOutput(result.archivePath, outputDirectory, 100 * 1024 * 1024);
        if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw Error('后台返回的拆分素材包不是ZIP。');
        return artifactStore.write({ name: `${document.title}-拆分PNG.zip`, mimeType: 'application/zip', buffer, projectId: document.projectId, signal });
      }, true);
    },
  };
}
module.exports = { createAnimationComposition };
