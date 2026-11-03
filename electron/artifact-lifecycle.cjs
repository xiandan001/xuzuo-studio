const ACTIVE_STATUSES = new Set(['running', 'paused', 'waiting-review']);

function artifactTrashError(artifact, runs) {
  const busy = runs.some(run => ACTIVE_STATUSES.has(run.status) && ((artifact.projectId && run.projectId === artifact.projectId) || run.attachmentIds?.includes(artifact.id) || run.attempts?.some(attempt => attempt.artifacts?.some(item => item.id === artifact.id))));
  return busy ? '当前运行、暂停或待确认的流程正在使用这个项目或文件，请先完成或取消流程，再移入回收站。' : '';
}

function artifactRequestError(request, movingArtifacts) {
  const moving = movingArtifacts.some(artifact => (artifact.projectId && request?.project?.id === artifact.projectId) || request?.attachmentIds?.includes(artifact.id));
  return moving ? '项目或参考文件正在移入回收站，请等待操作完成并确认文件可用后再执行。' : '';
}

module.exports = { artifactTrashError, artifactRequestError };
