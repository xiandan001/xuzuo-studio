import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const filename = process.argv[2];
assert(filename && fs.existsSync(filename), 'The test run did not produce its result file');
const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedFiles = [];
function sourceTests(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) sourceTests(file);
    else if (item.isFile() && /\.test\.(js|ts|tsx)$/.test(item.name)) expectedFiles.push(path.relative(root, file).replaceAll('\\', '/'));
  }
}
sourceTests(path.join(root, 'src'));
const allowedSkips = new Set([
  'artifact-trash.test.ts:产物可恢复回收 不跟随单文件符号链接，外部目标和保留副本均不变',
  'artifact-trash.test.ts:产物可恢复回收 不跟随trash目录junction，正常产物保持原位置',
]);
const required = new Map([
  ['image-group-test-scope.test.js', 8], ['image-group-batch-native.test.js', 10],
  ['batch-production.test.js', 14], ['batch-poll-scope.test.js', 5],
  ['batch-submit-directory.test.js', 3], ['engine-empty-attachments-manifest.test.js', 1],
  ['asset-thumbnail-admission.test.js', 7], ['image-thumbnails.test.ts', 4],
  ['production-drain.test.js', 7], ['thumbnail-background-cache.test.js', 12],
  ['thumbnail-cache-prune.test.js', 3], ['thumbnail-first-display.test.js', 1],
  ['thumbnail-request-pipeline.test.js', 9],
]);
const results = report.testResults || [], critical = [], skipped = [], failures = [], observedFiles = new Set();
for (const suite of results) {
  observedFiles.add(path.relative(root, suite.name).replaceAll('\\', '/'));
  const name = suite.name.replaceAll('\\', '/').split('/').at(-1), tests = suite.assertionResults || [];
  if (required.has(name)) critical.push({ name, expected: required.get(name), actual: tests.length, passed: tests.filter(test => test.status === 'passed').length });
  for (const test of tests) if (!['passed', 'failed'].includes(test.status)) skipped.push({ file: name, name: test.fullName, status: test.status });
  for (const test of tests) if (test.status === 'failed') failures.push({ file: name, name: test.fullName, messages: test.failureMessages?.slice(0, 2).map(message => message.slice(0, 2000)) });
}
const counts = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
const unexpectedSkips = skipped.filter(test => !allowedSkips.has(test.file + ':' + test.name));
const missingFiles = expectedFiles.filter(file => !observedFiles.has(file));
fs.writeSync(1, JSON.stringify({ commit: process.env.GITHUB_SHA, counts, sourceFiles: expectedFiles.length, missingFiles, critical, skipped, unexpectedSkips, failures }, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Windows regression\n\nTotal ${counts.total}; passed ${counts.passed}; failed ${counts.failed}; skipped ${counts.skipped}.\n\nThis is Node/backend and build verification. Native UI and real provider-account acceptance are separate.\n`, 'utf8');
try {
  assert.equal(report.success, true, 'The full source test run did not succeed');
  assert.equal(report.numFailedTests, 0); assert(report.numTotalTests > 0);
  assert.equal(missingFiles.length, 0, 'Source test files are missing from the result');
  assert.equal(unexpectedSkips.length, 0, 'Unexpected skipped or unexecuted test cases');
  assert.equal(critical.length, required.size, 'A required test file was not executed');
  for (const item of critical) { assert.equal(item.actual, item.expected, item.name); assert.equal(item.passed, item.expected, item.name + ' contains failed or unexecuted cases'); }
} catch (error) {
  fs.writeSync(1, '\nCI verification failed: ' + error.message + '\n');
  process.exitCode = 1;
}
