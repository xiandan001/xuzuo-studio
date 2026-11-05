// Generated from src/lib/spreadsheet-engine.ts; run scripts/build-spreadsheet-runtime.mjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_SPREADSHEET_FUNCTIONS = exports.SPREADSHEET_ENGINE_VERSION = exports.SPREADSHEET_LIMITS = void 0;
exports.columnLabel = columnLabel;
exports.parseCellAddress = parseCellAddress;
exports.cellFromInput = cellFromInput;
exports.cellToInput = cellToInput;
exports.validateSpreadsheetDocument = validateSpreadsheetDocument;
exports.calculateSpreadsheet = calculateSpreadsheet;
exports.calculateValidatedSpreadsheet = calculateValidatedSpreadsheet;
exports.spreadsheetDependencies = spreadsheetDependencies;
exports.SPREADSHEET_LIMITS = { sheets: 20, rows: 10000, columns: 100, cells: 100000, formulaLength: 8192, calculationSteps: 1000000 };
exports.SPREADSHEET_ENGINE_VERSION = '1.0.0';
exports.SUPPORTED_SPREADSHEET_FUNCTIONS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'ROUND', 'IF'];
const numericText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
function columnLabel(column) {
    if (!Number.isInteger(column) || column < 1 || column > 16384)
        throw new Error('列编号无效。');
    let label = '';
    for (let value = column; value > 0; value = Math.floor((value - 1) / 26))
        label = String.fromCharCode(65 + (value - 1) % 26) + label;
    return label;
}
function parseCellAddress(value) {
    const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(typeof value === 'string' ? value.trim() : '');
    if (!match)
        throw new Error('单元格地址应为 A1 形式。');
    const label = match[1].toUpperCase(), row = Number(match[2]);
    let column = 0;
    for (const letter of label)
        column = column * 26 + letter.charCodeAt(0) - 64;
    if (row > 1048576 || column > 16384)
        throw new Error('单元格地址超出 Excel 范围。');
    return { row, column, address: `${label}${row}` };
}
function cellFromInput(raw, previous) {
    const cell = { value: raw, ...(previous?.bold !== undefined ? { bold: previous.bold } : {}), ...(previous?.align ? { align: previous.align } : {}), ...(previous?.format ? { format: previous.format } : {}) };
    if (raw.startsWith('='))
        return { ...cell, value: null, formula: raw.slice(1) };
    if (raw.startsWith("'"))
        return { ...cell, value: raw.slice(1) };
    const trimmed = raw.trim();
    if (!trimmed)
        return { ...cell, value: null };
    if (/^(TRUE|FALSE)$/i.test(trimmed))
        return { ...cell, value: trimmed.toUpperCase() === 'TRUE' };
    const percent = trimmed.endsWith('%'), number = percent ? trimmed.slice(0, -1) : trimmed;
    if (numericText.test(number) && !/^[+-]?0\d/.test(number)) {
        const value = Number(number) / (percent ? 100 : 1);
        if (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
            return { ...cell, value, ...(percent ? { format: 'percent' } : {}) };
    }
    return cell;
}
function cellToInput(cell) {
    if (!cell)
        return '';
    if (cell.formula !== undefined)
        return `=${cell.formula}`;
    if (cell.value === null)
        return '';
    if (typeof cell.value === 'boolean')
        return cell.value ? 'TRUE' : 'FALSE';
    if (typeof cell.value === 'string') {
        const parsed = cellFromInput(cell.value);
        return parsed.formula !== undefined || parsed.value !== cell.value ? `'${cell.value}` : cell.value;
    }
    return String(cell.value);
}
function safeFormula(value) {
    if (typeof value !== 'string')
        throw new Error('公式需要是文字。');
    const formula = value.replace(/^=/, '').trim();
    if (formula.length > exports.SPREADSHEET_LIMITS.formulaLength)
        throw new Error('单个公式最多 8192 个字符。');
    if (/\[|\]|\||https?:|file:|\\\\|\b(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|EXEC|REGISTER(?:\.ID)?|INDIRECT|EVALUATE|GET\.WORKBOOK|SQL\.REQUEST)\s*\(/i.test(formula))
        throw new Error('暂不接受外部工作簿、外链或可能执行外部操作的公式。');
    return formula;
}
function validateSpreadsheetDocument(input) {
    if (!input || typeof input !== 'object')
        throw new Error('工作簿内容无效。');
    const value = input;
    if (value.schemaVersion !== 1 || value.kind !== 'excel' || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120 || !Array.isArray(value.sheets) || !value.sheets.length || value.sheets.length > exports.SPREADSHEET_LIMITS.sheets)
        throw new Error('工作簿需要标题和 1 至 20 张工作表。');
    const ids = new Set(), names = new Set();
    let cellCount = 0;
    const sheets = value.sheets.map(source => {
        if (!source || !validId(source.id) || ids.has(source.id) || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 31 || /[\\/*?:[\]]/.test(source.name) || /^'|'$/.test(source.name))
            throw new Error('工作表编号或名称无效，名称最多 31 字且不能包含 /\\*?:[]。');
        const name = source.name.trim(), nameKey = name.toLocaleLowerCase();
        if (names.has(nameKey))
            throw new Error('工作表名称不能重复。');
        ids.add(source.id);
        names.add(nameKey);
        if (!Number.isInteger(source.rowCount) || source.rowCount < 1 || source.rowCount > exports.SPREADSHEET_LIMITS.rows || !Number.isInteger(source.columnCount) || source.columnCount < 1 || source.columnCount > exports.SPREADSHEET_LIMITS.columns || !source.cells || typeof source.cells !== 'object' || Array.isArray(source.cells))
            throw new Error('每张工作表支持 1 至 10000 行、1 至 100 列。');
        const cells = {};
        for (const [rawAddress, raw] of Object.entries(source.cells)) {
            const address = parseCellAddress(rawAddress);
            if (address.row > source.rowCount || address.column > source.columnCount || Object.hasOwn(cells, address.address))
                throw new Error(`工作表“${name}”的单元格重复或超出声明行列，未丢弃数据。`);
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                throw new Error(`${name}!${address.address} 单元格格式无效。`);
            const cell = { value: null };
            if (raw.formula !== undefined)
                cell.formula = safeFormula(raw.formula);
            else {
                const item = raw.value;
                if (item !== null && !['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'string' && item.length > 32767 || typeof item === 'number' && (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item)))
                    throw new Error(`${name}!${address.address} 需要可靠的数字、文字、布尔值或空值。`);
                cell.value = item;
            }
            if (raw.bold !== undefined) {
                if (typeof raw.bold !== 'boolean')
                    throw new Error('加粗设置无效。');
                cell.bold = raw.bold;
            }
            if (raw.align !== undefined) {
                if (!['left', 'center', 'right'].includes(raw.align))
                    throw new Error('单元格对齐设置无效。');
                cell.align = raw.align;
            }
            if (raw.format !== undefined) {
                if (!['general', 'integer', 'number', 'currency', 'percent'].includes(raw.format))
                    throw new Error('单元格数字格式无效。');
                cell.format = raw.format;
            }
            cells[address.address] = cell;
            cellCount++;
            if (cellCount > exports.SPREADSHEET_LIMITS.cells)
                throw new Error('工作簿最多保存 100000 个非空单元格，请拆分。');
        }
        const columnWidths = {};
        if (source.columnWidths !== undefined) {
            if (!source.columnWidths || typeof source.columnWidths !== 'object' || Array.isArray(source.columnWidths))
                throw new Error('列宽设置无效。');
            for (const [label, width] of Object.entries(source.columnWidths)) {
                const column = parseCellAddress(`${label}1`);
                if (column.column > source.columnCount || column.address !== `${label}1` || typeof width !== 'number' || !Number.isFinite(width) || width < 64 || width > 640)
                    throw new Error('列宽需为 64–640 像素，且属于当前工作表。');
                columnWidths[label] = Math.round(width);
            }
        }
        const view = source.view;
        if (view !== undefined && (!view || typeof view.header !== 'boolean' || view.sort && (!Number.isInteger(view.sort.column) || view.sort.column < 1 || view.sort.column > source.columnCount || !['asc', 'desc'].includes(view.sort.direction)) || view.filter && (!Number.isInteger(view.filter.column) || view.filter.column < 1 || view.filter.column > source.columnCount || typeof view.filter.text !== 'string' || view.filter.text.length > 200)))
            throw new Error('查看排序或筛选条件无效。');
        return { id: source.id, name, rowCount: source.rowCount, columnCount: source.columnCount, cells, ...(Object.keys(columnWidths).length ? { columnWidths } : {}), ...(view ? { view: { header: view.header, ...(view.sort ? { sort: { column: view.sort.column, direction: view.sort.direction } } : {}), ...(view.filter ? { filter: { column: view.filter.column, text: view.filter.text } } : {}) } } : {}) };
    });
    return { schemaVersion: 1, kind: 'excel', title: value.title.trim(), sheets };
}
class FormulaFault extends Error {
    code;
    unsupported;
    constructor(code, message, unsupported = false) {
        super(message);
        this.code = code;
        this.unsupported = unsupported;
    }
}
const fault = (code, message, unsupported = false) => { throw new FormulaFault(code, message, unsupported); };
function tokenize(formula) {
    const tokens = [];
    let index = 0;
    while (index < formula.length) {
        const char = formula[index];
        if (/\s/.test(char)) {
            index++;
            continue;
        }
        if (char === '"' || char === "'") {
            const quote = char;
            let text = '';
            index++;
            let closed = false;
            while (index < formula.length) {
                const current = formula[index++];
                if (current === quote) {
                    if (formula[index] === quote) {
                        text += quote;
                        index++;
                    }
                    else {
                        closed = true;
                        break;
                    }
                }
                else
                    text += current;
            }
            if (!closed)
                fault('#ERROR!', '公式的引号没有闭合。');
            tokens.push({ kind: quote === '"' ? 'string' : 'quoted', text });
        }
        else {
            const remainder = formula.slice(index), number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(remainder), name = /^\$?[\p{L}_][\p{L}\p{N}_.$]*/u.exec(remainder);
            if (number) {
                tokens.push({ kind: 'number', text: number[0] });
                index += number[0].length;
            }
            else if (name) {
                tokens.push({ kind: 'name', text: name[0] });
                index += name[0].length;
            }
            else {
                const operator = /^(?:>=|<=|<>|[+\-*/%=<>(),:!;])/.exec(remainder);
                if (!operator)
                    return fault('#UNSUPPORTED!', `本地暂不支持公式符号“${char}”。`, true);
                tokens.push({ kind: 'symbol', text: operator[0] });
                index += operator[0].length;
            }
        }
        if (tokens.length > 2048)
            fault('#LIMIT!', '公式过于复杂，请拆分计算。');
    }
    return [...tokens, { kind: 'end', text: '' }];
}
function parseFormula(formula) {
    const tokens = tokenize(formula);
    let index = 0, depth = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];
    const accept = (symbol) => peek().text === symbol ? (index++, true) : false;
    const expect = (symbol) => { if (!accept(symbol))
        fault('#ERROR!', `公式缺少“${symbol}”。`); };
    function primary() {
        if (++depth > 100)
            fault('#LIMIT!', '公式嵌套过深，请拆分计算。');
        try {
            const token = take();
            if (token.kind === 'number')
                return { kind: 'literal', value: Number(token.text) };
            if (token.kind === 'string')
                return { kind: 'literal', value: token.text };
            if (token.text === '(') {
                const value = comparison();
                expect(')');
                return value;
            }
            if (token.kind !== 'name' && token.kind !== 'quoted')
                fault('#ERROR!', '公式缺少数字、单元格或函数。');
            if (accept('(')) {
                if (token.kind === 'quoted')
                    fault('#ERROR!', '函数名称不能用单引号。');
                const args = [];
                if (!accept(')')) {
                    for (;;) {
                        args.push([',', ';', ')'].includes(peek().text) ? { kind: 'literal', value: null } : comparison());
                        if (args.length > 255)
                            fault('#LIMIT!', '一个函数最多 255 个参数。');
                        if (accept(')'))
                            break;
                        if (!accept(',') && !accept(';'))
                            fault('#ERROR!', '函数参数之间需要逗号。');
                    }
                }
                return { kind: 'call', name: token.text.toUpperCase(), args };
            }
            let sheet, address = token.text;
            if (accept('!')) {
                sheet = token.text;
                const next = take();
                if (next.kind !== 'name')
                    fault('#REF!', '工作表后需要有效的单元格地址。');
                address = next.text;
            }
            else if (token.kind === 'name' && /^(TRUE|FALSE)$/i.test(token.text))
                return { kind: 'literal', value: token.text.toUpperCase() === 'TRUE' };
            else if (token.kind === 'quoted')
                fault('#ERROR!', '带空格的工作表名称后需要 ! 和单元格。');
            let canonical;
            try {
                canonical = parseCellAddress(address).address;
            }
            catch {
                return fault('#UNSUPPORTED!', `本地暂不支持命名范围或引用“${address}”。`, true);
            }
            if (accept(':')) {
                const end = take();
                let endAddress;
                try {
                    endAddress = parseCellAddress(end.text).address;
                }
                catch {
                    return fault('#REF!', '范围结尾需要有效的单元格地址。');
                }
                return { kind: 'range', start: canonical, end: endAddress, sheet };
            }
            return { kind: 'reference', address: canonical, sheet };
        }
        finally {
            depth--;
        }
    }
    function unary() { if (accept('+'))
        return { kind: 'unary', operator: '+', value: unary() }; if (accept('-'))
        return { kind: 'unary', operator: '-', value: unary() }; let value = primary(); while (accept('%'))
        value = { kind: 'unary', operator: '%', value }; return value; }
    function multiplication() { let value = unary(); while (['*', '/'].includes(peek().text)) {
        const operator = take().text;
        value = { kind: 'binary', operator, left: value, right: unary() };
    } return value; }
    function addition() { let value = multiplication(); while (['+', '-'].includes(peek().text)) {
        const operator = take().text;
        value = { kind: 'binary', operator, left: value, right: multiplication() };
    } return value; }
    function comparison() { let value = addition(); while (['=', '<>', '<', '>', '<=', '>='].includes(peek().text)) {
        const operator = take().text;
        value = { kind: 'binary', operator, left: value, right: addition() };
    } return value; }
    const tree = comparison();
    if (peek().kind !== 'end')
        fault('#ERROR!', '公式结尾存在无法识别的内容。');
    return tree;
}
function scalar(value) { if ('items' in value)
    return fault('#UNSUPPORTED!', '本地不计算返回整片范围的数组公式。', true); if (value.error)
    throw value.error; return value; }
function number(value) {
    const item = scalar(value).value;
    if (item === null || item === '')
        return 0;
    if (typeof item === 'number')
        return item;
    if (typeof item === 'boolean')
        return item ? 1 : 0;
    if (numericText.test(item.trim()))
        return Number(item);
    return fault('#VALUE!', '计算需要数字，引用中有不能转换的文字。');
}
function finite(value) {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))
        return fault('#NUM!', '结果超出本地可靠数字范围。');
    return Object.is(value, -0) ? 0 : value;
}
function truth(value) {
    const item = scalar(value).value;
    if (typeof item === 'boolean')
        return item;
    if (item === null || typeof item === 'number')
        return Boolean(item);
    if (/^(TRUE|FALSE)$/i.test(item))
        return item.toUpperCase() === 'TRUE';
    return fault('#VALUE!', 'IF 条件需要逻辑值或比较表达式。');
}
function compare(left, right) {
    if (left === null)
        left = typeof right === 'string' ? '' : typeof right === 'boolean' ? false : 0;
    if (right === null)
        right = typeof left === 'string' ? '' : typeof left === 'boolean' ? false : 0;
    if (typeof left !== typeof right) {
        const order = (value) => typeof value === 'boolean' ? 3 : typeof value === 'string' ? 2 : 1;
        return order(left) - order(right);
    }
    if (typeof left === 'string' && typeof right === 'string') {
        const a = left.toUpperCase(), b = right.toUpperCase();
        return a === b ? 0 : a < b ? -1 : 1;
    }
    return left === right ? 0 : left < right ? -1 : 1;
}
function round(value, requestedDigits) {
    const digits = Math.trunc(requestedDigits);
    if (digits > 15)
        return value;
    if (digits < -308)
        return 0;
    const shift = (item, places) => { const [coefficient, exponent = '0'] = item.toString().split('e'); return Number(`${coefficient}e${Number(exponent) + places}`); };
    const moved = shift(Math.abs(value), digits);
    if (!Number.isFinite(moved))
        return value;
    return finite(Math.sign(value) * shift(Math.round(moved), -digits));
}
function calculateSpreadsheet(input) {
    return calculateValidatedSpreadsheet(validateSpreadsheetDocument(input));
}
// The workbench cache passes only its normalized immutable validation result.
function calculateValidatedSpreadsheet(document, reusable) {
    const sheets = new Map(document.sheets.map(sheet => [sheet.name.toLocaleLowerCase(), sheet]));
    const cells = Object.fromEntries(document.sheets.map(sheet => [sheet.id, { ...reusable?.[sheet.id] }]));
    const visiting = new Set(), parsed = new Map();
    let steps = 0;
    const tick = () => { if (++steps > exports.SPREADSHEET_LIMITS.calculationSteps)
        fault('#LIMIT!', '计算量超过本地上限，请缩小公式范围或拆分工作簿。'); };
    const errorResult = (error) => { const value = error instanceof FormulaFault ? error : new FormulaFault('#ERROR!', '本地公式计算未完成。'); return { status: value.unsupported ? 'unsupported' : 'error', error: value.code, message: value.message }; };
    const atomFrom = (result) => ({ value: result.value ?? null, reference: true, ...(result.error ? { error: new FormulaFault(result.error, result.message || '引用的单元格无法计算。', result.status === 'unsupported') } : {}) });
    function cell(sheet, address) {
        tick();
        const position = parseCellAddress(address);
        if (position.row > sheet.rowCount || position.column > sheet.columnCount)
            return { status: 'error', error: '#REF!', message: '引用超出当前工作表的已声明行列。' };
        const cached = cells[sheet.id][address];
        if (cached)
            return cached;
        const source = sheet.cells[address];
        if (!source)
            return { status: 'value', value: null };
        if (source.formula === undefined)
            return cells[sheet.id][address] = { status: 'value', value: source.value };
        const id = `${sheet.id}!${address}`;
        if (visiting.has(id))
            return { status: 'error', error: '#CYCLE!', message: `检测到循环引用：${sheet.name}!${address}。` };
        if (visiting.size >= 100)
            return { status: 'error', error: '#LIMIT!', message: '公式依赖超过 100 层，请拆分计算。' };
        visiting.add(id);
        try {
            let tree = parsed.get(source.formula);
            if (!tree) {
                tree = parseFormula(source.formula);
                parsed.set(source.formula, tree);
            }
            const result = scalar(evaluate(tree, sheet)).value;
            return cells[sheet.id][address] = { status: 'calculated', value: typeof result === 'number' ? finite(result) : result ?? 0 };
        }
        catch (error) {
            return cells[sheet.id][address] = errorResult(error);
        }
        finally {
            visiting.delete(id);
        }
    }
    function referenced(name, sheet) { const result = name === undefined ? sheet : sheets.get(name.toLocaleLowerCase()); if (!result)
        return fault('#REF!', `找不到工作表“${name}”。`); return result; }
    function evaluate(node, sheet) {
        tick();
        if (node.kind === 'literal')
            return { value: typeof node.value === 'number' ? finite(node.value) : node.value, reference: false };
        if (node.kind === 'reference')
            return atomFrom(cell(referenced(node.sheet, sheet), node.address));
        if (node.kind === 'range') {
            const owner = referenced(node.sheet, sheet), from = parseCellAddress(node.start), to = parseCellAddress(node.end), items = [];
            const bottom = Math.max(from.row, to.row), right = Math.max(from.column, to.column);
            if (bottom > owner.rowCount || right > owner.columnCount)
                return fault('#REF!', '引用范围超出当前工作表。');
            for (let row = Math.min(from.row, to.row); row <= bottom; row++)
                for (let column = Math.min(from.column, to.column); column <= right; column++)
                    items.push(atomFrom(cell(owner, `${columnLabel(column)}${row}`)));
            return { items };
        }
        if (node.kind === 'unary') {
            const value = number(evaluate(node.value, sheet));
            return { value: finite(node.operator === '-' ? -value : node.operator === '%' ? value / 100 : value), reference: false };
        }
        if (node.kind === 'binary') {
            const left = evaluate(node.left, sheet), right = evaluate(node.right, sheet);
            if (['=', '<>', '<', '>', '<=', '>='].includes(node.operator)) {
                const result = compare(scalar(left).value, scalar(right).value);
                return { value: node.operator === '=' ? result === 0 : node.operator === '<>' ? result !== 0 : node.operator === '<' ? result < 0 : node.operator === '>' ? result > 0 : node.operator === '<=' ? result <= 0 : result >= 0, reference: false };
            }
            const a = number(left), b = number(right);
            if (node.operator === '/' && b === 0)
                return fault('#DIV/0!', '除数为零或空单元格。');
            return { value: finite(node.operator === '+' ? a + b : node.operator === '-' ? a - b : node.operator === '*' ? a * b : a / b), reference: false };
        }
        if (node.name === 'IF') {
            if (node.args.length < 2 || node.args.length > 3)
                return fault('#VALUE!', 'IF 需要条件、成立结果和可选的不成立结果。');
            return evaluate(truth(evaluate(node.args[0], sheet)) ? node.args[1] : node.args[2] || { kind: 'literal', value: false }, sheet);
        }
        if (node.name === 'ROUND') {
            if (node.args.length !== 2)
                return fault('#VALUE!', 'ROUND 需要数字和小数位数两个参数。');
            return { value: round(number(evaluate(node.args[0], sheet)), number(evaluate(node.args[1], sheet))), reference: false };
        }
        if (!['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(node.name))
            return fault('#UNSUPPORTED!', `本地暂不支持 ${node.name}，未生成假结果；可在 Excel/WPS 重算。`, true);
        const numbers = [];
        for (const arg of node.args) {
            let evaluated;
            try {
                evaluated = evaluate(arg, sheet);
            }
            catch (error) {
                if (node.name === 'COUNT' && error instanceof FormulaFault && !error.unsupported && !['#CYCLE!', '#LIMIT!', '#REF!'].includes(error.code))
                    continue;
                throw error;
            }
            for (const item of 'items' in evaluated ? evaluated.items : [evaluated]) {
                if (item.error) {
                    if (node.name === 'COUNT' && !item.error.unsupported && !['#CYCLE!', '#LIMIT!', '#REF!'].includes(item.error.code))
                        continue;
                    throw item.error;
                }
                if (item.reference && typeof item.value !== 'number' || item.value === null)
                    continue;
                if (node.name === 'COUNT') {
                    if (typeof item.value !== 'string' || numericText.test(item.value.trim()))
                        numbers.push(number(item));
                }
                else
                    numbers.push(number(item));
            }
        }
        if (node.name === 'COUNT')
            return { value: numbers.length, reference: false };
        if (node.name === 'AVERAGE' && !numbers.length)
            return fault('#DIV/0!', 'AVERAGE 范围中没有数字。');
        const result = node.name === 'MIN' ? numbers.length ? numbers.reduce((a, b) => Math.min(a, b)) : 0 : node.name === 'MAX' ? numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : 0 : numbers.reduce((a, b) => a + b, 0) / (node.name === 'AVERAGE' ? numbers.length : 1);
        return { value: finite(result), reference: false };
    }
    let formulaCount = 0, calculatedCount = 0;
    const issues = [];
    for (const sheet of document.sheets)
        for (const address of Object.keys(sheet.cells)) {
            let result;
            try {
                result = cell(sheet, address);
            }
            catch (error) {
                result = cells[sheet.id][address] = errorResult(error);
            }
            if (sheet.cells[address].formula !== undefined) {
                formulaCount++;
                if (result.status === 'calculated')
                    calculatedCount++;
            }
            if (result.status === 'error' || result.status === 'unsupported')
                issues.push({ sheetId: sheet.id, address, status: result.status, code: result.error || '#ERROR!', message: result.message || '未完成计算。' });
        }
    return { engineVersion: exports.SPREADSHEET_ENGINE_VERSION, cells, formulaCount, calculatedCount, issues, allFormulasValid: issues.length === 0 };
}
// A bounded conservative dependency graph includes both IF branches. If a
// workbook is too expensive or cannot be parsed, callers use the full engine.
function spreadsheetDependencies(document) {
    const sheets = new Map(document.sheets.map(sheet => [sheet.name.toLocaleLowerCase(), sheet]));
    const parents = new Map();
    let edges = 0, nodes = 0;
    function reference(owner, sheet, address) {
        if (++edges > 200000)
            throw new Error('dependency-budget');
        const key = `${sheet.id}!${parseCellAddress(address).address}`, values = parents.get(key) || new Set();
        values.add(owner);
        parents.set(key, values);
    }
    function visit(node, sheet, owner) {
        if (++nodes > 300000)
            throw new Error('dependency-budget');
        if (node.kind === 'reference' || node.kind === 'range') {
            const source = node.sheet === undefined ? sheet : sheets.get(node.sheet.toLocaleLowerCase());
            if (!source)
                throw new Error('missing-sheet');
            if (node.kind === 'reference')
                reference(owner, source, node.address);
            else {
                const first = parseCellAddress(node.start), last = parseCellAddress(node.end), bottom = Math.max(first.row, last.row), right = Math.max(first.column, last.column);
                if (bottom > source.rowCount || right > source.columnCount)
                    throw new Error('range-bounds');
                for (let row = Math.min(first.row, last.row); row <= bottom; row++)
                    for (let column = Math.min(first.column, last.column); column <= right; column++)
                        reference(owner, source, `${columnLabel(column)}${row}`);
            }
        }
        else if (node.kind === 'unary')
            visit(node.value, sheet, owner);
        else if (node.kind === 'binary') {
            visit(node.left, sheet, owner);
            visit(node.right, sheet, owner);
        }
        else if (node.kind === 'call')
            for (const argument of node.args)
                visit(argument, sheet, owner);
    }
    try {
        for (const sheet of document.sheets)
            for (const [address, cell] of Object.entries(sheet.cells))
                if (cell.formula !== undefined)
                    visit(parseFormula(cell.formula), sheet, `${sheet.id}!${address}`);
    }
    catch {
        return undefined;
    }
    return parents;
}
