const { estimateCost } = require('./live-cost.cjs');
const { extractReferenceText } = require('./reference-text.cjs');
const { imageExportSourceError } = require('./image-export-sources.cjs');
const { validateMarkup } = require('./image-output-formats.cjs');
const { wallpaperTargetError } = require('./wallpaper-export.cjs');
const { readEngineeringSource } = require('./engineering-export.cjs');
const { stepReferenceIssue, explicitStepReferences } = require('./workflow-references.cjs');
const { checkedAnimationWorkflowSettings } = require('./animation-document.runtime.cjs');
const { reasoningRequestFields } = require('./reasoning-options.cjs');

async function markupPreflightError(step, projectId, inputs, artifactStore, dynamicSource) {
  let markup;
  try { markup = await artifactStore.read(step.imageMarkupId); } catch { return '标注图已不可用，请重新选择本项目的透明PNG。'; }
  if (markup.projectId !== projectId || markup.mimeType !== 'image/png') return '标注图必须是当前项目的透明PNG，不能引用其他项目文件。';
  const source = dynamicSource ? markup : inputs.find(file => file.id !== step.imageMarkupId && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType));
  if (!source || source.projectId !== projectId) return '标注精修需要本项目的第一张PNG、JPEG或WebP原图，标注层不能代替原图。';
  try { await validateMarkup(markup, source); } catch (error) { return error.code === 'INVALID_IMAGE' ? error.message : '无法读取标注PNG，请重新保存透明标注层。'; }
  return undefined;
}

const modelStep = step => !['manual-review', 'export', 'animation-compose'].includes(step.kind);
const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit;
function replaceVariables(prompt, values) {
  const missing = new Set();
  const content = prompt.replace(/{{\s*([^{}\r\n]+?)\s*}}/g, (whole, name) => {
    const key = name.trim();
    if (!Object.hasOwn(values || {}, key) || !text(values[key], 10000)) { missing.add(key); return whole; }
    return values[key].trim();
  });
  return { content, missing: [...missing] };
}
function validateUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return '连接地址不能含账号密码或查询参数。';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return '真实连接需要 HTTPS，本机测试接口除外。';
    return '';
  } catch { return '连接地址无效。'; }
}
async function preflight(request, { credentials, modelRuntime, artifactStore, queryOnlyStepId, fxRates, localAnimationStatus, completedImageStepIds = new Set(), completedStepIds = new Set() }) {
  const errors = [], issues = [], warnings = [], steps = [];
  const addError = (message, field, stepId) => { errors.push(message); issues.push({ message, ...(stepId ? { stepId } : {}), ...(field ? { field } : {}) }); };
  const failure = (message, field) => ({ ok: false, errors: [message], issues: [{ message, ...(field ? { field } : {}) }], warnings, steps, unknownCost: true });
  const workflow = request?.workflow;
  const project = request?.project;
  if (!workflow || !project || !text(workflow.id, 160) || !text(project.id, 160) || !text(workflow.workspaceId, 160) || project.workspaceId !== workflow.workspaceId || project.kind !== workflow.outputKind) return failure('项目、工作区或作品类型不匹配。', 'project');
  if (!Number.isSafeInteger(project.costCents) || project.costCents < 0 || project.budgetCents != null && (!Number.isSafeInteger(project.budgetCents) || project.budgetCents < 0)) addError('项目成本或已填写的金额上限无效。', 'budgetCents');
  if (!text(request.input, 100000)) addError('请填写本次需求，最多 10 万字。', 'input');
  if (!Array.isArray(workflow.steps) || !workflow.steps.length || workflow.steps.length > 40) return failure('工作流需要 1 到 40 个步骤。');
  if (!Array.isArray(request.models) || !Array.isArray(request.connections) || !Array.isArray(request.attachmentIds) || request.attachmentIds.length > 16) return failure('模型、连接或附件配置无效；附件最多16份。', !Array.isArray(request.models) ? 'modelConfigId' : !Array.isArray(request.connections) ? 'connection' : 'attachments');
  const enabled = workflow.steps.filter(step => step.enabled);
  if (enabled.some(step => step.kind === 'animation-compose')) {
    let helper; try { helper = typeof localAnimationStatus === 'function' ? await localAnimationStatus() : undefined; } catch { /* The specific helper is not usable; no provider request starts. */ }
    if (!helper?.available) addError(helper?.reason || '本地动画工具尚不可用，未开始收费生成。', 'inputSource', enabled.find(step => step.kind === 'animation-compose').id);
  }
  if (request.purpose !== undefined && !['automation-plan', 'business-assist'].includes(request.purpose)) addError('任务用途不受支持，未开始模型请求。');
  if (request.purpose === 'automation-plan' && (workflow.steps.length !== 1 || enabled.length !== 1 || enabled[0].kind !== 'text' || enabled[0].role !== 'planner' || request.attachmentIds.length)) addError('AI规划只能执行一个无附件的文字规划步骤，不能混入制作、导出或其他操作。');
  if (request.purpose === 'business-assist' && (workflow.steps.length !== 1 || enabled.length !== 1 || !['text', 'vision'].includes(enabled[0].kind) || enabled[0].role !== 'planner')) addError('业务辅助只执行一个资料文字或识读步骤，不执行制作、导出或任意工具。');
  if (request.purpose !== undefined && (request.replaceWaitingReviewRunId !== undefined || request.replaceWaitingReviewAttemptId !== undefined || request.refinementFork !== undefined)) addError('辅助资料任务不会替代或取消已有制作任务。');
  if (request.refinementFork !== undefined && (!request.refinementFork || typeof request.refinementFork !== 'object' || !request.replaceWaitingReviewRunId || !text(request.refinementFork.reviewAttemptId, 160) || !text(request.refinementFork.sourceArtifactId, 160))) addError('精修接续的复核或原图引用无效，原任务没有改变。');
  const metadata = enabled.some(modelStep) ? await credentials.list() : [];
  const inputFiles = [];
  for (const id of enabled.some(step => step.referenceArtifactIds === undefined) ? request.attachmentIds : []) {
    try {
      const file = await artifactStore.read(id); inputFiles.push(file);
      if (file.kind === 'text' || file.kind === 'office') { try { await extractReferenceText(file); } catch (error) { addError(error.message, 'attachments'); } }
      if (file.mimeType === 'application/pdf') addError('当前 PDF 参考文件不执行 OCR 或正文提取，请先转换成文字或受支持的 Office 文件。', 'attachments');
    } catch { addError('有参考文件已不可用，请重新添加。', 'attachments'); }
  }
  if (!enabled.length) addError('请启用至少一个步骤。');
  if (enabled[0]?.inputSource === 'previous') addError('第一个启用步骤必须使用项目需求。', 'inputSource', enabled[0].id);
  const ids = new Set();
  let estimatedCents = 0, unknownCost = false, previousKind, previousModelStep;
  for (const step of enabled) {
    const previousInputKind = previousKind;
    let stepInputFiles = inputFiles;
    const referenceIssue = stepReferenceIssue(step);
    if (referenceIssue) addError(`“${step.name}”：${referenceIssue}`, 'attachments', step.id);
    else if (step.referenceArtifactIds !== undefined) {
      try { stepInputFiles = await explicitStepReferences(step, project.id, artifactStore); }
      catch (error) { stepInputFiles = []; addError(`“${step.name}”：${error.message}`, 'attachments', step.id); }
    }
    const stepInputKinds = new Set(stepInputFiles.map(file => file.kind));
    const inheritsAttachments = step.referenceArtifactIds === undefined && step.inputSource === 'previous';
    const detail = { id: step.id, name: step.name, kind: step.kind };
    steps.push(detail);
    if (!text(step.id, 160) || ids.has(step.id)) addError('工作流步骤 ID 无效或重复。', undefined, step.id);
    ids.add(step.id);
    if (!text(step.name, 100)) addError('请为每个步骤填写名称。', undefined, step.id);
    if (step.budgetCents != null && (!Number.isSafeInteger(step.budgetCents) || step.budgetCents < 0)) addError(`“${step.name}”的金额上限无效，请填写非负金额或留空。`, 'budgetCents', step.id);
    if (step.role !== undefined && !['planner', 'producer', 'reviewer'].includes(step.role)) addError(`“${step.name}”的职责无效。`, undefined, step.id);
    if (step.wallpaperTarget !== undefined) {
      const issue = wallpaperTargetError(step.wallpaperTarget);
      if (issue) addError(`“${step.name}”：${issue}`, 'wallpaperTarget', step.id);
      if (step.kind !== 'export' || project.kind !== 'image') addError(`“${step.name}”：壁纸目标仅能用于图片项目的本地导出步骤。`, 'wallpaperTarget', step.id);
      if (!Array.isArray(step.contentSourceStepIds) || !step.contentSourceStepIds.length) addError(`“${step.name}”：壁纸需要明确选择前面的实际PNG制作步骤。`, 'inputSource', step.id);
      else if (step.contentSourceStepIds.some(id => { const source = workflow.steps.find(item => item.id === id); return source && (source.imageOutputFormat ?? 'png') !== 'png'; })) addError(`“${step.name}”：壁纸制作步骤需要输出静态PNG，请先切换格式，未调用模型。`, 'imageOutputFormat', step.id);
    }
    if (step.engineeringReferenceId !== undefined) {
      if (step.wallpaperTarget !== undefined || step.kind !== 'export' || project.kind !== 'image') addError(`“${step.name}”：工程原图仅用于图片项目的本地导出，不能同时选择壁纸。`, 'engineeringReferenceId', step.id);
      try { await readEngineeringSource(id => artifactStore.read(id), { projectId: project.id, referenceId: step.engineeringReferenceId, attachmentIds: request.attachmentIds }); }
      catch (error) { addError(`“${step.name}”：${error.message}`, 'engineeringReferenceId', step.id); }
      const sourceIds = step.contentSourceStepIds;
      if (!Array.isArray(sourceIds) || !sourceIds.length) addError(`“${step.name}”：请选择本轮图片编辑成功生成的PNG步骤。`, 'inputSource', step.id);
      else if (sourceIds.some(id => { const source = workflow.steps.find(item => item.id === id); return !source || source.kind !== 'image-editing' || source.inputSource !== 'project' || source.imageSourceStepId !== undefined || source.imageMarkupId === step.engineeringReferenceId || (source.imageOutputFormat ?? 'png') !== 'png'; })) addError(`“${step.name}”：工程图片需要以本次首图为主画布进行PNG精修，不能采用纯文字生图或动态来源。`, 'inputSource', step.id);
    }
    if (step.qualityGate) {
      const policy = step.qualityGate;
      if (step.role !== 'reviewer' || !['text', 'vision'].includes(step.kind) || !Number.isSafeInteger(policy.maxRepairs) || policy.maxRepairs < 0 || policy.maxRepairs > 3 || policy.minScore !== undefined && (!Number.isFinite(policy.minScore) || policy.minScore < 0 || policy.minScore > 100)) addError(`“${step.name}”的独立检查参数无效。`, undefined, step.id);
      if (policy.maxRepairs > 0) { const source = workflow.steps.findIndex(item => item.id === policy.repairStepId && (item.enabled || completedStepIds.has(item.id)) && !['planner', 'reviewer'].includes(item.role) && ['text', 'image-generation', 'image-editing'].includes(item.kind)); if (source < 0 || source >= workflow.steps.indexOf(step)) addError(`“${step.name}”的自动修订来源必须是前面启用的制作步骤。`, 'inputSource', step.id); }
    }
    if (step.kind === 'export' && step.contentSourceStepId) {
      const source = workflow.steps.findIndex(item => item.id === step.contentSourceStepId && (item.enabled || completedStepIds.has(item.id)) && modelStep(item) && !['planner', 'reviewer'].includes(item.role));
      if (source < 0 || source >= workflow.steps.indexOf(step)) addError(`“${step.name}”的正文来源必须是前面启用的模型步骤。`, 'inputSource', step.id);
      else if (project.kind === 'image' && !['image-generation', 'image-editing'].includes(workflow.steps[source].kind)) addError(`“${step.name}”的最终成品来源必须是前面的图片制作或精修步骤。`, 'inputSource', step.id);
    }
    const imageSourceError = imageExportSourceError(step, workflow, project, completedStepIds);
    if (imageSourceError) addError(`“${step.name}”：${imageSourceError}`, 'inputSource', step.id);
    if (step.imageSourceStepId !== undefined && step.kind !== 'animation-compose') {
      const source = workflow.steps.find(item => item.id === step.imageSourceStepId);
      if (step.kind !== 'image-editing' || !text(step.imageSourceStepId, 160) || !source || !source.enabled && !completedImageStepIds.has(source.id) || !['image-generation', 'image-editing'].includes(source.kind) || workflow.steps.indexOf(source) >= workflow.steps.indexOf(step)) addError(`“${step.name}”的精修原图必须是前面启用并实际生成图片的步骤。`, 'inputSource', step.id);
    }
    if (step.documentImageSource !== undefined) {
      if (!['references', 'previous'].includes(step.documentImageSource) || step.kind !== 'text' || !['word', 'ppt'].includes(project.kind)) addError(`“${step.name}”的图文排版配置无效。`, 'inputSource', step.id);
      else if (step.documentImageSource === 'references') {
        let pictures = [];
        try { pictures = stepInputFiles.filter(item => item.kind === 'image'); } catch { /* Missing references already produce an attachment issue above. */ }
        if (!pictures.length || pictures.length > 12 || pictures.some(item => item.projectId !== project.id || !['image/png', 'image/jpeg', 'image/webp'].includes(item.mimeType))) addError(`“${step.name}”请选择当前项目的 1–12 张 PNG、JPEG 或 WebP 插图。`, 'attachments', step.id);
      } else if (previousKind !== 'image' && !(Array.isArray(step.documentImageStepIds) && step.documentImageStepIds.every(id => completedImageStepIds.has(id)))) addError(`“${step.name}”需要前一步先生成实际配图。`, 'inputSource', step.id);
      if (step.documentImageSource === 'previous' && step.kind === 'text' && ['word', 'ppt'].includes(project.kind)) {
        const sources = Array.isArray(step.documentImageStepIds) && step.documentImageStepIds.length ? step.documentImageStepIds.map(id => workflow.steps.find(item => item.id === id)) : [previousModelStep];
        if (sources.some(source => ['svg', 'gif'].includes(source?.imageOutputFormat))) addError(`“${step.name}”：Office配图请使用PNG/JPEG/WebP；SVG/GIF可在图片工作台单独生成下载。`, 'inputSource', step.id);
      }
    }
    if (step.documentImageStepIds !== undefined) {
      const imageIds = step.documentImageStepIds;
      if (step.documentImageSource !== 'previous' || step.kind !== 'text' || !Array.isArray(imageIds) || !imageIds.length || imageIds.length > 20 || new Set(imageIds).size !== imageIds.length) addError(`“${step.name}”的配图步骤列表无效。`, 'inputSource', step.id);
      else {
        const sources = imageIds.map(id => workflow.steps.find(item => item.id === id));
        if (sources.some(source => !source || !source.enabled && !completedImageStepIds.has(source.id) || !['image-generation', 'image-editing'].includes(source.kind) || workflow.steps.indexOf(source) >= workflow.steps.indexOf(step))) addError(`“${step.name}”的配图来源必须是前面启用的图片步骤。`, 'inputSource', step.id);
        else if (sources.reduce((total, source) => total + (source.count || 1), 0) > 20) addError(`“${step.name}”一次最多安排 20 张文档配图。`, 'count', step.id);
      }
    }
    if (step.kind === 'animation-compose') {
      detail.estimatedCents = 0;
      if (project.kind !== 'image') addError(`“${step.name}”：本地动画合成仅用于图片项目。`, 'inputSource', step.id);
      try { checkedAnimationWorkflowSettings(step.animation); } catch (error) { addError(`“${step.name}”：${error.message}`, 'inputSource', step.id); }
      if (step.imageSourceStepId !== undefined) {
        const source = workflow.steps.find(item => item.id === step.imageSourceStepId);
        if (!text(step.imageSourceStepId, 160) || !source || !source.enabled && !completedImageStepIds.has(source.id) || !['image-generation','image-editing'].includes(source.kind) || ['planner','reviewer'].includes(source.role) || workflow.steps.indexOf(source) >= workflow.steps.indexOf(step) || (source.imageOutputFormat ?? 'png') !== 'png' || (source.count ?? 1) !== 1 || step.referenceArtifactIds?.length) addError(`“${step.name}”：请选择前面实际生成一份PNG图集的图片制作步骤。`, 'inputSource', step.id);
      } else if (stepInputFiles.length !== 1 || stepInputFiles.some(file => file.projectId !== project.id || file.mimeType !== 'image/png' || file.trashedAt || file.unavailable)) addError(`“${step.name}”：需要明确选择本项目一张可读取的PNG图集，或选择前面的PNG制作步骤。`, 'attachments', step.id);
      previousKind = 'image'; previousModelStep = step;
    } else if (step.animation !== undefined) addError(`“${step.name}”：动画参数仅用于本地动画合成步骤。`, 'inputSource', step.id);
    if (!modelStep(step)) continue;
    if (inheritsAttachments && ['vision','image-editing'].includes(step.kind) && previousModelStep?.kind === 'animation-compose' && previousModelStep.animation?.mode === 'gif') addError(`“${step.name}”：GIF动画不能直接作为当前图片模型的参考，请在PNG图集合成前检查/精修，或明确选择静态参考图。`, 'inputSource', step.id);
    const hasInput = kind => stepInputKinds.has(kind) || (inheritsAttachments && previousKind === kind) || kind === 'image' && step.kind === 'image-editing' && !!step.imageSourceStepId;
    if (['vision', 'image-editing'].includes(step.kind) && !hasInput('image')) addError(`“${step.name}”需要参考图片，或前一步实际生成的图片。`, step.inputSource === 'previous' ? 'inputSource' : 'attachments', step.id);
    if (step.kind === 'transcription' && !hasInput('audio') && !hasInput('video')) addError(`“${step.name}”需要添加音频参考文件。`, step.inputSource === 'previous' ? 'inputSource' : 'attachments', step.id);
    if (step.kind === 'video-understanding' && !hasInput('video')) addError(`“${step.name}”需要添加视频文件，或前一步生成的视频。`, step.inputSource === 'previous' ? 'inputSource' : 'attachments', step.id);
    if (step.kind === 'image-generation' && stepInputKinds.has('image')) warnings.push(`“${step.name}”采用纯文字生图，不使用附图；需要保留人物或商品参考时请选择图片编辑步骤。`);
    previousKind = ['image-generation', 'image-editing'].includes(step.kind) ? 'image' : step.kind === 'speech' ? 'audio' : step.kind === 'video-generation' ? 'video' : 'text';
    previousModelStep = step;
    const resolved = replaceVariables(typeof step.prompt === 'string' ? step.prompt : '', request.variables || {});
    if (!text(step.prompt, 20000)) addError(`“${step.name}”需要提示词，最多 2 万字。`, 'prompt', step.id);
    if (resolved.missing.length) addError(`“${step.name}”缺少变量：${resolved.missing.join('、')}。`, 'variables', step.id);
    const model = request.models.find(item => item.id === step.modelConfigId && item.enabled && !item.demo);
    const connection = request.connections.find(item => item.id === model?.connectionId && item.enabled && !item.demo);
    const credential = metadata.find(item => item.id === step.credentialId && item.enabled && item.connectionId === connection?.id);
    if (!model || !connection) { addError(`“${step.name}”请选择启用的真实模型和连接。`, !model ? 'modelConfigId' : 'connection', step.id); continue; }
    if (step.reasoningEffort !== undefined) {
      if (!['text', 'vision', 'video-understanding'].includes(step.kind)) addError(`“${step.name}”的推理强度只用于文字或图像理解步骤。`, 'prompt', step.id);
      else try { reasoningRequestFields(connection, model, step.reasoningEffort); } catch (cause) { addError(`“${step.name}”：${cause.message}`, 'modelConfigId', step.id); }
    }
    const outputError = imageOptionsError(model.modelId, step.kind, { count: step.count, size: step.imageSize, background: step.imageBackground, outputFormat: step.imageOutputFormat, quality: step.imageQuality, complexity: step.imageComplexity, frameCount: step.imageFrameCount, frameDurationMs: step.imageFrameDurationMs, outputCompression: step.imageCompression, markupArtifactId: step.imageMarkupId, svgModel: step.imageSvgModel, svgReasoningEffort: step.imageSvgReasoningEffort });
    if (outputError) addError(`“${step.name}”：${outputError}`, 'prompt', step.id);
    const dynamicImage = !!step.imageSourceStepId || inheritsAttachments && previousInputKind === 'image';
    if (step.kind === 'image-editing' && !dynamicImage && stepInputFiles.some(file => file.id !== step.imageMarkupId && ['image/gif', 'image/svg+xml'].includes(file.mimeType))) addError(`“${step.name}”的精修原图仅支持PNG、JPEG或WebP，请先转换SVG或GIF。`, 'attachments', step.id);
    if (step.imageMarkupId && !outputError) {
      const markupError = await markupPreflightError(step, project.id, stepInputFiles, artifactStore, dynamicImage);
      if (markupError) addError(`“${step.name}”：${markupError}`, 'attachments', step.id);
      else if (dynamicImage) warnings.push(`“${step.name}”已检查标注层；原图生成后会再次核对尺寸，不匹配时不会发送该精修请求。`);
    }
    detail.modelName = model.name;
    const addressError = validateUrl(connection.baseUrl);
    if (addressError) addError(`${step.name}：${addressError}`, 'connection', step.id);
    else detail.domain = new URL(connection.baseUrl).host;
    if (!credential) addError(`“${step.name}”需要选择该连接下启用的 API Key。`, 'credentialId', step.id);
    else detail.credentialName = credential.name;
    if (!model.capabilities?.includes(step.kind) || !modelRuntime.supports(connection, step.kind)) addError(`“${step.name}”的模型能力或接口协议尚未适配。`, !model.capabilities?.includes(step.kind) ? 'modelConfigId' : 'connection', step.id);
    if (!Number.isInteger(step.maxOutputTokens ?? 2048) || (step.maxOutputTokens ?? 2048) < 16 || (step.maxOutputTokens ?? 2048) > 16384) addError(`“${step.name}”的最大输出需要在 16 到 16384 Token 之间。`, 'maxOutputTokens', step.id);
    if (!Number.isInteger(step.count ?? 1) || (step.count ?? 1) < 1 || (step.count ?? 1) > 4) addError(`“${step.name}”的生成数量应为 1 到 4。`, 'count', step.id);
    if (step.id === queryOnlyStepId) { detail.estimatedCents = 0; warnings.push(`“${step.name}”仅查询已提交任务，不新建生成请求；原请求费用仍需按历史流水核对。`); continue; }
    const estimate = estimateCost(model, step, `${resolved.content}\n${request.input}`, { modelId: model.modelId, connection, operation: step.kind, startedAt: new Date().toISOString(), fx: await fxRates?.get() });
    detail.costNote = estimate.reason;
    if (estimate.costState === 'unknown' || estimate.calculation && estimate.calculation.cnyAmount === undefined) { unknownCost = true; if (step.budgetCents === 0) addError(`“${step.name}”设置了零元上限，但费用尚不确定，请补全价格或清除此上限。`, 'budgetCents', step.id); }
    else { detail.estimatedCents = estimate.costCents; estimatedCents += estimate.costCents; if (step.budgetCents != null && estimate.costCents > step.budgetCents) addError(`“${step.name}”的估算费用超过单步预算。`, 'budgetCents', step.id); }
  }
  if (!enabled.some(step => ['export','animation-compose'].includes(step.kind))) warnings.push('流程未包含交付步骤；模型原始产物仍会保存，可单独打开和另存。');
  if (project.budgetCents != null && project.costCents + estimatedCents > project.budgetCents) addError('已知费用估算超过项目剩余预算。', 'budgetCents');
  if (project.budgetCents === 0 && unknownCost) addError('项目设置了零元上限，但有费用无法确定的模型步骤，请补全价格或清除此上限。', 'budgetCents');
  if (enabled.some(modelStep)) warnings.push('调用完成后按接口实际用量自动计算费用；开始前的用量估算不能保证远端扣费上限，取消请求仍可能产生费用。');
  else if (enabled.some(step => step.kind === 'animation-compose')) warnings.push('本次只在本地处理PNG图集和动画，不调用模型、不增加API费用；实际成品仍需人工检查。');
  if (unknownCost) warnings.push('部分步骤的实际用量在返回后才能确定；已支持的官方型号会自动计费，接口缺少计费用量时将保留具体原因。');
  return { ok: errors.length === 0, errors, issues, warnings, steps, estimatedCents: unknownCost ? undefined : estimatedCents, unknownCost };
}
module.exports = { preflight, replaceVariables, validateUrl, modelStep };
const { imageOptionsError } = require('./image-output-options.cjs');
