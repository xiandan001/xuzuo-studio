import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), buildOnly = process.argv.includes('--build-only'), localRuntime = buildOnly || process.argv.includes('--local-runtime');
const runtime = localRuntime && !existsSync(path.join(root, 'node_modules/vite/package.json')) ? path.join(root, 'work/ui-build') : root;
const load = createRequire(path.join(runtime, 'package.json'));
const output = path.join(root, 'work/chat-studio-output'), hash = value => createHash('sha256').update(value).digest('hex');
const report = { passed: false, commit: process.env.GITHUB_SHA, scope: 'Actual Overview and WorkspaceChat React, production shell/CSS and preload, real persistent chat service and provider adapter; deterministic in-memory SSE only', dependencyMode: runtime === root ? 'locked-root' : 'owned-local-build-runtime', actualProviderUsed: false, normalApplicationStarted: false, userProfileAccessed: false, errors: [] };
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
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  await vite.build({ configFile: false, root: path.join(root, 'scripts/fixtures'), base: './', plugins: [react(), { name: 'chat-qa-csp', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head' }] }], resolve: localRuntime ? { alias: ['react', 'react-dom', 'lucide-react', 'markdown-it', '@mdit/plugin-cjk-friendly', 'pdfjs-dist'].map(name => ({ find: name, replacement: path.join(runtime, 'node_modules', name) })) } : undefined, build: { outDir: dist, emptyOutDir: false, sourcemap: false, rollupOptions: { input: path.join(root, 'scripts/fixtures/chat-studio.html') } } });
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
  sourceNames.push('src/pages/Overview.tsx', 'src/components/HomeAutomationChat.tsx', 'src/hooks/useHomeAutomationChat.ts', 'src/components/workspace-chat-composer.css', 'src/components/HomeBusinessTodos.tsx');
  sourceNames.push('src/components/ChatMarkdownImage.tsx', 'vite.config.ts');
sourceNames.push('src/components/ChatAttachments.tsx', 'src/components/chat-attachments.css', 'src/hooks/useChatAttachments.ts', 'src/components/ChatScenarioPicker.tsx', 'src/components/chat-scenario-picker.css', 'src/lib/chat-scenarios.ts', 'electron/chat-attachments.cjs', 'electron/chat-message-content.cjs', 'electron/reference-text.cjs', 'electron/cpu-tasks.cjs', 'electron/cpu-worker.cjs');
  sourceNames.push('scripts/fixtures/chat-cpu-worker.cjs');
  sourceNames.push('src/lib/chat-reference-selection.ts');
  sourceNames.push('scripts/fixtures/chat-studio-production.cjs', 'scripts/fixtures/chat-studio-new-features.cjs', 'src/components/ChatHistorySidebar.tsx', 'src/components/chat-history-sidebar.css', 'src/components/ChatResourcePicker.tsx', 'src/components/chat-resource-picker.css', 'src/components/StreamingChatReply.tsx', 'src/lib/chat-text-blocks.ts', 'src/lib/chat-stream-state.ts', 'src/hooks/useChatRefinement.ts', 'src/lib/artifact-refinement.ts', 'src/lib/live-start.ts', 'src/components/HomeProductionResult.tsx', 'src/components/home-production-result.css', 'src/components/ProjectTemplateActions.tsx', 'src/components/project-template.css', 'src/components/CustomerOrderLink.tsx', 'src/components/customer-order-link.css', 'src/components/CostAllocationDialog.tsx', 'src/components/cost-allocation.css', 'src/lib/cost-allocations.ts', 'src/lib/business-economics.ts', 'src/components/ClientProofingDialog.tsx', 'src/components/client-proofing.css', 'src/components/VisualVersionComparison.tsx', 'src/components/visual-version-comparison.css', 'src/components/VersionTimeline.tsx', 'src/proofing-types.ts', 'src/project-template-types.ts', 'electron/chat-history.cjs', 'electron/chat-backup.cjs', 'electron/project-templates.cjs', 'electron/project-template-backup.cjs', 'electron/customer-proofing.cjs', 'electron/proofing-preview.cjs', 'electron/proofing-client.cjs', 'electron/proofing-validation.cjs', 'electron/proofing-record.cjs', 'electron/proofing-backup.cjs', 'electron/business-links.cjs', 'electron/business-data.cjs', 'electron/business-store.cjs', 'electron/business-backup.cjs', 'electron/project-backup.cjs', 'electron/creation-service-adapters.cjs', 'electron/artifact-refinement-target.cjs', 'src/lib/live-polling.ts');
  sourceNames.push('electron/live-workflow-engine.cjs', 'electron/live-validation.cjs', 'electron/live-start.cjs', 'src/configuration-types.ts', 'src/business-types.ts', 'src/hooks/useLiveWorkflowRunner.ts', 'src/lib/live-start-source.ts', 'electron/main.cjs');
  sourceNames.push('src/lib/project-template-image.ts', 'src/components/ProjectCard.tsx', 'src/pages/Projects.tsx', 'src/pages/Finance.tsx', 'src/lib/business-data.ts', 'src/lib/business-validation.ts', 'electron/business-data.runtime.cjs', 'electron/backup-format.cjs', 'src/types.ts');
  sourceNames.push('scripts/fixtures/chat-markdown-sample.cjs', 'scripts/fixtures/chat-markdown-acceptance.cjs', 'src/lib/chat-markdown.ts', 'src/lib/chat-markdown.test.ts', 'src/lib/chat-text-blocks.test.ts', 'src/components/ChatReplyText.test.tsx');
  sourceNames.push('src/components/chat-reply-text.css', 'src/components/HomeAutomationChatSession.tsx');
  sourceNames.push('src/components/ChatReplyExportDialog.tsx', 'src/components/chat-reply-export.css', 'src/lib/chat-file-document.ts', 'electron/chat-file-link.cjs', 'src/lib/chat-scene-preferences.ts', 'src/components/EditableDocumentStudio.tsx', 'src/components/SpreadsheetStudio.tsx', 'src/components/WordEditor.tsx', 'src/components/PresentationEditor.tsx', 'src/components/SpreadsheetGrid.tsx', 'electron/workspace-storage.cjs', 'electron/editor-store.cjs', 'electron/spreadsheet-store.cjs', 'electron/artifact-document-preview.cjs', 'electron/office-export.cjs', 'electron/office-render.cjs', 'electron/delivery-store.cjs', 'src/components/DeliveryPanel.tsx', 'src/components/DeliveryPreflightPanel.tsx', 'src/components/DeliveryPreflightPanel.css', 'src/lib/delivery-pdf-inspection.ts', 'src/delivery-types.ts', 'electron/delivery-preflight.cjs', 'electron/delivery-preflight-analysis.cjs', 'electron/delivery-preflight-office.cjs', 'electron/delivery-preflight-xml.cjs');
  sourceNames.push("src/hooks/useAutoSizeTextarea.ts", "src/lib/model-display.ts", "src/lib/studio-run.ts", "src/components/NaturalAutomationModels.tsx", "src/components/HomeAutomationComposer.tsx", "src/components/HomeAutomationModelControls.tsx", "src/components/ModalPortal.tsx", "src/components/DialogShell.css", "src/lib/dialog-stack.ts", "src/components/StudioWorkbench.tsx", "src/components/StudioWorkbench.css", "src/components/document-editor.css");
  sourceNames.push(
    "electron/animation-backup.cjs",
    "electron/animation-document.runtime.cjs",
    "electron/animation-journal.cjs",
    "electron/animation-proof.cjs",
    "electron/animation-store.cjs",
    "electron/artifact-store.cjs",
    "electron/asset-categories.cjs",
    "electron/asset-provenance.cjs",
    "electron/automation-backup.cjs",
    "electron/automation-continuation.cjs",
    "electron/automation-planning.cjs",
    "electron/automation-quality.cjs",
    "electron/automation-rule-identity.cjs",
    "electron/automation-rule-preparation.cjs",
    "electron/backup-project-audits.cjs",
    "electron/backup-source-cache.cjs",
    "electron/batch-import.cjs",
    "electron/bead-document.cjs",
    "electron/bead-export-helpers.cjs",
    "electron/bead-exports.cjs",
    "electron/bead-market-ai-journal.cjs",
    "electron/bead-market-backup.cjs",
    "electron/bead-market.runtime.cjs",
    "electron/bead-pattern.runtime.cjs",
    "electron/bead-pdf-layout.cjs",
    "electron/billing-request-shape.cjs",
    "electron/billing-rules.json",
    "electron/business-formal.cjs",
    "electron/business-inputs.cjs",
    "electron/business-intake.cjs",
    "electron/business-listing.cjs",
    "electron/business-production-projects.cjs",
    "electron/business-production.runtime.cjs",
    "electron/chat-project-attachments.cjs",
    "electron/chat-queue-binding.cjs",
    "electron/chat-queue.cjs",
    "electron/chat-snapshot-sources.cjs",
    "electron/commerce-compositor.cjs",
    "electron/commerce-image-backup.cjs",
    "electron/commerce-image-document.cjs",
    "electron/commerce-image-store.cjs",
    "electron/cpu-task-scheduler.cjs",
    "electron/delivery-quality.cjs",
    "electron/delivery-source.cjs",
    "electron/document-illustrations.cjs",
    "electron/edited-delivery.cjs",
    "electron/editor-document.cjs",
    "electron/editor-generated.cjs",
    "electron/editor-office.cjs",
    "electron/engineering-export.cjs",
    "electron/image-export-sources.cjs",
    "electron/image-output-formats.cjs",
    "electron/image-output-options.cjs",
    "electron/image-reference-normalization.cjs",
    "electron/incremental-backup-paths.cjs",
    "electron/incremental-backup-store.cjs",
    "electron/live-cost.cjs",
    "electron/local-image-proof.cjs",
    "electron/model-receipt-backup.cjs",
    "electron/natural-automation-plan.runtime.cjs",
    "electron/office-content.cjs",
    "electron/office-preview-guard.cjs",
    "electron/official-billing.cjs",
    "electron/production-pdf.cjs",
    "electron/project-folder.cjs",
    "electron/project-template-creative.cjs",
    "electron/provider-http.cjs",
    "electron/queue-lifecycle.cjs",
    "electron/quote-backup.cjs",
    "electron/refinement-fork.cjs",
    "electron/resume-image-sources.cjs",
    "electron/revision-store.cjs",
    "electron/run-history-store.cjs",
    "electron/saved-filename.cjs",
    "electron/spreadsheet-delivery.cjs",
    "electron/spreadsheet-engine.cjs",
    "electron/spreadsheet-export.cjs",
    "electron/spreadsheet-generated-formatting.cjs",
    "electron/spreadsheet-generated.cjs",
    "electron/svg-billing.cjs",
    "electron/template-material.cjs",
    "electron/template-snapshot-sources.cjs",
    "electron/trash-store.cjs",
    "electron/wallpaper-export.cjs",
    "electron/wallpaper-worker.cjs",
    "electron/word-table.cjs",
    "electron/workflow-references.cjs",
    "electron/workspace-paths.cjs",
    "scripts/fixtures/chat-studio-queue.cjs",
    "src/animation-types.ts",
    "src/asset-types.ts",
    "src/automation-types.ts",
    "src/batch-types.ts",
    "src/bead-market-types.ts",
    "src/bead-types.ts",
    "src/billing-types.ts",
    "src/commerce-image-types.ts",
    "src/components/AnimationWorkflowSettings.css",
    "src/components/AnimationWorkflowSettings.tsx",
    "src/components/ArtifactResults.tsx",
    "src/components/AutoGrowTextarea.tsx",
    "src/components/AutomationProjectField.tsx",
    "src/components/BulkOrganizeDialog.tsx",
    "src/components/BusinessCategorySelect.tsx",
    "src/components/BusinessLaunchCards.tsx",
    "src/components/ChatQueuePanel.tsx",
    "src/components/ChatTimelineResults.tsx",
    "src/components/CompactAiPanel.tsx",
    "src/components/CostAmount.tsx",
    "src/components/CostBreakdown.tsx",
    "src/components/CustomerQuotePanel.tsx",
    "src/components/DeliveryChecklist.tsx",
    "src/components/DocumentArtifactPreview.tsx",
    "src/components/DocumentIllustrationOptions.tsx",
    "src/components/DocumentImageTools.tsx",
    "src/components/DocumentRevisionPanel.tsx",
    "src/components/ExampleTextarea.tsx",
    "src/components/HomeBeadEntry.tsx",
    "src/components/HomeProductionRecovery.tsx",
    "src/components/HomeResultFilePicker.tsx",
    "src/components/ImageOutputControls.tsx",
    "src/components/LocalRefinement.tsx",
    "src/components/NaturalAutomationPlanCard.tsx",
    "src/components/OfficeFilePreview.css",
    "src/components/OfficeFilePreview.tsx",
    "src/components/PdfPageCanvas.tsx",
    "src/components/ProjectActionsMenu.tsx",
    "src/components/ProjectPurgeDialog.tsx",
    "src/components/ProjectReferences.tsx",
    "src/components/PromptDialogs.tsx",
    "src/components/RecoveryDraftNotice.tsx",
    "src/components/RememberedDetails.tsx",
    "src/components/Select.css",
    "src/components/Select.tsx",
    "src/components/SelectionHistoryToolbar.tsx",
    "src/components/SpreadsheetDataTools.tsx",
    "src/components/StudioActionStatus.tsx",
    "src/components/StudioActions.tsx",
    "src/components/StudioAssetPicker.css",
    "src/components/StudioAssetPicker.tsx",
    "src/components/StudioDrawer.css",
    "src/components/StudioDrawer.tsx",
    "src/components/UnassignedQuoteDrafts.tsx",
    "src/components/WordBlockView.tsx",
    "src/components/WordTableEditor.tsx",
    "src/components/WorkflowEditor.tsx",
    "src/components/WorkflowQualitySettings.tsx",
    "src/components/WorkspaceConnectionRecovery.tsx",
    "src/components/artifact-results.css",
    "src/components/bulk-organize.css",
    "src/components/business-launch.css",
    "src/components/chat-queue-panel.css",
    "src/components/compact-ai-panel.css",
    "src/components/cost-amount.css",
    "src/components/cost-breakdown.css",
    "src/components/customer-quote.css",
    "src/components/delivery-batch.css",
    "src/components/document-artifact-preview.css",
    "src/components/document-illustrations.css",
    "src/components/document-revision.css",
    "src/components/editor-protection.css",
    "src/components/example-textarea.css",
    "src/components/home-model-controls.css",
    "src/components/home-result-picker.css",
    "src/components/image-output-controls.css",
    "src/components/local-refinement.css",
    "src/components/natural-automation.css",
    "src/components/project-purge.css",
    "src/components/project-references.css",
    "src/components/project-thumbnail.css",
    "src/components/selection-history-toolbar.css",
    "src/components/spreadsheet-editor.css",
    "src/components/studio-action-status.css",
    "src/components/studio-actions.css",
    "src/components/version-timeline.css",
    "src/components/word-table-editor.css",
    "src/components/workflow-shared.tsx",
    "src/content-search-types.ts",
    "src/data-management-types.ts",
    "src/data.ts",
    "src/data/wallpaper-devices.ts",
    "src/dialog-types.ts",
    "src/document-preview-types.ts",
    "src/editor-types.ts",
    "src/engineering-types.ts",
    "src/hooks/useAppearance.ts",
    "src/hooks/useAssetAvailability.ts",
    "src/hooks/useAssetThumbnail.ts",
    "src/hooks/useAutomationReadiness.ts",
    "src/hooks/useChatQueue.ts",
    "src/hooks/useDocumentImagePreviews.ts",
    "src/hooks/useDocumentPreviewImages.ts",
    "src/hooks/useDocumentSelectionHistory.tsx",
    "src/hooks/useEditHistory.ts",
    "src/hooks/useEditorShortcuts.ts",
    "src/hooks/useNaturalAutomationCreation.ts",
    "src/hooks/useNaturalAutomationDraft.ts",
    "src/hooks/useNaturalAutomationPlanning.ts",
    "src/hooks/useNaturalAutomationSession.ts",
    "src/hooks/usePdfDocument.ts",
    "src/hooks/useProjectBrowserState.ts",
    "src/hooks/useProjectInventory.ts",
    "src/hooks/useProjectQuote.ts",
    "src/hooks/useProjectTemplateSources.ts",
    "src/hooks/useRecoveryDraft.ts",
    "src/hooks/useRememberedBoolean.ts",
    "src/hooks/useRememberedString.ts",
    "src/hooks/useRememberedValue.ts",
    "src/hooks/useScopedTextHistory.ts",
    "src/hooks/useSpreadsheetCalculation.ts",
    "src/hooks/useStudioLayout.ts",
    "src/hooks/useStudioMonthClock.ts",
    "src/hooks/useStudioToolRequests.ts",
    "src/hooks/useWorkflowRunner.ts",
    "src/image-options-types.ts",
    "src/lib/animation-document.ts",
    "src/lib/animation-hash.ts",
    "src/lib/animation-styles.ts",
    "src/lib/animation-validation.ts",
    "src/lib/animation-workflow.ts",
    "src/lib/appearance.ts",
    "src/lib/artifact-preview-cache.ts",
    "src/lib/asset-application.ts",
    "src/lib/automation-dispatch.ts",
    "src/lib/automation-project-availability.ts",
    "src/lib/automation-recipes.ts",
    "src/lib/backup-change-events.ts",
    "src/lib/bead-image.ts",
    "src/lib/bead-intent.ts",
    "src/lib/builtin-assets.ts",
    "src/lib/business-editor-focus.ts",
    "src/lib/business-extra-validation.ts",
    "src/lib/business-import.ts",
    "src/lib/business-intake.ts",
    "src/lib/business-receivables.ts",
    "src/lib/business-view.ts",
    "src/lib/chat-timeline.ts",
    "src/lib/configuration.ts",
    "src/lib/cost-display.ts",
    "src/lib/creation-profiles.ts",
    "src/lib/creation-quality.ts",
    "src/lib/customer-quote.ts",
    "src/lib/delivery-quality.ts",
    "src/lib/disclosure-state.ts",
    "src/lib/document-fields.ts",
    "src/lib/document-illustrations.ts",
    "src/lib/document-image-edit.ts",
    "src/lib/document-image-previews.ts",
    "src/lib/document-image-size.ts",
    "src/lib/document-preview.ts",
    "src/lib/document-revision-context.ts",
    "src/lib/document-studio-state.ts",
    "src/lib/edit-history.ts",
    "src/lib/editor-document.ts",
    "src/lib/editor-export-proof.ts",
    "src/lib/editor-first-open.ts",
    "src/lib/editor-generated.ts",
    "src/lib/editor-recovery.ts",
    "src/lib/editor-session-guard.ts",
    "src/lib/editor-typing-group.ts",
    "src/lib/engineering-image.ts",
    "src/lib/files.ts",
    "src/lib/finance-projection.ts",
    "src/lib/generated-animation-reference.ts",
    "src/lib/global-search.ts",
    "src/lib/home-automation-chat.ts",
    "src/lib/home-continuation.ts",
    "src/lib/home-conversation-costs.ts",
    "src/lib/home-creation.ts",
    "src/lib/home-folder-send.ts",
    "src/lib/image-output-options.ts",
    "src/lib/image-quantity.ts",
    "src/lib/image-studio.ts",
    "src/lib/image-use-templates.ts",
    "src/lib/local-refinement-status.ts",
    "src/lib/local-refinement.ts",
    "src/lib/native-snapshot.ts",
    "src/lib/natural-automation-composer-state.ts",
    "src/lib/natural-automation-plan.ts",
    "src/lib/natural-model-bindings.ts",
    "src/lib/preferences.ts",
    "src/lib/pricing.ts",
    "src/lib/project-browser-state.ts",
    "src/lib/project-browser.ts",
    "src/lib/project-file-cache.ts",
    "src/lib/project-files.ts",
    "src/lib/project-inventory.ts",
    "src/lib/project-move.ts",
    "src/lib/project-purge.ts",
    "src/lib/project-quotes.ts",
    "src/lib/project-status.ts",
    "src/lib/prompt-lifecycle.ts",
    "src/lib/prompt-variables.ts",
    "src/lib/quote-calculator.ts",
    "src/lib/quote-working-drafts.ts",
    "src/lib/recovery-draft.ts",
    "src/lib/run-details.ts",
    "src/lib/saved-filename.ts",
    "src/lib/scoped-text-history.ts",
    "src/lib/simulation-storage.ts",
    "src/lib/snapshot-serialization.ts",
    "src/lib/spreadsheet-calculation-cache.ts",
    "src/lib/spreadsheet-delivery.ts",
    "src/lib/spreadsheet-edit-validation.ts",
    "src/lib/spreadsheet-engine.ts",
    "src/lib/spreadsheet-generated-formatting.ts",
    "src/lib/spreadsheet-generated.ts",
    "src/lib/spreadsheet-operations.ts",
    "src/lib/spreadsheet-scope-history.ts",
    "src/lib/spreadsheet-ui.ts",
    "src/lib/spreadsheet-worker-client.ts",
    "src/lib/studio-action-status.ts",
    "src/lib/studio-ai-focus.ts",
    "src/lib/studio-asset-picker.ts",
    "src/lib/studio-commands.ts",
    "src/lib/studio-layout-state.ts",
    "src/lib/studio-project-bindings.ts",
    "src/lib/studio-time.ts",
    "src/lib/svg-reference.ts",
    "src/lib/task-visibility.ts",
    "src/lib/text-delta.ts",
    "src/lib/thumbnail-queue.ts",
    "src/lib/version-comparison.ts",
    "src/lib/wallpaper-target.ts",
    "src/lib/word-table.ts",
    "src/lib/workflow-purpose.ts",
    "src/lib/workflows.ts",
    "src/lib/workspace-state.ts",
    "src/live-types.ts",
    "src/model-presets.ts",
    "src/natural-automation-types.ts",
    "src/office-preview-types.ts",
    "src/pages/finance.css",
    "src/pages/operations.css",
    "src/pages/project-browser.css",
    "src/pages/prompts.css",
    "src/pages/workflows.css",
    "src/performance-types.ts",
    "src/project-purge-types.ts",
    "src/prompt-data.ts",
    "src/quote-backup-types.ts",
    "src/spreadsheet-types.ts",
    "src/update-types.ts",
    "src/wallpaper-types.ts",
    "src/workspace-types.ts"
  );
  sourceNames.push('src/lib/chat-window.ts', 'src/components/ChatPlanReference.tsx', 'src/components/chat-plan-reference.css', 'src/lib/document-image-binding.ts');
  sourceNames.push('scripts/verify-bead-native.cjs', 'src/workers/spreadsheet-calculation.worker.ts', 'src/lib/spreadsheet-incremental.ts', 'assets/library/catalog.json');
  sourceNames.push('electron/default-project-folder.cjs');
  for (const name of sourceNames) sources[name] = hash(await fs.readFile(path.join(root, name)));
  const dependencyRoot = path.join(runtime, 'node_modules');
  assert.equal((await fs.realpath(dependencyRoot)).toLowerCase(), dependencyRoot.toLowerCase(), 'Native dependency root must be an ordinary expected directory');
  const owner = { kind: 'xuzuo-chat-studio', nonce, commit: report.commit, parentPid: process.pid, temporaryRoot, temporary, output, dist, files, sources, dependencyRoot, localRuntime };
  await fs.mkdir(path.join(temporary, 'profile')); await fs.writeFile(path.join(temporary, 'owner.json'), JSON.stringify(owner) + '\n', { flag: 'wx' });
  const { isolatedEnvironment } = load(path.join(root, 'scripts/verify-bead-native.cjs')), env = isolatedEnvironment(temporary, { directory: runtime }); Object.assign(env, { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: report.commit, GITHUB_WORKSPACE: root, RUNNER_TEMP: temporaryRoot });
  assert(!Object.keys(env).some(key => /TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE/.test(key)));
  child = spawn(load('electron'), [path.join(root, 'scripts/verify-chat-studio-native.cjs'), temporary, `--user-data-dir=${path.join(temporary, 'profile')}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', expired = false, timer; child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString()).slice(-16384); }); child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-16384); });
  const code = await Promise.race([new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), new Promise(resolve => { timer = setTimeout(() => { expired = true; stop(child.pid); resolve(null); }, 130000); })]); clearTimeout(timer);
  report.child = { pid: child.pid, code, expired, stdout, stderr }; report.native = JSON.parse(await fs.readFile(path.join(temporary, 'native-report.json'), 'utf8')); const native = report.native;
  assert.equal(native.nonce, nonce); assert.equal(native.commit, report.commit); const pids = [...new Set([child.pid, ...native.processIds])].filter(pid => Number.isInteger(pid) && pid !== process.pid);
  for (let index = 0; index < 30 && pids.some(alive); index++) await new Promise(resolve => setTimeout(resolve, 100)); report.residualPids = pids.filter(alive);
  assert(!expired && code === 0 && native.passed, native.errors?.join('\n')); assert.equal(report.residualPids.length, 0); assert.equal(native.externalRequests, 0); assert.equal(native.actualAccountCharges, 0);
  for (const key of ['noProjectChat', 'reasoningBodyVerified', 'multiTurnContextVerified', 'partialStreamDisplayed', 'stopAndRetryPreserveCosts', 'planValidatedBeforeDisplay', 'deferredProjectSelection', 'historyReloadKeepsLedger']) assert.equal(native[key], true, key);
  assert.equal(native.homeBounds.length, 16); assert(native.homeBounds.every(value => value.passed && value.sendReachable && value.recentHits.every(hit => hit.reachable)));
  assert.equal(native.accountDetailsBeforeSendVerified, true);
  assert.equal(native.planReferencePreservesDraft, true);
  for (const key of ['boundedNaturalGrowth', 'clearsToCompact', 'noCallsOrProjects']) assert.equal(native.composerSizing[key], true, key);
  assert.equal(native.composerSizing.pageZoomFactor, 1);
  assert.equal(native.originalSyntheticPostCount, 6); assert.equal(native.attachmentSyntheticPostCount, 3); assert.equal(native.baselineSyntheticPostCount, 9); assert.equal(native.queueSyntheticPostCount, 2); assert.equal(native.totalSyntheticPostCount, 11); assert.equal(native.fakePostCount, 11); assert.equal(native.syntheticCalls.length, 11);
  for (const key of ['serialDispatch', 'snapshotModelAccountReasoningAndActualReferences', 'editReservesUntilSaved', 'withdrawBeforeDispatchHasNoCall', 'lostAckResolvedByFreeRead', 'rendererReloadRetainsQueueAndEditDraft', 'priorFeesRetained', 'noForcedProjectCreation', 'resultsAttachedToSourceTurn']) assert.equal(native.queueChecks[key], true, key);
  assert.equal(native.queueLayouts.length, 2); assert(native.queueLayouts.every(layout => layout.passed)); assert.equal(native.queueScreenshots.length, 2); assert.equal(native.dependencyMode, report.dependencyMode);
  for (const key of ['scenarioChoiceIsLocal', 'localImportUsesRealFiles', 'previewReadsRealBytes', 'removeDoesNotSend', 'attachmentOnlySend', 'imageBytesReachProvider', 'officeReadUsesWorker', 'chatToPlanKeepsImage', 'officeAndTextReachProvider', 'historyReloadKeepsReferences']) assert.equal(native.attachmentChecks[key], true, key);
  for (const key of ['historyManagement', 'localResourceImports', 'directToolWithoutChat', 'boundRefinement', 'refinementFeesSeparate']) assert.equal(native.productivityChecks[key], true, key);
  for (const key of ['word', 'ppt', 'excel', 'actualOfficeBytes', 'homeResultPreviews', 'directEditors', 'draftsAndFeesPreserved', 'sourceAssociationsIdempotent']) assert.equal(native.exportChecks[key], true, key);
  for (const key of ['favorites', 'recent', 'reloadRestores', 'lightDarkLayouts', 'noAdditionalCalls']) assert.equal(native.sceneChecks[key], true, key);
  assert.equal(native.sceneLayouts.length, 4); assert(native.sceneLayouts.every(layout => layout.passed)); assert.equal(native.chatExports.length, 3); assert.deepEqual(native.chatExports.map(file => file.kind), ['word', 'ppt', 'excel']);
  assert.equal(native.refinementSyntheticPostCount, 1);
  for (const key of ['semanticQuotation', 'emphasisAndEntitiesReadable', 'cleanCopyThroughActualButton', 'codeOperatorsPreserved', 'sourceTextAndLedgerUnchanged', 'noAdditionalModelRequests', 'systemClipboardUntouched']) assert.equal(native.markdownChecks[key], true, key);
  assert(native.attachmentWorkers.length > 0 && native.attachmentWorkers.every(task => task.exited && task.dependencyBootstrapVerified));
  assert.equal(native.layouts.length, 4); assert(native.layouts.every(value => value.passed)); assert.equal(native.screenshots.length, 4); report.sources = sources; report.fixtureFiles = files; report.passed = true;
}
main().catch(error => { report.errors.push(String(error.stack || error)); process.exitCode = 1; }).finally(async () => { clearTimeout(watchdog); if (!buildOnly && await exists(output) && !await exists(path.join(output, 'report.json'))) await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); if (!buildOnly) console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), errors: report.errors })); });
