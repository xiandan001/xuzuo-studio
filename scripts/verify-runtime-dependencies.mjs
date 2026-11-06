import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromBackend = createRequire(path.join(root, 'electron/image-output-formats.cjs'));
const names = ['saxes', 'xmlchars', 'pngjs', 'image-size', 'jszip', 'docx', 'exceljs', 'pptxgenjs'];
const resolved = Object.fromEntries(names.map(name => [name, fromBackend.resolve(name)]));
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="red" d="M0 0h16v16H0z"/></svg>');
assert.equal(fromBackend('./image-output-formats.cjs').imageType(svg).mimeType, 'image/svg+xml');
console.log(JSON.stringify({ backendDependenciesResolved: true, svgParserExecuted: true, resolved }));
