const OFFICE_KINDS = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
};
function createDocumentArtifactPreview({ liveEngine, editorStore, spreadsheetStore }) {
  return async artifact => {
    const kind = OFFICE_KINDS[artifact.mimeType];
    if (!kind || !artifact.projectId) return undefined;
    const { runs } = await liveEngine.snapshot(undefined, { summaryOnly: true });
    let run = runs.find(item => item.mode === 'live' && item.projectId === artifact.projectId && item.attempts.some(attempt => attempt.artifacts?.some(file => file.id === artifact.id)));
    if (!run) return undefined;
    if (Number.isSafeInteger(run.sourceRevision) && run.sourceRevision > 0) {
      const store = kind === 'excel' ? spreadsheetStore : editorStore;
      const record = await store.loadVersion({ projectId: artifact.projectId, revision: run.sourceRevision });
      if (record.document.kind !== kind) return undefined;
      return { text: JSON.stringify(record.document), documentSource: true, sourceRevision: record.revision };
    }
    if (run.contentTruncated) { if (!liveEngine.runDetail) return undefined; run = await liveEngine.runDetail(run.id); }
    const index = run.attempts.findIndex(attempt => attempt.artifacts?.some(file => file.id === artifact.id));
    const exported = run.attempts[index];
    const step = run.snapshot.steps.find(item => item.id === exported.stepId && item.kind === 'export');
    if (!step) return undefined;
    const stepIndex = run.snapshot.steps.findIndex(item => item.id === step.id);
    const precedingSteps = run.snapshot.steps.slice(0, stepIndex).filter(item => item.enabled && ['text', 'transcription'].includes(item.kind));
    const candidates = run.attempts.slice(0, index).filter(attempt => attempt.status === 'complete' && precedingSteps.some(item => item.id === attempt.stepId) && (!step.contentSourceStepId || attempt.stepId === step.contentSourceStepId));
    const text = !step.contentSourceStepId && step.inputSource === 'project' ? exported.input : candidates.at(-1)?.summary || exported.input;
    return typeof text === 'string' && text.trim() ? { text, documentSource: true } : undefined;
  };
}
module.exports = { createDocumentArtifactPreview };
