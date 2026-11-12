import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), buildOnly = process.argv.includes('--build-only'), localRuntime = buildOnly || process.argv.includes('--local-runtime');
const load = createRequire(path.join(root, localRuntime ? 'work/ui-build/package.json' : 'package.json'));
const output = path.join(root, 'work/chat-studio-output'), hash = value => createHash('sha256').update(value).digest('hex');
const report = { passed: false, commit: process.env.GITHUB_SHA, scope: 'Actual WorkspaceChat React, production CSS and preload, real persistent chat service and provider adapter; deterministic in-memory SSE only', actualProviderUsed: false, normalApplicationStarted: false, userProfileAccessed: false, errors: [] };
let dist, temporary, watchdog, child;
const exists = async file => { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
function stop(pid) { if (Number.isInteger(pid) && alive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); }
async function inventory(directory, base = directory, result = {}) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink()); const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inventory(file, base, result);
    else { const bytes = await fs.readFile(file); assert(bytes.length < 16 * 1024 * 1024); result[path.relative(base, file).replaceAll('\\', '/')] = hash(bytes); }
  }
  assert(Object.keys(result).length <= 100); return result;
}
async function build() {
  const vite = await import(pathToFileURL(load.resolve('vite')).href), react = (await import(pathToFileURL(load.resolve('@vitejs/plugin-react')).href)).default;
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  await vite.build({ configFile: false, root: path.join(root, 'scripts/fixtures'), base: './', plugins: [react(), { name: 'chat-qa-csp', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head' }] }], resolve: localRuntime ? { alias: ['react', 'react-dom', 'lucide-react'].map(name => ({ find: name, replacement: path.join(root, 'work/ui-build/node_modules', name) })) } : undefined, build: { outDir: dist, emptyOutDir: false, sourcemap: false, rollupOptions: { input: path.join(root, 'scripts/fixtures/chat-studio.html') } } });
}
async function main() {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Runner priority can be restricted. */ }
  if (buildOnly) { dist = await fs.mkdtemp(path.join(root, 'work/chat-studio-build-check-')); await build(); console.log(JSON.stringify({ built: true, dist, applicationStarted: false, providerCalls: 0 })); return; }
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(report.commit || '', /^[a-f0-9]{40}$/);
  assert.equal((await fs.realpath(root)).toLowerCase(), (await fs.realpath(process.env.GITHUB_WORKSPACE)).toLowerCase());
  assert(!await exists(output), 'Previous chat evidence must be retained'); dist = path.join(root, 'work/chat-studio-dist'); assert(!await exists(dist)); await fs.mkdir(output, { recursive: true });
  const temporaryRoot = await fs.realpath(process.env.RUNNER_TEMP); temporary = await fs.mkdtemp(path.join(temporaryRoot, 'xuzuo-chat-studio-')); const nonce = randomUUID();
  watchdog = setTimeout(() => { if (child?.pid) stop(child.pid); process.stderr.write('Chat UI wrapper exceeded its bounded deadline\n'); process.exit(1); }, 140000);
  await build(); const files = await inventory(dist), sources = {};
  const sourceNames = ['scripts/verify-chat-studio.mjs', 'scripts/verify-chat-studio-native.cjs', 'scripts/fixtures/chat-studio.html', 'scripts/fixtures/chat-studio.tsx', 'src/components/WorkspaceChat.tsx', 'src/components/workspace-chat.css', 'src/components/ChatReplyText.tsx', 'src/components/ChatPlanProduction.tsx', 'src/components/ConversationModelPicker.tsx', 'src/components/conversation-model-picker.css', 'src/components/HomePlanCard.tsx', 'src/components/home-plan-card.css', 'src/components/home-automation-chat.css', 'src/components/creation-journey.css', 'src/hooks/useWorkspaceChat.ts', 'src/lib/reasoning-options.ts', 'src/chat-types.ts', 'src/styles.css', 'src/theme.css', 'src/appearance-palettes.css', 'src/surface-depth.css', 'src/next-interface.css', 'src/pages/conversation-home.css', 'electron/preload.cjs', 'electron/chat-service.cjs', 'electron/provider-chat.cjs', 'electron/reasoning-options.cjs'];
  sourceNames.push('src/components/ChatAttachments.tsx', 'src/components/chat-attachments.css', 'src/hooks/useChatAttachments.ts', 'src/components/ChatScenarioPicker.tsx', 'src/components/chat-scenario-picker.css', 'src/lib/chat-scenarios.ts', 'electron/chat-attachments.cjs', 'electron/chat-message-content.cjs', 'electron/reference-text.cjs', 'electron/cpu-tasks.cjs', 'electron/cpu-worker.cjs');
  sourceNames.push('scripts/fixtures/chat-cpu-worker.cjs');
  sourceNames.push('src/lib/chat-reference-selection.ts');
  sourceNames.push('scripts/fixtures/chat-studio-production.cjs', 'scripts/fixtures/chat-studio-new-features.cjs', 'src/components/ChatHistorySidebar.tsx', 'src/components/chat-history-sidebar.css', 'src/components/ChatResourcePicker.tsx', 'src/components/chat-resource-picker.css', 'src/components/StreamingChatReply.tsx', 'src/lib/chat-text-blocks.ts', 'src/lib/chat-stream-state.ts', 'src/hooks/useChatRefinement.ts', 'src/lib/artifact-refinement.ts', 'src/lib/live-start.ts', 'src/components/HomeProductionResult.tsx', 'src/components/home-production-result.css', 'src/components/ProjectTemplateActions.tsx', 'src/components/project-template.css', 'src/components/CustomerOrderLink.tsx', 'src/components/customer-order-link.css', 'src/components/CostAllocationDialog.tsx', 'src/components/cost-allocation.css', 'src/lib/cost-allocations.ts', 'src/lib/business-economics.ts', 'src/components/ClientProofingDialog.tsx', 'src/components/client-proofing.css', 'src/components/VisualVersionComparison.tsx', 'src/components/visual-version-comparison.css', 'src/components/VersionTimeline.tsx', 'src/proofing-types.ts', 'src/project-template-types.ts', 'electron/chat-history.cjs', 'electron/chat-backup.cjs', 'electron/project-templates.cjs', 'electron/project-template-backup.cjs', 'electron/customer-proofing.cjs', 'electron/proofing-preview.cjs', 'electron/proofing-client.cjs', 'electron/proofing-validation.cjs', 'electron/proofing-record.cjs', 'electron/proofing-backup.cjs', 'electron/business-links.cjs', 'electron/business-data.cjs', 'electron/business-store.cjs', 'electron/business-backup.cjs', 'electron/project-backup.cjs', 'electron/creation-service-adapters.cjs', 'electron/artifact-refinement-target.cjs', 'src/lib/live-polling.ts');
  sourceNames.push('electron/live-workflow-engine.cjs', 'electron/live-validation.cjs', 'electron/live-start.cjs', 'src/configuration-types.ts', 'src/business-types.ts', 'src/hooks/useLiveWorkflowRunner.ts', 'src/lib/live-start-source.ts', 'electron/main.cjs');
  sourceNames.push('src/lib/project-template-image.ts', 'src/components/ProjectCard.tsx', 'src/pages/Projects.tsx', 'src/pages/Finance.tsx', 'src/lib/business-data.ts', 'src/lib/business-validation.ts', 'electron/business-data.runtime.cjs', 'electron/backup-format.cjs', 'src/types.ts');
  for (const name of sourceNames) sources[name] = hash(await fs.readFile(path.join(root, name)));
  const dependencyRoot = path.join(root, ...(localRuntime ? ['work', 'ui-build'] : []), 'node_modules');
  assert.equal((await fs.realpath(dependencyRoot)).toLowerCase(), dependencyRoot.toLowerCase(), 'Native dependency root must be an ordinary expected directory');
  const owner = { kind: 'xuzuo-chat-studio', nonce, commit: report.commit, parentPid: process.pid, temporaryRoot, temporary, output, dist, files, sources, dependencyRoot, localRuntime };
  await fs.mkdir(path.join(temporary, 'profile')); await fs.writeFile(path.join(temporary, 'owner.json'), JSON.stringify(owner) + '\n', { flag: 'wx' });
  const { isolatedEnvironment } = load(path.join(root, 'scripts/verify-bead-native.cjs')), env = isolatedEnvironment(temporary, { directory: localRuntime ? path.join(root, 'work/ui-build') : root }); Object.assign(env, { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: report.commit, GITHUB_WORKSPACE: root, RUNNER_TEMP: temporaryRoot });
  assert(!Object.keys(env).some(key => /TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE/.test(key)));
  child = spawn(load('electron'), [path.join(root, 'scripts/verify-chat-studio-native.cjs'), temporary, `--user-data-dir=${path.join(temporary, 'profile')}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', expired = false, timer; child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString()).slice(-16384); }); child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-16384); });
  const code = await Promise.race([new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), new Promise(resolve => { timer = setTimeout(() => { expired = true; stop(child.pid); resolve(null); }, 130000); })]); clearTimeout(timer);
  report.child = { pid: child.pid, code, expired, stdout, stderr }; report.native = JSON.parse(await fs.readFile(path.join(temporary, 'native-report.json'), 'utf8')); const native = report.native;
  assert.equal(native.nonce, nonce); assert.equal(native.commit, report.commit); const pids = [...new Set([child.pid, ...native.processIds])].filter(pid => Number.isInteger(pid) && pid !== process.pid);
  for (let index = 0; index < 30 && pids.some(alive); index++) await new Promise(resolve => setTimeout(resolve, 100)); report.residualPids = pids.filter(alive);
  assert(!expired && code === 0 && native.passed, native.errors?.join('\n')); assert.equal(report.residualPids.length, 0); assert.equal(native.externalRequests, 0); assert.equal(native.actualAccountCharges, 0);
  for (const key of ['noProjectChat', 'reasoningBodyVerified', 'multiTurnContextVerified', 'partialStreamDisplayed', 'stopAndRetryPreserveCosts', 'planValidatedBeforeDisplay', 'deferredProjectSelection', 'historyReloadKeepsLedger']) assert.equal(native[key], true, key);
  assert.equal(native.originalSyntheticPostCount, 6); assert.equal(native.attachmentSyntheticPostCount, 3); assert.equal(native.fakePostCount, 9);
  for (const key of ['scenarioChoiceIsLocal', 'localImportUsesRealFiles', 'previewReadsRealBytes', 'removeDoesNotSend', 'attachmentOnlySend', 'imageBytesReachProvider', 'officeReadUsesWorker', 'chatToPlanKeepsImage', 'officeAndTextReachProvider', 'historyReloadKeepsReferences']) assert.equal(native.attachmentChecks[key], true, key);
  for (const key of ['historyManagement', 'localResourceImports', 'directToolWithoutChat', 'boundRefinement', 'refinementFeesSeparate']) assert.equal(native.productivityChecks[key], true, key);
  assert.equal(native.refinementSyntheticPostCount, 1);
  assert(native.attachmentWorkers.length > 0 && native.attachmentWorkers.every(task => task.exited && task.dependencyBootstrapVerified));
  assert.equal(native.layouts.length, 4); assert(native.layouts.every(value => value.passed)); assert.equal(native.screenshots.length, 4); report.sources = sources; report.fixtureFiles = files; report.passed = true;
}
main().catch(error => { report.errors.push(String(error.stack || error)); process.exitCode = 1; }).finally(async () => { clearTimeout(watchdog); if (!buildOnly && await exists(output) && !await exists(path.join(output, 'report.json'))) await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); if (!buildOnly) console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), errors: report.errors })); });
