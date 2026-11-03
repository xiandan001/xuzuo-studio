import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'work/ui-build/node_modules/typescript'));
const modules = ['spreadsheet-engine', 'spreadsheet-generated', 'word-table', 'editor-generated', 'delivery-quality', 'spreadsheet-delivery'];
for (const name of modules) {
  const filename = path.join(root, `src/lib/${name}.ts`);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true }, reportDiagnostics: true });
  if (compiled.diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  const output = compiled.outputText.replace(/require\((["'])\.\/([^"']+)\1\)/g, (_match, quote, dependency) => {
    if (!modules.includes(dependency)) throw new Error(`Unexpected generated runtime dependency: ${name} -> ${dependency}`);
    return `require(${quote}./${dependency}.cjs${quote})`;
  }).replace(/\r\n?/g, '\n');
  fs.writeFileSync(path.join(root, `electron/${name}.cjs`), `// Generated from src/lib/${name}.ts; run scripts/build-spreadsheet-runtime.mjs.\n${output}`, 'utf8');
}
