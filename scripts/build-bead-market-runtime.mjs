import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url), healthy = path.join(root, 'work/ui-build/node_modules/typescript'), ts = require(fs.existsSync(healthy) ? healthy : 'typescript');
const modules = ['bead-market', 'bead-market-validation', 'bead-market-pricing', 'bead-market-import', 'bead-procurement', 'bead-validation'];
const factories = modules.map(name => {
  const filename = path.join(root, 'src/lib/' + name + '.ts'), result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true }, reportDiagnostics: true });
  if (result.diagnostics?.length) throw Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  for (const match of result.outputText.matchAll(/require\((["'])([^"']+)\1\)/g)) if (!modules.some(value => match[2] === './' + value)) throw Error('Unexpected bead market dependency: ' + name + ' -> ' + match[2]);
  return JSON.stringify('./' + name) + ': function(module, exports, require) {\n' + result.outputText + '\n}';
});
const output = '// Generated from shared bead market helpers; run scripts/build-bead-market-runtime.mjs.\n\'use strict\';\nconst factories = {\n' + factories.join(',\n') + '\n};\nconst cache = Object.create(null);\nfunction load(id) {\n  if (!Object.hasOwn(factories, id)) throw Error(\'Unknown bead market runtime dependency\');\n  if (cache[id]) return cache[id].exports;\n  const module = cache[id] = { exports: {} }; factories[id](module, module.exports, load); return module.exports;\n}\nmodule.exports = load(\'./bead-market\');\n';
fs.writeFileSync(path.join(root, 'electron/bead-market.runtime.cjs'), output.replace(/\r\n?/g, '\n'), 'utf8');
