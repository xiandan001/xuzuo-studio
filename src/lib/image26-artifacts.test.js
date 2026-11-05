import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="200" fill="blue"/></svg>');
const header = Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,255,0,0,0,0,255]);
const frame = Buffer.from([33,249,4,0,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0]);
const gif = Buffer.concat([header, frame, frame, Buffer.from([59])]);
it('SVG/GIF是实际受管图片，真实写入、预览、重开、另读均保持原始字节', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-image26-store-'));
  try {
    const store = createArtifactStore({ directory });
    const saved = [];
    for (const [name, mimeType, buffer] of [['logo.svg', 'image/svg+xml', svg], ['animation.gif', 'image/gif', gif]]) {
      const file = await store.write({ projectId: 'project', runId: 'run', name, mimeType, buffer }); saved.push({ file, buffer });
      expect(file.kind).toBe('image'); expect(file.name.endsWith(path.extname(name))).toBe(true);
      const preview = await store.preview(file.id); expect(preview.supported).toBe(true); expect(Buffer.from(preview.dataUrl.split(',')[1], 'base64')).toEqual(buffer);
    }
    await store.drain();
    const reopened = createArtifactStore({ directory });
    for (const { file, buffer } of saved) expect((await reopened.read(file.id)).buffer).toEqual(buffer);
    await expect(reopened.write({ projectId: 'project', name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>') })).rejects.toThrow();
    await reopened.drain();
  } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(directory).startsWith('xuzuo-image26-store-') || (await fs.lstat(directory)).isSymbolicLink()) throw Error('Unexpected owned test directory');
    await fs.rm(directory, { recursive: true, force: true });
  }
});
