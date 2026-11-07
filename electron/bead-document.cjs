const core = () => require('./bead-pattern.runtime.cjs');
function checkedBeadDocument(value) {
  const issue = core().beadDocumentIssue(value); if (issue) throw Error(issue);
  const palette = value.pattern.palette;
  return { type: 'xuzuo-bead-document', version: 1, id: value.id, projectId: value.projectId, revision: value.revision, title: value.title,
    ...(value.referenceId ? { referenceId: value.referenceId } : {}), ...(value.sourceSha256 ? { sourceSha256: value.sourceSha256 } : {}), updatedAt: value.updatedAt,
    settings: Object.fromEntries(['columns', 'rows', 'fit', 'maxColors', 'alphaThreshold', 'boardColumns', 'boardRows'].map(key => [key, value.settings[key]])),
    pattern: { type: 'xuzuo-bead-pattern', version: 1, columns: value.pattern.columns, rows: value.pattern.rows, cells: [...value.pattern.cells], palette: { id: palette.id, name: palette.name, brand: palette.brand, version: palette.version, sourceUrl: palette.sourceUrl, sourceNote: palette.sourceNote, license: palette.license, colors: palette.colors.map(color => ({ code: color.code, name: color.name, hex: color.hex, rgb: [...color.rgb], kind: color.kind, automatic: color.automatic })) } },
    procurement: { copies: value.procurement.copies, lossPercent: value.procurement.lossPercent, defaultPackSize: value.procurement.defaultPackSize, stock: { ...value.procurement.stock }, packSizes: { ...value.procurement.packSizes } } };
}
module.exports = { checkedBeadDocument };
