export interface PromptResolution {
  content: string;
  missing: string[];
  complete: boolean;
}

const variablePattern = () => /{{\s*([^{}\r\n]+?)\s*}}/g;

/** 按首次出现顺序提取变量，同名变量只需要填写一次。 */
export function extractVariables(content: string): string[] {
  const names = [...content.matchAll(variablePattern())].map(match => match[1].trim());
  return [...new Set(names.filter(Boolean))];
}

/** 缺失字段保留原占位符；调用方必须检查 complete 后再应用。 */
export function resolvePrompt(content: string, values: Record<string, string>): PromptResolution {
  const names = extractVariables(content);
  const valueFor = (name: string) => Object.prototype.hasOwnProperty.call(values, name) && typeof values[name] === 'string' ? values[name].trim() : '';
  const missing = names.filter(name => !valueFor(name));
  const resolved = content.replace(variablePattern(), (placeholder: string, name: string) => valueFor(name.trim()) || placeholder);
  return { content: resolved, missing, complete: missing.length === 0 };
}
