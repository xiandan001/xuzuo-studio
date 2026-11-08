function mergeGeneratedFrames(current, previous, artifactId, grid, selectedFrameId) {
  const sources = new Map(previous.map((frame, index) => [frame.id, { frame, index }]));
  const identity = frame => JSON.stringify([frame.atlasArtifactId, frame.cell, frame.grid, frame.crop]);
  let replaced = 0;
  const frames = current.map(frame => {
    const source = sources.get(frame.id);
    if (!source || selectedFrameId && frame.id !== selectedFrameId) return frame;
    if (identity(source.frame) !== identity(frame)) throw Error('所选源画面已在另一处修改，新结果保留，未覆盖当前源稿。');
    replaced++;
    const index = selectedFrameId ? 0 : source.index, next = { ...frame, atlasArtifactId: artifactId, cell: [index % grid[0], Math.floor(index / grid[0])], grid };
    delete next.crop;
    return next;
  });
  if (!replaced) throw Error('原选中的源画面已移除，新结果保留，未覆盖当前工程。');
  return frames;
}
module.exports = { mergeGeneratedFrames };
