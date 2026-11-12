const { randomUUID, createHash } = require('node:crypto');
const { nativeBusinessProjects } = require('./business-production-projects.cjs');
const { extractReferenceText } = require('./reference-text.cjs');
const { invalidateBusinessInputs } = require('./business-inputs.cjs');
const FIELDS = ['brief', 'purpose', 'quantity', 'size', 'deadline', 'includedRevisions', 'formats'];
const LABELS = { brief: '整体需求', purpose: '用途', quantity: '交付数量', size: '交付尺寸', deadline: '截止日期', includedRevisions: '修改次数', formats: '交付格式' };
const RULES = { brief: /^(?:需求|整体需求|项目要求|制作内容)[ \t]*[:：][ \t]*(.+)$/im, purpose: /^(?:用途|使用场景|投放场景)[ \t]*[:：][ \t]*(.+)$/im, quantity: /^(?:数量|交付数量|图片数量)[ \t]*[:：][ \t]*(.+)$/im, size: /^(?:尺寸|交付尺寸|图片尺寸)[ \t]*[:：][ \t]*(.+)$/im, deadline: /^(?:截止日期|截止时间|交付日期|交付时间)[ \t]*[:：][ \t]*(.+)$/im, includedRevisions: /^(?:修改次数|包含修改|免费修改)[ \t]*[:：][ \t]*(.+)$/im, formats: /^(?:格式|交付格式|文件格式)[ \t]*[:：][ \t]*(.+)$/im };
const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const normalized = value => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function localCandidates(sources) {
  const candidates = new Map();
  for (const source of sources) for (const key of FIELDS) {
    if (!source.text) continue;
    const expression = new RegExp(RULES[key].source, RULES[key].flags + 'g');
    for (const match of source.text.matchAll(expression)) {
      const value = match[1].trim(); if (!value) continue;
      if (value.length > 4000) throw Error('单项需求超过4000字，请拆分资料后读取，原文件保留。');
      const candidateKey = key + ':' + normalized(value), existing = candidates.get(candidateKey);
      const evidence = { artifactId: source.artifactId, snippet: match[0].trim().slice(0, 2000), textMatched: true };
      if (existing) { if (existing.evidence.length < 16 && !existing.evidence.some(item => item.artifactId === evidence.artifactId && item.snippet === evidence.snippet)) existing.evidence.push(evidence); }
      else { if (candidates.size >= 70) throw Error('本次需求候选超过70项，请分批读取，避免遗漏冲突；原文件保留。'); candidates.set(candidateKey, { key, value, evidence: [evidence] }); }
    }
  }
  return [...candidates.values()];
}
function candidatesFrom(value, sources) {
  if (!value || !Array.isArray(value.candidates) || value.candidates.length > 70) throw Error('识读结果缺少可核对的需求候选；费用与来源保留，没有写入订单。');
  const candidates = [];
  for (const row of value.candidates) {
    if (!row || !FIELDS.includes(row.key) || typeof row.value !== 'string' || !row.value.trim() || row.value.length > 4000 || !Array.isArray(row.evidence) || !row.evidence.length || row.evidence.length > 16) throw Error('需求候选格式不完整，没有写入订单。');
    const evidence = row.evidence.map(item => {
      const source = sources.find(source => source.artifactId === item?.artifactId || source.originalArtifactId === item?.artifactId);
      if (!source || typeof item.snippet !== 'string' || !item.snippet.trim() || item.snippet.length > 2000 || item.page !== undefined && (!Number.isSafeInteger(item.page) || item.page < 1 || item.page > 100000)) throw Error('需求证据没有对应实际来源，没有写入订单。');
      const textMatched = source.text !== undefined && normalized(source.text).includes(normalized(item.snippet));
      if (source.text !== undefined && !textMatched) throw Error('识读原句无法在本地提取的原文中找到，请核对原资料；没有写入订单。');
      return { artifactId: source.artifactId, ...(item.page !== undefined ? { page: item.page } : {}), snippet: item.snippet.trim(), textMatched };
    });
    if (!candidates.some(item => item.key === row.key && item.value === row.value.trim() && JSON.stringify(item.evidence) === JSON.stringify(evidence))) candidates.push({ key: row.key, value: row.value.trim(), evidence });
  }
  return candidates;
}
function mergeCandidates(existing, added) {
  const merged = new Map();
  for (const candidate of [...existing, ...added]) {
    const key = candidate.key + ':' + normalized(candidate.value), previous = merged.get(key);
    if (!previous) { if (merged.size >= 70) throw Error('补充后需求候选超过70项，请分批读取；已有需求和费用保留。'); merged.set(key, structuredClone(candidate)); }
    else for (const evidence of candidate.evidence) if (previous.evidence.length < 16 && !previous.evidence.some(item => item.artifactId === evidence.artifactId && item.page === evidence.page && item.snippet === evidence.snippet)) previous.evidence.push(structuredClone(evidence));
  }
  return [...merged.values()];
}
function decorate(draft) {
  draft.missing = FIELDS.filter(key => !draft.candidates.some(row => row.key === key));
  const conflicts = FIELDS.filter(key => new Set(draft.candidates.filter(row => row.key === key).map(row => normalized(row.value))).size > 1);
  draft.warnings = [...new Set([...(draft.warnings || []), ...conflicts.map(key => `${LABELS[key]}有多个不同说法，请选择并核对。`), ...(draft.sources.some(row => row.text === undefined) ? ['截图／PDF候选来自模型识读，原句与页码需对照来源核对。'] : [])])].slice(0, 30);
  return draft;
}
function createBusinessIntake(options) {
  const { businessStore, artifactStore, businessAssist } = options, projects = nativeBusinessProjects(options), jobs = new Map();
  const extractText = options.extractText || (file => extractReferenceText(file, options.loadModule));
  const orderFrom = (state, input) => { const order = state.orders.find(row => row.id === input.orderId); if (!order || order.status === 'archived') throw Error('制作单不存在或已归档。'); return order; };
  function check(input) { if (!input || !id(input.workspaceId) || !id(input.orderId)) throw Error('请选择当前工作区的制作单。'); }
  async function sourceCheck(workspaceId, draft) {
    const files = await projects.referenceFiles(workspaceId, draft.sources.map(row => row.artifactId), false);
    if (files.some(file => draft.sources.find(row => row.artifactId === file.id)?.sha256 !== hash(file.buffer))) throw Error('来源资料已改变，请重新读取原资料；未写入订单。');
  }
  async function intakeRead(input) {
    check(input);
    if (!Array.isArray(input.artifactIds) || input.artifactIds.length > 15 || input.artifactIds.some(item => !id(item)) || new Set(input.artifactIds).size !== input.artifactIds.length || input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 40000) || !input.artifactIds.length && !input.text?.trim()) throw Error('请选择资料或粘贴客户原话，最多15份文件和4万字。');
    const state = await businessStore.snapshot(input.workspaceId), order = orderFrom(state, input);
    await projects.context(input.workspaceId, order);
    const ids = await projects.copyReferences(input.workspaceId, input.artifactIds, order.sourceProjectId, false);
    if (input.text?.trim()) {
      const buffer = Buffer.from(input.text.trim(), 'utf8'), sha256 = hash(buffer);
      const existing = (order.intakes || []).flatMap(row => row.sources).find(row => row.sha256 === sha256 && row.mimeType === 'text/plain');
      if (existing) ids.push(existing.artifactId);
      else ids.push((await artifactStore.write({ projectId: order.sourceProjectId, runId: `intake-${randomUUID()}`, name: '客户需求原话.txt', mimeType: 'text/plain', buffer })).id);
    }
    const files = await projects.referenceFiles(input.workspaceId, [...new Set(ids)], false), sources = []; let length = 0;
    for (const file of files) {
      if (!['text', 'office'].includes(file.kind) && !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) throw Error('需求识读支持文字、DOCX/PPTX/XLSX、PDF及静态PNG/JPEG/WebP，请转换后导入。');
      const text = ['text', 'office'].includes(file.kind) ? await extractText(file) : undefined;
      length += text?.length || 0; if (length > 60000) throw Error('本次原文超过6万字，请按需求分批读取。');
      sources.push({ artifactId: file.id, originalArtifactId: file.id, name: file.name, mimeType: file.mimeType, sha256: hash(file.buffer), ...(text !== undefined ? { text } : {}) });
    }
    const candidates = localCandidates(sources);
    const draft = decorate({ id: randomUUID(), requestId: randomUUID(), createdAt: new Date().toISOString(), factsRevision: order.factsRevision, sources, candidates, warnings: [] });
    const saved = await businessStore.mutate(input.workspaceId, state => { const current = orderFrom(state, input); if ((current.intakes || []).length >= 12) throw Error('本单已保存12份需求卡，请为新一批资料建立独立制作单；历史来源未删除。'); current.intakes = [...(current.intakes || []), draft]; return state; });
    return { state: saved, intakeId: draft.id };
  }
  async function extract(input) {
    check(input); if (!id(input.intakeId)) throw Error('请先读取客户资料。');
    const state = await businessStore.snapshot(input.workspaceId), order = orderFrom(state, input), draft = order.intakes?.find(row => row.id === input.intakeId);
    if (!draft || draft.confirmedAt) throw Error('这份需求卡已确认或不存在，请读取新的客户资料。');
    if (draft.runId) return { state, intakeId: draft.id };
    await sourceCheck(input.workspaceId, draft);
    if (!businessAssist?.assist) throw Error('当前版本缺少模型识读模块。');
    const result = await businessAssist.assist({ workspaceId: input.workspaceId, orderId: order.id, purpose: 'intake', requestId: draft.requestId || draft.id, attachmentIds: draft.sources.filter(source => source.text === undefined).map(source => source.artifactId), text: JSON.stringify({ sources: draft.sources.map(({ artifactId, name, mimeType, text }) => ({ artifactId, name, mimeType, ...(text !== undefined ? { text } : {}) })) }) });
    let parsed; try { parsed = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw Error('模型未返回完整的需求结构，原费用保留；可从原文手动填写，没有改动订单。'); }
    const candidates = candidatesFrom(parsed, draft.sources);
    const saved = await businessStore.mutate(input.workspaceId, state => { const current = orderFrom(state, input).intakes?.find(row => row.id === draft.id); if (!current || current.confirmedAt) throw Error('需求卡已改变，请刷新查看。'); current.candidates = mergeCandidates(current.candidates, candidates); current.runId = result.runId; current.warnings = [...current.warnings, ...(Array.isArray(parsed.warnings) ? parsed.warnings.filter(item => typeof item === 'string').slice(0, 10).map(item => item.slice(0, 1000)) : [])].slice(0, 30); decorate(current); return state; });
    return { state: saved, intakeId: draft.id };
  }
  async function intakeConfirm(input) {
    check(input);
    if (!id(input.intakeId) || input.confirmed !== true || !Number.isSafeInteger(input.expectedRevision) || !input.values || typeof input.values !== 'object' || Array.isArray(input.values) || !Object.keys(input.values).length || Object.entries(input.values).some(([key, value]) => !FIELDS.includes(key) || typeof value !== 'string' || !value.trim() || value.length > 4000)) throw Error('请核对并勾选要写入的字段。');
    return businessStore.mutate(input.workspaceId, async state => {
      const order = orderFrom(state, input), draft = order.intakes?.find(row => row.id === input.intakeId);
      if (draft?.confirmedAt) { if (JSON.stringify(draft.confirmedValues) === JSON.stringify(input.values)) return state; throw Error('这份需求卡已按其他值确认，请读取新资料。'); }
      if (state.revision !== input.expectedRevision || !draft || draft.factsRevision !== order.factsRevision || order.status === 'running') throw Error('订单资料已更新或正在制作，请读取最新资料后核对。');
      await sourceCheck(input.workspaceId, draft);
      if (Object.keys(input.values).some(key => !draft.candidates.some(row => row.key === key))) throw Error('只能确认有来源候选的字段；缺项请在订单资料里补充。');
      const before = structuredClone(state);
      for (const [key, raw] of Object.entries(input.values)) {
        const value = raw.trim();
        if (key === 'quantity' || key === 'includedRevisions') {
          const max = key === 'quantity' ? 20 : 100;
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (key === 'quantity' ? 1 : 0) || Number(value) > max) throw Error(`${LABELS[key]}需填写${key === 'quantity' ? '1–20' : '0–100'}的整数；原文单位请先核对。`);
          if (key === 'includedRevisions') order.includedRevisions = Number(value); else if (order.outputKinds.includes('image')) order.imageCount = Number(value);
        } else if (key === 'deadline') { if (!date(value)) throw Error('截止日期请核对为完整有效的YYYY-MM-DD，未擅自换算相对日期。'); order.deadline = value; }
        else if (key === 'size') {
          const match = value.match(/^(\d{2,4})\s*[xX×＊*]\s*(\d{2,4})(?:\s*(?:px|像素))?$/i);
          if (!match || Math.min(Number(match[1]), Number(match[2])) < 64 || Math.max(Number(match[1]), Number(match[2])) > 8192 || Number(match[1]) * Number(match[2]) > 16000000) throw Error('尺寸请核对为宽×高像素，范围64–8192且不超过1600万像素。');
          order.sizes = [{ width: Number(match[1]), height: Number(match[2]), label: '客户确认尺寸' }];
        } else if (key === 'brief') order.brief = value;
        order.facts[LABELS[key]] = value;
      }
      invalidateBusinessInputs(before, state);
      draft.confirmedAt = new Date().toISOString(); draft.confirmedValues = structuredClone(input.values); order.updatedAt = draft.confirmedAt;
      return state;
    });
  }
  return { intakeRead, intakeConfirm, intakeExtract(input) { const key = `${input?.workspaceId}/${input?.orderId}/${input?.intakeId}`; if (jobs.has(key)) return jobs.get(key); const task = extract(input).finally(() => jobs.delete(key)); jobs.set(key, task); return task; }, drain: () => Promise.allSettled([...jobs.values()]) };
}
module.exports = { createBusinessIntake, candidatesFrom };
