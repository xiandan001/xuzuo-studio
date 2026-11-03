// Generated from src/lib/spreadsheet-delivery.ts; run scripts/build-spreadsheet-runtime.mjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spreadsheetDeliveryChecks = spreadsheetDeliveryChecks;
function spreadsheetDeliveryChecks(document, calculation, options) {
    const cells = document.sheets.flatMap(sheet => Object.values(sheet.cells));
    const hasContent = cells.some(cell => cell.formula !== undefined || cell.value !== null && String(cell.value).trim() !== '');
    const formulaCount = cells.filter(cell => cell.formula !== undefined).length;
    const formulasKnown = !!calculation && calculation.formulaCount === formulaCount;
    const formulasValid = formulasKnown && calculation.allFormulasValid === true && calculation.calculatedCount === formulaCount && calculation.issues.length === 0;
    const placeholders = /(?:\bTODO\b|\bXXX\b|lorem\s+ipsum|请(?:在此)?(?:填写|输入|补充)|示例数据|\[(?:待填写|待补充)[^\]]*\])/i.test([document.title, ...cells.map(cell => cell.value)].join('\n'));
    const missing = Object.values(document.sheets.find(sheet => sheet.id === 'generated-missing-inputs')?.cells || {}).filter(cell => typeof cell.value === 'string' && cell.value.trim()).length > 1;
    return [
        { id: 'saved', label: '当前工作簿已保存', status: options.saved ? 'passed' : 'failed', detail: options.saved ? '验收对应当前保存版本，修改后需重新检查。' : '保存当前编辑版本后再验收。' },
        { id: 'exported', label: '当前版本已导出 XLSX', status: options.exported ? 'passed' : 'unknown', detail: options.exported ? '已从当前版本生成真实 XLSX，仍需打开核对。' : '请保存并导出当前版本，已有旧文件不能证明本次编辑已导出。' },
        { id: 'content', label: '工作表有实际内容', status: hasContent && !!document.title.trim() ? 'passed' : 'failed', detail: hasContent ? `${document.sheets.length} 张工作表；请核对字段和数据完整性。` : '补充标题和实际数据，空白工作簿不能作为完成交付。' },
        { id: 'formulas', label: '受支持公式计算无错误', status: !formulasKnown ? 'unknown' : formulasValid ? 'passed' : 'failed', detail: !formulasKnown ? '公式计算结果尚未确认。' : formulasValid ? `${formulaCount} 个公式已计算；业务计算逻辑仍需人工核对。` : `${calculation.issues.length} 个公式问题；错误或不支持的公式不能视为通过。` },
        { id: 'placeholders', label: '明显占位文字已清理', status: placeholders ? 'failed' : 'passed', detail: '检查 TODO、XXX、请填写、示例数据等占位；不代表事实已核实。' },
        ...(missing ? [{ id: 'missing-inputs', label: '关键资料已补齐', status: 'unknown', detail: '生成时列出的关键缺项仍保存在“资料说明”工作表中，请补齐或确认并更新说明后验收。' }] : []),
        { id: 'facts', label: '数据、公式逻辑与客户要求已核对', status: 'manual', detail: '逐项核对金额、日期、单位、来源、公式引用范围和汇总逻辑。' },
        { id: 'layout', label: '实际 XLSX 已打开检查', status: 'manual', detail: '检查工作表顺序、列宽、数字格式、公式结果和打印排版。复杂 Excel 功能不在当前编辑器兼容范围内。' },
        { id: 'rights', label: '资料来源与使用范围已确认', status: 'manual', detail: '核对数据、模板、商标及其他资料是否适合本次交付用途。' },
    ];
}
