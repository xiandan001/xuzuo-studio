import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'work/ui-build/node_modules/typescript'));
const modules = ['spreadsheet-engine', 'spreadsheet-generated-formatting', 'spreadsheet-generated', 'word-table', 'editor-generated', 'delivery-quality', 'spreadsheet-delivery'];
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

const naturalModules = ['natural-automation-plan', 'automation-recipes', 'creation-quality', 'creation-profiles', 'document-illustrations', 'studio-run', 'prompt-variables'];
const factories = naturalModules.map(name => {
  const filename = path.join(root, `src/lib/${name}.ts`);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true }, reportDiagnostics: true });
  if (compiled.diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  for (const match of compiled.outputText.matchAll(/require\((["'])([^"']+)\1\)/g)) if (!naturalModules.some(dependency => match[2] === `./${dependency}`)) throw new Error(`Unexpected natural automation runtime dependency: ${name} -> ${match[2]}`);
  return `${JSON.stringify(`./${name}`)}: function(module, exports, require) {\n${compiled.outputText}\n}`;
});
const naturalRuntime = `// Generated from src/lib/natural-automation-plan.ts and its shared helpers; run scripts/build-spreadsheet-runtime.mjs.\n'use strict';\nconst factories = {\n${factories.join(',\n')}\n};\nconst cache = Object.create(null);\nfunction load(id) {\n  if (!Object.hasOwn(factories, id)) throw new Error('Unknown natural automation dependency');\n  if (cache[id]) return cache[id].exports;\n  const module = cache[id] = { exports: {} };\n  factories[id](module, module.exports, load);\n  return module.exports;\n}\nmodule.exports = load('./natural-automation-plan');\n`;
fs.writeFileSync(path.join(root, 'electron/natural-automation-plan.runtime.cjs'), naturalRuntime.replace(/\r\n?/g, '\n'), 'utf8');
