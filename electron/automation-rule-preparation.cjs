function normalizePreparation(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['questions', 'answers'].includes(key)) || !Array.isArray(value.questions) || value.questions.length > 20 || !value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) throw Error('运行前资料格式无效，请回到规则中补充资料。');
  const questions = value.questions.map(question => { if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw Error('运行前问题需要1至2000字的有效文字。'); return question.trim(); });
  if (new Set(questions).size !== questions.length) throw Error('运行前问题不能重复。');
  const entries = Object.entries(value.answers).map(([question, answer]) => { if (!questions.includes(question.trim()) || typeof answer !== 'string' || answer.length > 10000) throw Error('资料答案需要对应当前问题，单项最多10000字。'); return [question.trim(), answer]; });
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw Error('同一问题不能提交重复答案。');
  return { questions, answers: Object.fromEntries(entries) };
}
function assertPreparation(rule) {
  const value = normalizePreparation(rule.preparation);
  const missing = value?.questions.filter(question => !Object.hasOwn(value.answers, question) || !value.answers[question].trim()) || [];
  if (missing.length) throw Error(`还有${missing.length}项运行前资料未填写，请回到当前规则补资料：${missing.join('；')}`);
}
module.exports = { normalizePreparation, assertPreparation };
