const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');

function createPerformanceControl({ directory, cpuTasks, metrics = () => [], fileSystem = fsDefault }) {
  const fs = fileSystem, filename = path.join(directory, 'performance-v1.json');
  let preferenceError = '', sampled = false, writes = Promise.resolve();
  const ready = (async () => {
    try {
      await checkedDirectory(fs, directory); await checkedFile(fs, filename);
      const stat = await fs.lstat(filename); if (stat.size > 4096) throw Error('性能偏好文件过大。');
      const value = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (value.version !== 1 || typeof value.lowResource !== 'boolean') throw Error('性能偏好格式无效。');
      cpuTasks.setLowResource(value.lowResource);
    } catch (error) { if (error.code !== 'ENOENT') preferenceError = '性能偏好尚未读取，当前使用标准模式；重新保存可修复此项偏好。'; }
  })();
  async function read() {
    await ready; await writes;
    let processes;
    try { processes = metrics(); } catch { processes = []; }
    const values = Array.isArray(processes) ? processes : [];
    const memoryKb = values.reduce((sum, row) => sum + (Number.isFinite(row?.memory?.workingSetSize) ? row.memory.workingSetSize : 0), 0);
    const cpu = values.reduce((sum, row) => sum + (Number.isFinite(row?.cpu?.percentCPUUsage) ? row.cpu.percentCPUUsage : 0), 0);
    const result = { ...cpuTasks.snapshot(), measuredAt: new Date().toISOString(), ...(memoryKb ? { memoryMb: Math.round(memoryKb / 1024) } : {}), ...(sampled && values.length ? { cpuPercent: Math.round(cpu * 10) / 10 } : {}), ...(preferenceError ? { preferenceError } : {}) };
    sampled = values.length > 0; return result;
  }
  function save(input) {
    if (!input || Object.keys(input).length !== 1 || typeof input.lowResource !== 'boolean') return Promise.reject(Error('请选择标准或低占用模式。'));
    const value = input.lowResource;
    const task = writes.then(async () => {
      await ready; await checkedDirectory(fs, directory);
      await atomicJson(fs, filename, { version: 1, lowResource: value });
      cpuTasks.setLowResource(value); preferenceError = '';
    });
    writes = task.catch(() => undefined);
    return task.then(read);
  }
  return { ready, read, save, flush: () => writes };
}
module.exports = { createPerformanceControl };
