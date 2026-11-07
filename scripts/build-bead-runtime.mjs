import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url);
const healthyTypeScript = path.join(root, 'work/ui-build/node_modules/typescript');
const ts = require(fs.existsSync(healthyTypeScript) ? healthyTypeScript : 'typescript');
const modules = ['bead-pattern', 'bead-validation', 'bead-quantize', 'bead-procurement', 'bead-palettes', '../data/bead-palettes'];
const idFor = name => name.startsWith('../') ? name : `./${name}`;
const factories = modules.map(name => {
  const filename = path.join(root, `src/lib/${name}.ts`);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true }, reportDiagnostics: true });
  if (compiled.diagnostics?.length) throw Error(ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  for (const match of compiled.outputText.matchAll(/require\((["'])([^"']+)\1\)/g)) if (!modules.some(dependency => match[2] === idFor(dependency))) throw Error(`Unexpected bead runtime dependency: ${name} -> ${match[2]}`);
  return `${JSON.stringify(idFor(name))}: function(module, exports, require) {\n${compiled.outputText}\n}`;
});
for (const entry of ['bead-pattern', 'bead-palettes']) {
  const source = `// Generated from src/lib/${entry}.ts and shared bead helpers; run scripts/build-bead-runtime.mjs.\n'use strict';\nconst factories = {\n${factories.join(',\n')}\n};\nconst cache = Object.create(null);\nfunction load(id) {\n  if (!Object.hasOwn(factories, id)) throw Error('Unknown bead runtime dependency');\n  if (cache[id]) return cache[id].exports;\n  const module = cache[id] = { exports: {} };\n  factories[id](module, module.exports, load);\n  return module.exports;\n}\nmodule.exports = load('./${entry}');\n`;
  fs.writeFileSync(path.join(root, `electron/${entry}.runtime.cjs`), source.replace(/\r\n?/g, '\n'), 'utf8');
}
