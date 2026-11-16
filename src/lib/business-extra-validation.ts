import { BUSINESS_INTAKE_KEYS } from './business-intake';

const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !v.includes('\0');
const obj = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Object.keys(v).every(key => keys.includes(key));
const integer = (v: unknown, max = 1_000_000_000_000) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export const businessDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

export function validPaymentPlan(value: unknown): boolean {
  if (value === undefined) return true;
  if (!obj(value, ['currency', 'agreedCents', 'milestones', 'assignments']) || value.currency !== 'CNY' || !integer(value.agreedCents) || !Array.isArray(value.milestones) || !value.milestones.length || value.milestones.length > 12) return false;
  if (value.assignments !== undefined) {
    if (!Array.isArray(value.assignments) || value.assignments.length > 20000 || new Set(value.assignments.map(row => row?.id)).size !== value.assignments.length || !value.assignments.every(row => obj(row, ['id', 'transactionId', 'milestoneId', 'createdAt', 'voidedAt']) && id(row.id) && id(row.transactionId) && (row.milestoneId === undefined || id(row.milestoneId)) && time(row.createdAt) && (row.voidedAt === undefined || time(row.voidedAt)))) return false;
    const active = value.assignments.filter(row => !row.voidedAt); if (new Set(active.map(row => row.transactionId)).size !== active.length) return false;
  }
  const rows = value.milestones;
  return new Set(rows.map(row => row?.id)).size === rows.length && rows.every(row => obj(row, ['id', 'label', 'amountCents', 'dueDate', 'note']) && id(row.id) && text(row.label, 100) && !!String(row.label).trim() && integer(row.amountCents) && Number(row.amountCents) > 0 && (row.dueDate === undefined || businessDate(row.dueDate)) && (row.note === undefined || text(row.note, 1000))) && rows.reduce((sum, row) => sum + Number(row.amountCents), 0) === value.agreedCents;
}
export function validIntakes(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 12 || new Set(value.map(row => row?.id)).size !== value.length) return false;
  return value.every(row => {
    if (!obj(row, ['id', 'requestId', 'createdAt', 'factsRevision', 'sources', 'candidates', 'missing', 'warnings', 'runId', 'confirmedAt', 'confirmedValues']) || !id(row.id) || row.requestId !== undefined && !id(row.requestId) || !time(row.createdAt) || !integer(row.factsRevision, Number.MAX_SAFE_INTEGER - 1) || row.runId !== undefined && !id(row.runId) || row.confirmedAt !== undefined && !time(row.confirmedAt)) return false;
    if (!Array.isArray(row.sources) || !row.sources.length || row.sources.length > 16 || new Set(row.sources.map(source => source?.artifactId)).size !== row.sources.length || !row.sources.every(source => obj(source, ['artifactId', 'originalArtifactId', 'sha256', 'name', 'mimeType', 'text']) && id(source.artifactId) && (source.originalArtifactId === undefined || id(source.originalArtifactId)) && hash(source.sha256) && text(source.name, 500) && text(source.mimeType, 200) && (source.text === undefined || text(source.text, 80000)))) return false;
    const sources = new Set(row.sources.map(source => source.artifactId));
    if (!Array.isArray(row.candidates) || row.candidates.length > 70 || !row.candidates.every(candidate => obj(candidate, ['key', 'value', 'evidence']) && BUSINESS_INTAKE_KEYS.includes(candidate.key as never) && text(candidate.value, 4000) && !!String(candidate.value).trim() && Array.isArray(candidate.evidence) && candidate.evidence.length > 0 && candidate.evidence.length <= 16 && candidate.evidence.every(evidence => obj(evidence, ['artifactId', 'page', 'snippet', 'textMatched']) && sources.has(evidence.artifactId) && (evidence.page === undefined || integer(evidence.page, 100000) && Number(evidence.page) > 0) && text(evidence.snippet, 2000) && !!String(evidence.snippet).trim() && typeof evidence.textMatched === 'boolean'))) return false;
    if (!Array.isArray(row.missing) || row.missing.length > 7 || !row.missing.every(key => BUSINESS_INTAKE_KEYS.includes(key)) || !Array.isArray(row.warnings) || row.warnings.length > 30 || !row.warnings.every(item => text(item, 1000))) return false;
    return row.confirmedValues === undefined ? row.confirmedAt === undefined : !!row.confirmedAt && obj(row.confirmedValues, BUSINESS_INTAKE_KEYS) && Object.values(row.confirmedValues).every(item => text(item, 4000));
  });
}
export function validRevisionAdoption(value: unknown): boolean {
  return value === undefined || obj(value, ['sourceArtifactId', 'sourceSha256', 'exportRevision', 'artifactIds', 'adoptedAt']) && id(value.sourceArtifactId) && hash(value.sourceSha256) && integer(value.exportRevision) && Number(value.exportRevision) > 0 && time(value.adoptedAt) && Array.isArray(value.artifactIds) && value.artifactIds.length > 0 && value.artifactIds.length <= 20 && value.artifactIds.every(id) && new Set(value.artifactIds).size === value.artifactIds.length;
}
