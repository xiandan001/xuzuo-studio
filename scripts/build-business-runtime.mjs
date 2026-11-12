import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url);
const healthy = path.join(root, 'work/ui-build/node_modules/typescript');
const ts = require(fs.existsSync(healthy) ? healthy : 'typescript');
const modules = ['business-data', 'business-validation', 'business-economics', 'business-import', 'cost-display', 'cost-allocations'];
const factories = modules.map(name => {
  const filename = path.join(root, 'src/lib/' + name + '.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true }, reportDiagnostics: true });
  if (output.diagnostics?.length) throw Error(ts.formatDiagnosticsWithColorAndContext(output.diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  for (const match of output.outputText.matchAll(/require\((["'])([^"']+)\1\)/g)) if (!modules.some(item => match[2] === './' + item)) throw Error('Unexpected business runtime dependency: ' + name + ' -> ' + match[2]);
  return JSON.stringify('./' + name) + ': function(module, exports, require) {\n' + output.outputText + '\n}';
});
const output = "// Generated from shared business data helpers; run scripts/build-business-runtime.mjs.\n'use strict';\nconst factories = {\n" + factories.join(',\n') + "\n};\nconst cache = Object.create(null);\nfunction load(id) {\n  if (!Object.hasOwn(factories, id)) throw Error('Unknown business runtime dependency');\n  if (cache[id]) return cache[id].exports;\n  const module = cache[id] = { exports: {} }; factories[id](module, module.exports, load); return module.exports;\n}\nmodule.exports = load('./business-data');\n";
fs.writeFileSync(path.join(root, 'electron/business-data.runtime.cjs'), output.replace(/\r\n?/g, '\n'), 'utf8');
