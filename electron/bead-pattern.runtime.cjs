// Generated from src/lib/bead-pattern.ts and shared bead helpers; run scripts/build-bead-runtime.mjs.
'use strict';
const factories = {
"./bead-pattern": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceBeadColor = exports.editBeadCells = exports.beadTotals = exports.beadUsage = exports.createBeadPattern = exports.beadDocumentIssue = exports.beadProcurementIssue = exports.beadPatternIssue = exports.beadPaletteIssue = exports.beadSettingsIssue = exports.DEFAULT_BEAD_PROCUREMENT = exports.DEFAULT_BEAD_SETTINGS = void 0;
var bead_validation_1 = require("./bead-validation");
Object.defineProperty(exports, "DEFAULT_BEAD_SETTINGS", { enumerable: true, get: function () { return bead_validation_1.DEFAULT_BEAD_SETTINGS; } });
Object.defineProperty(exports, "DEFAULT_BEAD_PROCUREMENT", { enumerable: true, get: function () { return bead_validation_1.DEFAULT_BEAD_PROCUREMENT; } });
Object.defineProperty(exports, "beadSettingsIssue", { enumerable: true, get: function () { return bead_validation_1.beadSettingsIssue; } });
Object.defineProperty(exports, "beadPaletteIssue", { enumerable: true, get: function () { return bead_validation_1.beadPaletteIssue; } });
Object.defineProperty(exports, "beadPatternIssue", { enumerable: true, get: function () { return bead_validation_1.beadPatternIssue; } });
Object.defineProperty(exports, "beadProcurementIssue", { enumerable: true, get: function () { return bead_validation_1.beadProcurementIssue; } });
Object.defineProperty(exports, "beadDocumentIssue", { enumerable: true, get: function () { return bead_validation_1.beadDocumentIssue; } });
var bead_quantize_1 = require("./bead-quantize");
Object.defineProperty(exports, "createBeadPattern", { enumerable: true, get: function () { return bead_quantize_1.createBeadPattern; } });
var bead_procurement_1 = require("./bead-procurement");
Object.defineProperty(exports, "beadUsage", { enumerable: true, get: function () { return bead_procurement_1.beadUsage; } });
Object.defineProperty(exports, "beadTotals", { enumerable: true, get: function () { return bead_procurement_1.beadTotals; } });
Object.defineProperty(exports, "editBeadCells", { enumerable: true, get: function () { return bead_procurement_1.editBeadCells; } });
Object.defineProperty(exports, "replaceBeadColor", { enumerable: true, get: function () { return bead_procurement_1.replaceBeadColor; } });

},
"./bead-validation": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BEAD_PROCUREMENT = exports.DEFAULT_BEAD_SETTINGS = void 0;
exports.beadSettingsIssue = beadSettingsIssue;
exports.beadPaletteIssue = beadPaletteIssue;
exports.beadPatternIssue = beadPatternIssue;
exports.beadProcurementIssue = beadProcurementIssue;
exports.beadDocumentIssue = beadDocumentIssue;
exports.DEFAULT_BEAD_SETTINGS = { columns: 64, rows: 64, fit: 'contain', maxColors: 32, alphaThreshold: 128, boardColumns: 52, boardRows: 52 };
exports.DEFAULT_BEAD_PROCUREMENT = { copies: 1, lossPercent: 5, defaultPackSize: 1000, stock: {}, packSizes: {} };
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, maximum, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const codePattern = /^[A-Z0-9][A-Z0-9_-]{0,11}$/;
const idPattern = /^[A-Za-z0-9-]{1,120}$/;
function beadSettingsIssue(value) {
    if (!object(value))
        return '请填写拼豆格数和制图设置。';
    const settings = value;
    if (!integer(settings.columns, 8, 256) || !integer(settings.rows, 8, 256))
        return '列数和行数都请输入 8–256 的整数。';
    if (!['cover', 'contain'].includes(settings.fit))
        return '请选择完整保留或铺满裁切。';
    if (!integer(settings.maxColors, 0, 512))
        return '最多用色请输入 1–512 的整数，0 表示使用整套色卡。';
    if (!integer(settings.alphaThreshold, 0, 255))
        return '透明阈值请输入 0–255 的整数。';
    if (!integer(settings.boardColumns, 1, 256) || !integer(settings.boardRows, 1, 256))
        return '底板列数和行数都请输入 1–256 的整数。';
}
function beadPaletteIssue(value) {
    if (!object(value))
        return '请选择有效的拼豆色卡。';
    const palette = value;
    if (typeof palette.id !== 'string' || !idPattern.test(palette.id) || !text(palette.name, 120) || !text(palette.brand, 120) || !text(palette.version, 160))
        return '色卡名称、品牌、版本或编号无效。';
    if (!text(palette.sourceUrl, 1000, true) || palette.sourceUrl && !/^https:\/\/[^\s]+$/.test(palette.sourceUrl) || !text(palette.sourceNote, 4000, true) || !text(palette.license, 8000))
        return '色卡来源和许可信息无效，请重新导入。';
    if (!Array.isArray(palette.colors) || !palette.colors.length || palette.colors.length > 512)
        return '色卡需要包含 1–512 个颜色。';
    const codes = new Set();
    let automatic = 0;
    for (const color of palette.colors) {
        if (!object(color) || typeof color.code !== 'string' || !codePattern.test(color.code) || codes.has(color.code) || !text(color.name, 80) || typeof color.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.hex))
            return '色号需唯一且为 1–12 位大写字母、数字或横线；颜色名称和六位 Hex 需有效。';
        codes.add(color.code);
        if (!Array.isArray(color.rgb) || color.rgb.length !== 3)
            return `色号 ${color.code} 的 RGB 与 Hex 不一致。`;
        for (let index = 0; index < 3; index++)
            if (!integer(color.rgb[index], 0, 255) || color.rgb[index] !== parseInt(color.hex.slice(1 + index * 2, 3 + index * 2), 16))
                return `色号 ${color.code} 的 RGB 与 Hex 不一致。`;
        if (!['solid', 'transparent', 'special'].includes(color.kind) || typeof color.automatic !== 'boolean' || color.kind !== 'solid' && color.automatic)
            return `色号 ${color.code} 的材质或自动匹配设置无效。`;
        if (color.kind === 'solid' && color.automatic)
            automatic++;
    }
    if (!automatic)
        return '色卡至少需要一种可自动匹配的普通实心色。';
}
function beadPatternIssue(value) {
    if (!object(value))
        return '拼豆图纸内容无效。';
    const pattern = value;
    if (pattern.type !== 'xuzuo-bead-pattern' || pattern.version !== 1 || !integer(pattern.columns, 8, 256) || !integer(pattern.rows, 8, 256))
        return '图纸版本或格数无效。';
    const paletteIssue = beadPaletteIssue(pattern.palette);
    if (paletteIssue)
        return paletteIssue;
    if (!Array.isArray(pattern.cells) || pattern.cells.length !== pattern.columns * pattern.rows)
        return '图纸格子数量或色号索引无效，原文件保留。';
    for (const cell of pattern.cells)
        if (!integer(cell, 0, pattern.palette.colors.length))
            return '图纸格子数量或色号索引无效，原文件保留。';
}
function beadProcurementIssue(value) {
    if (!object(value))
        return '请填写有效的用量与采购设置。';
    const settings = value;
    if (!integer(settings.copies, 1, 10000))
        return '制作份数请输入 1–10000 的整数。';
    if (!Number.isFinite(settings.lossPercent) || settings.lossPercent < 0 || settings.lossPercent > 100 || Math.abs(Math.round(settings.lossPercent * 100) / 100 - settings.lossPercent) > 1e-9)
        return '预留损耗请输入 0–100%，最多两位小数。';
    if (!integer(settings.defaultPackSize, 1, 10000000))
        return '每包数量请输入 1–10000000 的整数。';
    for (const [name, map] of [['库存', settings.stock], ['每色包装量', settings.packSizes]]) {
        if (!object(map) || Object.keys(map).length > 512)
            return `${name}记录无效。`;
        for (const [code, count] of Object.entries(map))
            if (!codePattern.test(code) || !integer(count, name === '库存' ? 0 : 1, name === '库存' ? 1000000000 : 10000000))
                return `${name}中的 ${code} 需要有效的整数数量。`;
    }
}
function beadDocumentIssue(value) {
    if (!object(value))
        return '拼豆工程内容无效。';
    const document = value;
    if (document.type !== 'xuzuo-bead-document' || document.version !== 1 || typeof document.id !== 'string' || !idPattern.test(document.id) || typeof document.projectId !== 'string' || !idPattern.test(document.projectId) || !integer(document.revision, 0, Number.MAX_SAFE_INTEGER) || !text(document.title, 120))
        return '拼豆工程版本、名称或保存编号无效。';
    if (document.referenceId !== undefined && (typeof document.referenceId !== 'string' || !idPattern.test(document.referenceId)) || document.sourceSha256 !== undefined && (typeof document.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(document.sourceSha256)) || !text(document.updatedAt, 60) || !Number.isFinite(Date.parse(document.updatedAt)))
        return '拼豆工程的底图来源或时间无效。';
    const issue = beadSettingsIssue(document.settings) || beadPatternIssue(document.pattern) || beadProcurementIssue(document.procurement);
    if (issue)
        return issue;
    if (document.settings.columns !== document.pattern.columns || document.settings.rows !== document.pattern.rows)
        return '制图设置与实际网格大小不一致。';
}

},
"./bead-quantize": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBeadPattern = createBeadPattern;
const bead_validation_1 = require("./bead-validation");
// Oklab D65 conversion, public-domain coefficients: https://bottosson.github.io/posts/oklab/
function oklab(red, green, blue) {
    const linear = (channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
    const r = linear(red), g = linear(green), b = linear(blue);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function nearest(lab, colors) {
    let selected = colors[0].index, minimum = Infinity;
    for (const color of colors) {
        const distance = (lab[0] - color.lab[0]) ** 2 + (lab[1] - color.lab[1]) ** 2 + (lab[2] - color.lab[2]) ** 2;
        if (distance < minimum) {
            minimum = distance;
            selected = color.index;
        }
    }
    return selected;
}
function rasterIssue(raster) {
    if (!raster || !Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width < 1 || raster.height < 1 || raster.width > 1024 || raster.height > 1024 || !(raster.pixels instanceof Uint8Array || raster.pixels instanceof Uint8ClampedArray) || raster.pixels.byteLength !== raster.width * raster.height * 4 || raster.format !== undefined && !['rgba', 'bgra'].includes(raster.format))
        throw Error('底图像素数据无效；采样图最长边不能超过1024。');
}
function cellRgb(raster, settings, column, row) {
    const scale = settings.fit === 'cover' ? Math.max(settings.columns / raster.width, settings.rows / raster.height) : Math.min(settings.columns / raster.width, settings.rows / raster.height);
    const left = (settings.columns - raster.width * scale) / 2, top = (settings.rows - raster.height * scale) / 2;
    const x0 = Math.max(0, (column - left) / scale), x1 = Math.min(raster.width, (column + 1 - left) / scale);
    const y0 = Math.max(0, (row - top) / scale), y1 = Math.min(raster.height, (row + 1 - top) / scale);
    if (x0 >= x1 || y0 >= y1)
        return [0, 0, 0, 0];
    let alpha = 0, red = 0, green = 0, blue = 0;
    const redChannel = raster.format === 'bgra' ? 2 : 0, blueChannel = raster.format === 'bgra' ? 0 : 2;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
            const area = (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0));
            const at = (y * raster.width + x) * 4, a = raster.pixels[at + 3] / 255, weight = area * (raster.premultiplied ? 1 : a);
            alpha += a * area;
            red += raster.pixels[at + redChannel] * weight;
            green += raster.pixels[at + 1] * weight;
            blue += raster.pixels[at + blueChannel] * weight;
        }
    return alpha > 0 ? [Math.min(255, Math.round(red / alpha)), Math.min(255, Math.round(green / alpha)), Math.min(255, Math.round(blue / alpha)), Math.min(255, Math.round(alpha * scale * scale * 255))] : [0, 0, 0, 0];
}
function createBeadPattern(raster, settings, palette) {
    const issue = (0, bead_validation_1.beadSettingsIssue)(settings) || (0, bead_validation_1.beadPaletteIssue)(palette);
    if (issue)
        throw Error(issue);
    rasterIssue(raster);
    const colors = palette.colors.map((color, offset) => ({ index: offset + 1, lab: oklab(...color.rgb) })).filter(color => palette.colors[color.index - 1].automatic);
    const cells = new Array(settings.columns * settings.rows), samples = new Map(), mapped = new Map();
    const pixelKeys = new Int32Array(cells.length);
    pixelKeys.fill(-1);
    const counts = new Uint32Array(palette.colors.length + 1);
    for (let row = 0; row < settings.rows; row++)
        for (let column = 0; column < settings.columns; column++) {
            const at = row * settings.columns + column, [r, g, b, alpha] = cellRgb(raster, settings, column, row);
            if (alpha === 0 || alpha < settings.alphaThreshold) {
                cells[at] = 0;
                continue;
            }
            const key = r * 65536 + g * 256 + b;
            pixelKeys[at] = key;
            let index = mapped.get(key);
            if (index === undefined) {
                const lab = oklab(r, g, b);
                samples.set(key, lab);
                index = nearest(lab, colors);
                mapped.set(key, index);
            }
            cells[at] = index;
            counts[index]++;
        }
    const used = colors.filter(color => counts[color.index] > 0).sort((a, b) => counts[b.index] - counts[a.index] || a.index - b.index);
    if (settings.maxColors > 0 && used.length > settings.maxColors) {
        const limited = used.slice(0, settings.maxColors), remapped = new Map();
        for (let at = 0; at < cells.length; at++) {
            const key = pixelKeys[at];
            if (key < 0)
                continue;
            let index = remapped.get(key);
            if (index === undefined) {
                index = nearest(samples.get(key), limited);
                remapped.set(key, index);
            }
            cells[at] = index;
        }
    }
    return { type: 'xuzuo-bead-pattern', version: 1, columns: settings.columns, rows: settings.rows, palette: structuredClone(palette), cells };
}

},
"./bead-procurement": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beadTotals = beadTotals;
exports.beadUsage = beadUsage;
exports.editBeadCells = editBeadCells;
exports.replaceBeadColor = replaceBeadColor;
const bead_validation_1 = require("./bead-validation");
function colorCounts(pattern) {
    const issue = (0, bead_validation_1.beadPatternIssue)(pattern);
    if (issue)
        throw Error(issue);
    const counts = new Uint32Array(pattern.palette.colors.length + 1);
    for (const cell of pattern.cells)
        counts[cell]++;
    return counts;
}
function beadTotals(pattern) {
    const counts = colorCounts(pattern), totalCells = pattern.cells.length;
    return { totalCells, beads: totalCells - counts[0], emptyCells: counts[0], colorsUsed: [...counts].slice(1).filter(count => count > 0).length };
}
function beadUsage(pattern, procurement) {
    const issue = (0, bead_validation_1.beadProcurementIssue)(procurement);
    if (issue)
        throw Error(issue);
    const counts = colorCounts(pattern), basisPoints = Math.round(procurement.lossPercent * 100);
    return pattern.palette.colors.flatMap((color, index) => {
        const cells = counts[index + 1];
        if (!cells)
            return [];
        const required = cells * procurement.copies, reserve = Math.floor((required * basisPoints + 9999) / 10000);
        const stock = procurement.stock[color.code] ?? 0, shortage = Math.max(0, required + reserve - stock), packSize = procurement.packSizes[color.code] ?? procurement.defaultPackSize;
        return [{ code: color.code, name: color.name, hex: color.hex, kind: color.kind, cells, required, reserve, stock, shortage, packSize, bags: Math.ceil(shortage / packSize) }];
    }).sort((first, second) => second.cells - first.cells || first.code.localeCompare(second.code, 'en', { numeric: true }));
}
function editBeadCells(pattern, edits) {
    const issue = (0, bead_validation_1.beadPatternIssue)(pattern);
    if (issue)
        throw Error(issue);
    if (!Array.isArray(edits) || edits.length > pattern.cells.length * 2)
        throw Error('需要修改的格子或色号无效。');
    for (const edit of edits)
        if (!edit || !Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index >= pattern.cells.length || !Number.isSafeInteger(edit.value) || edit.value < 0 || edit.value > pattern.palette.colors.length)
            throw Error('需要修改的格子或色号无效。');
    if (!edits.length)
        return pattern;
    const cells = [...pattern.cells];
    for (const edit of edits)
        cells[edit.index] = edit.value;
    return { ...pattern, cells };
}
function replaceBeadColor(pattern, from, to) {
    const issue = (0, bead_validation_1.beadPatternIssue)(pattern);
    if (issue)
        throw Error(issue);
    if (![from, to].every(value => Number.isInteger(value) && value >= 0 && value <= pattern.palette.colors.length))
        throw Error('请选择有效的原色和替换色，0 表示空格。');
    return from === to ? pattern : { ...pattern, cells: pattern.cells.map(value => value === from ? to : value) };
}

},
"./bead-palettes": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBeadPalette = parseBeadPalette;
const bead_pattern_1 = require("./bead-pattern");
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
function field(value, fallback, label) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'string')
        throw Error(`${label}请填写文字。`);
    return value.trim();
}
function rgbValue(value, code) {
    if (!Array.isArray(value) || value.length !== 3 || value.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255))
        throw Error(`色号 ${code} 的 RGB 需要三个 0–255 的整数。`);
    return [value[0], value[1], value[2]];
}
function readColor(value, index) {
    if (!object(value))
        throw Error(`第 ${index + 1} 个颜色需要色号和颜色数据。`);
    const rawCode = field(value.code, '', '色号');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$/.test(rawCode))
        throw Error(`第 ${index + 1} 个色号需为 1–12 位字母、数字或横线。`);
    const code = rawCode.toUpperCase();
    if (value.hex !== undefined && (typeof value.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.hex)))
        throw Error(`色号 ${code} 需要有效的六位 Hex，例如 #FF0000。`);
    if (value.hex === undefined && value.rgb === undefined)
        throw Error(`色号 ${code} 缺少六位 Hex 或 RGB。`);
    const hex = typeof value.hex === 'string' ? value.hex.toUpperCase() : undefined;
    const rgb = value.rgb !== undefined ? rgbValue(value.rgb, code) : [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    const kind = value.kind === undefined ? 'solid' : value.kind;
    if (!['solid', 'transparent', 'special'].includes(kind))
        throw Error(`色号 ${code} 的材质请选择 solid、transparent 或 special。`);
    if (value.automatic !== undefined && typeof value.automatic !== 'boolean')
        throw Error(`色号 ${code} 的自动配色设置需要 true 或 false。`);
    return { code, name: field(value.name, code, '颜色名称'), hex: hex || '#' + rgb.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase(), rgb, kind: kind, automatic: kind === 'solid' && value.automatic !== false };
}
function parseBeadPalette(text) {
    if (typeof text !== 'string' || text.length > 1024 * 1024)
        throw Error('色卡文件不能超过 1MB。');
    let input;
    try {
        input = JSON.parse(text);
    }
    catch {
        throw Error('请导入有效的 JSON 色卡文件。');
    }
    if (!object(input) || !Array.isArray(input.colors) || !input.colors.length || input.colors.length > 512)
        throw Error('JSON 色卡对象需要包含 1–512 个 colors 颜色。');
    const palette = {
        id: `custom-${crypto.randomUUID()}`,
        name: field(input.name, '自定义色卡', '色卡名称'), brand: field(input.brand, '自定义', '品牌'), version: field(input.version, '用户导入-v1', '版本'),
        sourceUrl: field(input.sourceUrl, '', '来源网址'), sourceNote: field(input.sourceNote, '用户导入色卡，保留原始色号；透明和特殊材质不参与自动配色。', '来源说明'), license: field(input.license, '用户提供', '许可说明'),
        colors: input.colors.map(readColor),
    };
    const issue = (0, bead_pattern_1.beadPaletteIssue)(palette);
    if (issue)
        throw Error(issue);
    return palette;
}

},
"../data/bead-palettes": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BEAD_PALETTES = exports.DEFAULT_BEAD_PALETTE_ID = void 0;
exports.DEFAULT_BEAD_PALETTE_ID = 'mard-221-hansbug-178dafb';
const PINNED_DATA_LICENSE = "MIT License\n\nCopyright (c) 2026 HansBug\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this data and associated documentation files (the \"Data\"), to deal\nin the Data without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Data, and to permit persons to whom the Data is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Data.\n\nTHE DATA IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE DATA OR THE USE OR OTHER DEALINGS IN THE\nDATA.\n";
// Versioned source facts: do not merge code systems or infer bead material from a code.
exports.BEAD_PALETTES = [
    {
        id: "mard-221-hansbug-178dafb",
        name: "MARD 221 · 社区参考",
        brand: "MARD",
        version: "178dafbc9e77d3de556550dbd058270200129186/2026-05-19",
        sourceUrl: "https://github.com/HansBug/pindou-color-data/blob/178dafbc9e77d3de556550dbd058270200129186/mard-221-alfonse-doudou/colors.json",
        sourceNote: "社区参考屏幕色值，非品牌官方 RGB。固定 HansBug 版本 178dafbc（2026-05-19）；色号与 RGB 原样保留，不与其他来源混用。源数据将 H1 记为不透明 #FFFFFF，未标注透明材质，此版本按源字段保留，不凭色号推断实物材质。",
        license: PINNED_DATA_LICENSE,
        colors: [
            { "code": "A1", "name": "A1", "hex": "#FAF5CD", "rgb": [250, 245, 205], "kind": "solid", "automatic": true },
            { "code": "A2", "name": "A2", "hex": "#FCFED6", "rgb": [252, 254, 214], "kind": "solid", "automatic": true },
            { "code": "A3", "name": "A3", "hex": "#FCFF92", "rgb": [252, 255, 146], "kind": "solid", "automatic": true },
            { "code": "A4", "name": "A4", "hex": "#F7EC5C", "rgb": [247, 236, 92], "kind": "solid", "automatic": true },
            { "code": "A5", "name": "A5", "hex": "#F0D83A", "rgb": [240, 216, 58], "kind": "solid", "automatic": true },
            { "code": "A6", "name": "A6", "hex": "#FDA951", "rgb": [253, 169, 81], "kind": "solid", "automatic": true },
            { "code": "A7", "name": "A7", "hex": "#FA8C4F", "rgb": [250, 140, 79], "kind": "solid", "automatic": true },
            { "code": "A8", "name": "A8", "hex": "#FBDA4D", "rgb": [251, 218, 77], "kind": "solid", "automatic": true },
            { "code": "A9", "name": "A9", "hex": "#F79D5F", "rgb": [247, 157, 95], "kind": "solid", "automatic": true },
            { "code": "A10", "name": "A10", "hex": "#F47E38", "rgb": [244, 126, 56], "kind": "solid", "automatic": true },
            { "code": "A11", "name": "A11", "hex": "#FEDB99", "rgb": [254, 219, 153], "kind": "solid", "automatic": true },
            { "code": "A12", "name": "A12", "hex": "#FDA276", "rgb": [253, 162, 118], "kind": "solid", "automatic": true },
            { "code": "A13", "name": "A13", "hex": "#FEC667", "rgb": [254, 198, 103], "kind": "solid", "automatic": true },
            { "code": "A14", "name": "A14", "hex": "#F75842", "rgb": [247, 88, 66], "kind": "solid", "automatic": true },
            { "code": "A15", "name": "A15", "hex": "#FBF65E", "rgb": [251, 246, 94], "kind": "solid", "automatic": true },
            { "code": "A16", "name": "A16", "hex": "#FEFF97", "rgb": [254, 255, 151], "kind": "solid", "automatic": true },
            { "code": "A17", "name": "A17", "hex": "#FDE173", "rgb": [253, 225, 115], "kind": "solid", "automatic": true },
            { "code": "A18", "name": "A18", "hex": "#FCBF80", "rgb": [252, 191, 128], "kind": "solid", "automatic": true },
            { "code": "A19", "name": "A19", "hex": "#FD7E77", "rgb": [253, 126, 119], "kind": "solid", "automatic": true },
            { "code": "A20", "name": "A20", "hex": "#F9D666", "rgb": [249, 214, 102], "kind": "solid", "automatic": true },
            { "code": "A21", "name": "A21", "hex": "#FAE393", "rgb": [250, 227, 147], "kind": "solid", "automatic": true },
            { "code": "A22", "name": "A22", "hex": "#EDF878", "rgb": [237, 248, 120], "kind": "solid", "automatic": true },
            { "code": "A23", "name": "A23", "hex": "#E4C8BA", "rgb": [228, 200, 186], "kind": "solid", "automatic": true },
            { "code": "A24", "name": "A24", "hex": "#F3F6A9", "rgb": [243, 246, 169], "kind": "solid", "automatic": true },
            { "code": "A25", "name": "A25", "hex": "#FDF785", "rgb": [253, 247, 133], "kind": "solid", "automatic": true },
            { "code": "A26", "name": "A26", "hex": "#FFC734", "rgb": [255, 199, 52], "kind": "solid", "automatic": true },
            { "code": "B1", "name": "B1", "hex": "#DFF13B", "rgb": [223, 241, 59], "kind": "solid", "automatic": true },
            { "code": "B2", "name": "B2", "hex": "#64F343", "rgb": [100, 243, 67], "kind": "solid", "automatic": true },
            { "code": "B3", "name": "B3", "hex": "#A1F586", "rgb": [161, 245, 134], "kind": "solid", "automatic": true },
            { "code": "B4", "name": "B4", "hex": "#5FDF34", "rgb": [95, 223, 52], "kind": "solid", "automatic": true },
            { "code": "B5", "name": "B5", "hex": "#39E158", "rgb": [57, 225, 88], "kind": "solid", "automatic": true },
            { "code": "B6", "name": "B6", "hex": "#64E0A4", "rgb": [100, 224, 164], "kind": "solid", "automatic": true },
            { "code": "B7", "name": "B7", "hex": "#3EAE7C", "rgb": [62, 174, 124], "kind": "solid", "automatic": true },
            { "code": "B8", "name": "B8", "hex": "#1D9B54", "rgb": [29, 155, 84], "kind": "solid", "automatic": true },
            { "code": "B9", "name": "B9", "hex": "#2A5037", "rgb": [42, 80, 55], "kind": "solid", "automatic": true },
            { "code": "B10", "name": "B10", "hex": "#9AD1BA", "rgb": [154, 209, 186], "kind": "solid", "automatic": true },
            { "code": "B11", "name": "B11", "hex": "#627032", "rgb": [98, 112, 50], "kind": "solid", "automatic": true },
            { "code": "B12", "name": "B12", "hex": "#1A6E3D", "rgb": [26, 110, 61], "kind": "solid", "automatic": true },
            { "code": "B13", "name": "B13", "hex": "#C8E87D", "rgb": [200, 232, 125], "kind": "solid", "automatic": true },
            { "code": "B14", "name": "B14", "hex": "#ABE84F", "rgb": [171, 232, 79], "kind": "solid", "automatic": true },
            { "code": "B15", "name": "B15", "hex": "#305335", "rgb": [48, 83, 53], "kind": "solid", "automatic": true },
            { "code": "B16", "name": "B16", "hex": "#C0ED9C", "rgb": [192, 237, 156], "kind": "solid", "automatic": true },
            { "code": "B17", "name": "B17", "hex": "#9EB33E", "rgb": [158, 179, 62], "kind": "solid", "automatic": true },
            { "code": "B18", "name": "B18", "hex": "#E6ED4F", "rgb": [230, 237, 79], "kind": "solid", "automatic": true },
            { "code": "B19", "name": "B19", "hex": "#26B78E", "rgb": [38, 183, 142], "kind": "solid", "automatic": true },
            { "code": "B20", "name": "B20", "hex": "#CBECCF", "rgb": [203, 236, 207], "kind": "solid", "automatic": true },
            { "code": "B21", "name": "B21", "hex": "#18616A", "rgb": [24, 97, 106], "kind": "solid", "automatic": true },
            { "code": "B22", "name": "B22", "hex": "#0A4241", "rgb": [10, 66, 65], "kind": "solid", "automatic": true },
            { "code": "B23", "name": "B23", "hex": "#343B1A", "rgb": [52, 59, 26], "kind": "solid", "automatic": true },
            { "code": "B24", "name": "B24", "hex": "#E8FAA6", "rgb": [232, 250, 166], "kind": "solid", "automatic": true },
            { "code": "B25", "name": "B25", "hex": "#4E846D", "rgb": [78, 132, 109], "kind": "solid", "automatic": true },
            { "code": "B26", "name": "B26", "hex": "#907C35", "rgb": [144, 124, 53], "kind": "solid", "automatic": true },
            { "code": "B27", "name": "B27", "hex": "#D0E0AF", "rgb": [208, 224, 175], "kind": "solid", "automatic": true },
            { "code": "B28", "name": "B28", "hex": "#9EE5BB", "rgb": [158, 229, 187], "kind": "solid", "automatic": true },
            { "code": "B29", "name": "B29", "hex": "#C6DF5F", "rgb": [198, 223, 95], "kind": "solid", "automatic": true },
            { "code": "B30", "name": "B30", "hex": "#E3FBB1", "rgb": [227, 251, 177], "kind": "solid", "automatic": true },
            { "code": "B31", "name": "B31", "hex": "#B4E691", "rgb": [180, 230, 145], "kind": "solid", "automatic": true },
            { "code": "B32", "name": "B32", "hex": "#92AD60", "rgb": [146, 173, 96], "kind": "solid", "automatic": true },
            { "code": "C1", "name": "C1", "hex": "#F0FEE4", "rgb": [240, 254, 228], "kind": "solid", "automatic": true },
            { "code": "C2", "name": "C2", "hex": "#ABF8FE", "rgb": [171, 248, 254], "kind": "solid", "automatic": true },
            { "code": "C3", "name": "C3", "hex": "#A2E0F7", "rgb": [162, 224, 247], "kind": "solid", "automatic": true },
            { "code": "C4", "name": "C4", "hex": "#44CDFB", "rgb": [68, 205, 251], "kind": "solid", "automatic": true },
            { "code": "C5", "name": "C5", "hex": "#06AADF", "rgb": [6, 170, 223], "kind": "solid", "automatic": true },
            { "code": "C6", "name": "C6", "hex": "#54A7E9", "rgb": [84, 167, 233], "kind": "solid", "automatic": true },
            { "code": "C7", "name": "C7", "hex": "#3977CA", "rgb": [57, 119, 202], "kind": "solid", "automatic": true },
            { "code": "C8", "name": "C8", "hex": "#0F52BD", "rgb": [15, 82, 189], "kind": "solid", "automatic": true },
            { "code": "C9", "name": "C9", "hex": "#3349C3", "rgb": [51, 73, 195], "kind": "solid", "automatic": true },
            { "code": "C10", "name": "C10", "hex": "#3CBCE3", "rgb": [60, 188, 227], "kind": "solid", "automatic": true },
            { "code": "C11", "name": "C11", "hex": "#2ADED3", "rgb": [42, 222, 211], "kind": "solid", "automatic": true },
            { "code": "C12", "name": "C12", "hex": "#1E334E", "rgb": [30, 51, 78], "kind": "solid", "automatic": true },
            { "code": "C13", "name": "C13", "hex": "#CDE7FE", "rgb": [205, 231, 254], "kind": "solid", "automatic": true },
            { "code": "C14", "name": "C14", "hex": "#D5FCF7", "rgb": [213, 252, 247], "kind": "solid", "automatic": true },
            { "code": "C15", "name": "C15", "hex": "#21C5C4", "rgb": [33, 197, 196], "kind": "solid", "automatic": true },
            { "code": "C16", "name": "C16", "hex": "#1858A2", "rgb": [24, 88, 162], "kind": "solid", "automatic": true },
            { "code": "C17", "name": "C17", "hex": "#02D1F3", "rgb": [2, 209, 243], "kind": "solid", "automatic": true },
            { "code": "C18", "name": "C18", "hex": "#213244", "rgb": [33, 50, 68], "kind": "solid", "automatic": true },
            { "code": "C19", "name": "C19", "hex": "#18869D", "rgb": [24, 134, 157], "kind": "solid", "automatic": true },
            { "code": "C20", "name": "C20", "hex": "#1A70A9", "rgb": [26, 112, 169], "kind": "solid", "automatic": true },
            { "code": "C21", "name": "C21", "hex": "#BCDDFC", "rgb": [188, 221, 252], "kind": "solid", "automatic": true },
            { "code": "C22", "name": "C22", "hex": "#6BB1BB", "rgb": [107, 177, 187], "kind": "solid", "automatic": true },
            { "code": "C23", "name": "C23", "hex": "#C8E2FD", "rgb": [200, 226, 253], "kind": "solid", "automatic": true },
            { "code": "C24", "name": "C24", "hex": "#7EC5F9", "rgb": [126, 197, 249], "kind": "solid", "automatic": true },
            { "code": "C25", "name": "C25", "hex": "#A9E8E0", "rgb": [169, 232, 224], "kind": "solid", "automatic": true },
            { "code": "C26", "name": "C26", "hex": "#42ADCF", "rgb": [66, 173, 207], "kind": "solid", "automatic": true },
            { "code": "C27", "name": "C27", "hex": "#D0DEF9", "rgb": [208, 222, 249], "kind": "solid", "automatic": true },
            { "code": "C28", "name": "C28", "hex": "#BDCEE8", "rgb": [189, 206, 232], "kind": "solid", "automatic": true },
            { "code": "C29", "name": "C29", "hex": "#364A89", "rgb": [54, 74, 137], "kind": "solid", "automatic": true },
            { "code": "D1", "name": "D1", "hex": "#ACB7EF", "rgb": [172, 183, 239], "kind": "solid", "automatic": true },
            { "code": "D2", "name": "D2", "hex": "#868DD3", "rgb": [134, 141, 211], "kind": "solid", "automatic": true },
            { "code": "D3", "name": "D3", "hex": "#3554AF", "rgb": [53, 84, 175], "kind": "solid", "automatic": true },
            { "code": "D4", "name": "D4", "hex": "#162D7B", "rgb": [22, 45, 123], "kind": "solid", "automatic": true },
            { "code": "D5", "name": "D5", "hex": "#B34EC6", "rgb": [179, 78, 198], "kind": "solid", "automatic": true },
            { "code": "D6", "name": "D6", "hex": "#B37BDC", "rgb": [179, 123, 220], "kind": "solid", "automatic": true },
            { "code": "D7", "name": "D7", "hex": "#8758A9", "rgb": [135, 88, 169], "kind": "solid", "automatic": true },
            { "code": "D8", "name": "D8", "hex": "#E3D2FE", "rgb": [227, 210, 254], "kind": "solid", "automatic": true },
            { "code": "D9", "name": "D9", "hex": "#D5B9F4", "rgb": [213, 185, 244], "kind": "solid", "automatic": true },
            { "code": "D10", "name": "D10", "hex": "#301A49", "rgb": [48, 26, 73], "kind": "solid", "automatic": true },
            { "code": "D11", "name": "D11", "hex": "#BEB9E2", "rgb": [190, 185, 226], "kind": "solid", "automatic": true },
            { "code": "D12", "name": "D12", "hex": "#DC99CE", "rgb": [220, 153, 206], "kind": "solid", "automatic": true },
            { "code": "D13", "name": "D13", "hex": "#B5038D", "rgb": [181, 3, 141], "kind": "solid", "automatic": true },
            { "code": "D14", "name": "D14", "hex": "#862993", "rgb": [134, 41, 147], "kind": "solid", "automatic": true },
            { "code": "D15", "name": "D15", "hex": "#2F1F8C", "rgb": [47, 31, 140], "kind": "solid", "automatic": true },
            { "code": "D16", "name": "D16", "hex": "#E2E4F0", "rgb": [226, 228, 240], "kind": "solid", "automatic": true },
            { "code": "D17", "name": "D17", "hex": "#C7D3F9", "rgb": [199, 211, 249], "kind": "solid", "automatic": true },
            { "code": "D18", "name": "D18", "hex": "#9A64B8", "rgb": [154, 100, 184], "kind": "solid", "automatic": true },
            { "code": "D19", "name": "D19", "hex": "#D8C2D9", "rgb": [216, 194, 217], "kind": "solid", "automatic": true },
            { "code": "D20", "name": "D20", "hex": "#9A35AD", "rgb": [154, 53, 173], "kind": "solid", "automatic": true },
            { "code": "D21", "name": "D21", "hex": "#940595", "rgb": [148, 5, 149], "kind": "solid", "automatic": true },
            { "code": "D22", "name": "D22", "hex": "#38389A", "rgb": [56, 56, 154], "kind": "solid", "automatic": true },
            { "code": "D23", "name": "D23", "hex": "#EADBF8", "rgb": [234, 219, 248], "kind": "solid", "automatic": true },
            { "code": "D24", "name": "D24", "hex": "#768AE1", "rgb": [118, 138, 225], "kind": "solid", "automatic": true },
            { "code": "D25", "name": "D25", "hex": "#4950C2", "rgb": [73, 80, 194], "kind": "solid", "automatic": true },
            { "code": "D26", "name": "D26", "hex": "#D6C6EB", "rgb": [214, 198, 235], "kind": "solid", "automatic": true },
            { "code": "E1", "name": "E1", "hex": "#F6D4CB", "rgb": [246, 212, 203], "kind": "solid", "automatic": true },
            { "code": "E2", "name": "E2", "hex": "#FCC1DD", "rgb": [252, 193, 221], "kind": "solid", "automatic": true },
            { "code": "E3", "name": "E3", "hex": "#F6BDE8", "rgb": [246, 189, 232], "kind": "solid", "automatic": true },
            { "code": "E4", "name": "E4", "hex": "#E8649E", "rgb": [232, 100, 158], "kind": "solid", "automatic": true },
            { "code": "E5", "name": "E5", "hex": "#F0569F", "rgb": [240, 86, 159], "kind": "solid", "automatic": true },
            { "code": "E6", "name": "E6", "hex": "#EB4172", "rgb": [235, 65, 114], "kind": "solid", "automatic": true },
            { "code": "E7", "name": "E7", "hex": "#C53674", "rgb": [197, 54, 116], "kind": "solid", "automatic": true },
            { "code": "E8", "name": "E8", "hex": "#FDDBE9", "rgb": [253, 219, 233], "kind": "solid", "automatic": true },
            { "code": "E9", "name": "E9", "hex": "#E376C7", "rgb": [227, 118, 199], "kind": "solid", "automatic": true },
            { "code": "E10", "name": "E10", "hex": "#D13B95", "rgb": [209, 59, 149], "kind": "solid", "automatic": true },
            { "code": "E11", "name": "E11", "hex": "#F7DAD4", "rgb": [247, 218, 212], "kind": "solid", "automatic": true },
            { "code": "E12", "name": "E12", "hex": "#F693BF", "rgb": [246, 147, 191], "kind": "solid", "automatic": true },
            { "code": "E13", "name": "E13", "hex": "#B5026A", "rgb": [181, 2, 106], "kind": "solid", "automatic": true },
            { "code": "E14", "name": "E14", "hex": "#FAD4BF", "rgb": [250, 212, 191], "kind": "solid", "automatic": true },
            { "code": "E15", "name": "E15", "hex": "#F5C9CA", "rgb": [245, 201, 202], "kind": "solid", "automatic": true },
            { "code": "E16", "name": "E16", "hex": "#FBF4EC", "rgb": [251, 244, 236], "kind": "solid", "automatic": true },
            { "code": "E17", "name": "E17", "hex": "#F7E3EC", "rgb": [247, 227, 236], "kind": "solid", "automatic": true },
            { "code": "E18", "name": "E18", "hex": "#F9C8DB", "rgb": [249, 200, 219], "kind": "solid", "automatic": true },
            { "code": "E19", "name": "E19", "hex": "#F6BBD1", "rgb": [246, 187, 209], "kind": "solid", "automatic": true },
            { "code": "E20", "name": "E20", "hex": "#D7C6CE", "rgb": [215, 198, 206], "kind": "solid", "automatic": true },
            { "code": "E21", "name": "E21", "hex": "#C09DA4", "rgb": [192, 157, 164], "kind": "solid", "automatic": true },
            { "code": "E22", "name": "E22", "hex": "#B38C9F", "rgb": [179, 140, 159], "kind": "solid", "automatic": true },
            { "code": "E23", "name": "E23", "hex": "#937D8A", "rgb": [147, 125, 138], "kind": "solid", "automatic": true },
            { "code": "E24", "name": "E24", "hex": "#DEBEE5", "rgb": [222, 190, 229], "kind": "solid", "automatic": true },
            { "code": "F1", "name": "F1", "hex": "#FE9381", "rgb": [254, 147, 129], "kind": "solid", "automatic": true },
            { "code": "F2", "name": "F2", "hex": "#F63D4B", "rgb": [246, 61, 75], "kind": "solid", "automatic": true },
            { "code": "F3", "name": "F3", "hex": "#EE4E3E", "rgb": [238, 78, 62], "kind": "solid", "automatic": true },
            { "code": "F4", "name": "F4", "hex": "#FB2A40", "rgb": [251, 42, 64], "kind": "solid", "automatic": true },
            { "code": "F5", "name": "F5", "hex": "#E10328", "rgb": [225, 3, 40], "kind": "solid", "automatic": true },
            { "code": "F6", "name": "F6", "hex": "#913635", "rgb": [145, 54, 53], "kind": "solid", "automatic": true },
            { "code": "F7", "name": "F7", "hex": "#911932", "rgb": [145, 25, 50], "kind": "solid", "automatic": true },
            { "code": "F8", "name": "F8", "hex": "#BB0126", "rgb": [187, 1, 38], "kind": "solid", "automatic": true },
            { "code": "F9", "name": "F9", "hex": "#E0677A", "rgb": [224, 103, 122], "kind": "solid", "automatic": true },
            { "code": "F10", "name": "F10", "hex": "#874628", "rgb": [135, 70, 40], "kind": "solid", "automatic": true },
            { "code": "F11", "name": "F11", "hex": "#592323", "rgb": [89, 35, 35], "kind": "solid", "automatic": true },
            { "code": "F12", "name": "F12", "hex": "#F3536B", "rgb": [243, 83, 107], "kind": "solid", "automatic": true },
            { "code": "F13", "name": "F13", "hex": "#F45C45", "rgb": [244, 92, 69], "kind": "solid", "automatic": true },
            { "code": "F14", "name": "F14", "hex": "#FCADB2", "rgb": [252, 173, 178], "kind": "solid", "automatic": true },
            { "code": "F15", "name": "F15", "hex": "#D50527", "rgb": [213, 5, 39], "kind": "solid", "automatic": true },
            { "code": "F16", "name": "F16", "hex": "#F8C0A9", "rgb": [248, 192, 169], "kind": "solid", "automatic": true },
            { "code": "F17", "name": "F17", "hex": "#E89B7D", "rgb": [232, 155, 125], "kind": "solid", "automatic": true },
            { "code": "F18", "name": "F18", "hex": "#D07F4A", "rgb": [208, 127, 74], "kind": "solid", "automatic": true },
            { "code": "F19", "name": "F19", "hex": "#BE454A", "rgb": [190, 69, 74], "kind": "solid", "automatic": true },
            { "code": "F20", "name": "F20", "hex": "#C69495", "rgb": [198, 148, 149], "kind": "solid", "automatic": true },
            { "code": "F21", "name": "F21", "hex": "#F2B8C6", "rgb": [242, 184, 198], "kind": "solid", "automatic": true },
            { "code": "F22", "name": "F22", "hex": "#F7C3D0", "rgb": [247, 195, 208], "kind": "solid", "automatic": true },
            { "code": "F23", "name": "F23", "hex": "#ED806C", "rgb": [237, 128, 108], "kind": "solid", "automatic": true },
            { "code": "F24", "name": "F24", "hex": "#E09DAF", "rgb": [224, 157, 175], "kind": "solid", "automatic": true },
            { "code": "F25", "name": "F25", "hex": "#E84854", "rgb": [232, 72, 84], "kind": "solid", "automatic": true },
            { "code": "G1", "name": "G1", "hex": "#FFE4D3", "rgb": [255, 228, 211], "kind": "solid", "automatic": true },
            { "code": "G2", "name": "G2", "hex": "#FCC6AC", "rgb": [252, 198, 172], "kind": "solid", "automatic": true },
            { "code": "G3", "name": "G3", "hex": "#F1C4A5", "rgb": [241, 196, 165], "kind": "solid", "automatic": true },
            { "code": "G4", "name": "G4", "hex": "#DCB387", "rgb": [220, 179, 135], "kind": "solid", "automatic": true },
            { "code": "G5", "name": "G5", "hex": "#E7B34E", "rgb": [231, 179, 78], "kind": "solid", "automatic": true },
            { "code": "G6", "name": "G6", "hex": "#E3A014", "rgb": [227, 160, 20], "kind": "solid", "automatic": true },
            { "code": "G7", "name": "G7", "hex": "#985C3A", "rgb": [152, 92, 58], "kind": "solid", "automatic": true },
            { "code": "G8", "name": "G8", "hex": "#713D2F", "rgb": [113, 61, 47], "kind": "solid", "automatic": true },
            { "code": "G9", "name": "G9", "hex": "#E4B685", "rgb": [228, 182, 133], "kind": "solid", "automatic": true },
            { "code": "G10", "name": "G10", "hex": "#DA8C42", "rgb": [218, 140, 66], "kind": "solid", "automatic": true },
            { "code": "G11", "name": "G11", "hex": "#DAC898", "rgb": [218, 200, 152], "kind": "solid", "automatic": true },
            { "code": "G12", "name": "G12", "hex": "#FEC993", "rgb": [254, 201, 147], "kind": "solid", "automatic": true },
            { "code": "G13", "name": "G13", "hex": "#B2714B", "rgb": [178, 113, 75], "kind": "solid", "automatic": true },
            { "code": "G14", "name": "G14", "hex": "#8B684C", "rgb": [139, 104, 76], "kind": "solid", "automatic": true },
            { "code": "G15", "name": "G15", "hex": "#F6F8E3", "rgb": [246, 248, 227], "kind": "solid", "automatic": true },
            { "code": "G16", "name": "G16", "hex": "#F2D8C1", "rgb": [242, 216, 193], "kind": "solid", "automatic": true },
            { "code": "G17", "name": "G17", "hex": "#77544E", "rgb": [119, 84, 78], "kind": "solid", "automatic": true },
            { "code": "G18", "name": "G18", "hex": "#FFE3D5", "rgb": [255, 227, 213], "kind": "solid", "automatic": true },
            { "code": "G19", "name": "G19", "hex": "#DD7D41", "rgb": [221, 125, 65], "kind": "solid", "automatic": true },
            { "code": "G20", "name": "G20", "hex": "#A5452F", "rgb": [165, 69, 47], "kind": "solid", "automatic": true },
            { "code": "G21", "name": "G21", "hex": "#B38561", "rgb": [179, 133, 97], "kind": "solid", "automatic": true },
            { "code": "H1", "name": "H1", "hex": "#FFFFFF", "rgb": [255, 255, 255], "kind": "solid", "automatic": true },
            { "code": "H2", "name": "H2", "hex": "#FBFBFB", "rgb": [251, 251, 251], "kind": "solid", "automatic": true },
            { "code": "H3", "name": "H3", "hex": "#B4B4B4", "rgb": [180, 180, 180], "kind": "solid", "automatic": true },
            { "code": "H4", "name": "H4", "hex": "#878787", "rgb": [135, 135, 135], "kind": "solid", "automatic": true },
            { "code": "H5", "name": "H5", "hex": "#464648", "rgb": [70, 70, 72], "kind": "solid", "automatic": true },
            { "code": "H6", "name": "H6", "hex": "#2C2C2C", "rgb": [44, 44, 44], "kind": "solid", "automatic": true },
            { "code": "H7", "name": "H7", "hex": "#010101", "rgb": [1, 1, 1], "kind": "solid", "automatic": true },
            { "code": "H8", "name": "H8", "hex": "#E7D6DC", "rgb": [231, 214, 220], "kind": "solid", "automatic": true },
            { "code": "H9", "name": "H9", "hex": "#EFEDEE", "rgb": [239, 237, 238], "kind": "solid", "automatic": true },
            { "code": "H10", "name": "H10", "hex": "#EBEBEB", "rgb": [235, 235, 235], "kind": "solid", "automatic": true },
            { "code": "H11", "name": "H11", "hex": "#CDCDCD", "rgb": [205, 205, 205], "kind": "solid", "automatic": true },
            { "code": "H12", "name": "H12", "hex": "#FDF6EE", "rgb": [253, 246, 238], "kind": "solid", "automatic": true },
            { "code": "H13", "name": "H13", "hex": "#F4EDF1", "rgb": [244, 237, 241], "kind": "solid", "automatic": true },
            { "code": "H14", "name": "H14", "hex": "#CED7D4", "rgb": [206, 215, 212], "kind": "solid", "automatic": true },
            { "code": "H15", "name": "H15", "hex": "#9AA6A6", "rgb": [154, 166, 166], "kind": "solid", "automatic": true },
            { "code": "H16", "name": "H16", "hex": "#1B1213", "rgb": [27, 18, 19], "kind": "solid", "automatic": true },
            { "code": "H17", "name": "H17", "hex": "#F0EEEF", "rgb": [240, 238, 239], "kind": "solid", "automatic": true },
            { "code": "H18", "name": "H18", "hex": "#FCFFF6", "rgb": [252, 255, 246], "kind": "solid", "automatic": true },
            { "code": "H19", "name": "H19", "hex": "#F2EEE5", "rgb": [242, 238, 229], "kind": "solid", "automatic": true },
            { "code": "H20", "name": "H20", "hex": "#96A09F", "rgb": [150, 160, 159], "kind": "solid", "automatic": true },
            { "code": "H21", "name": "H21", "hex": "#F8FBE6", "rgb": [248, 251, 230], "kind": "solid", "automatic": true },
            { "code": "H22", "name": "H22", "hex": "#CACAD2", "rgb": [202, 202, 210], "kind": "solid", "automatic": true },
            { "code": "H23", "name": "H23", "hex": "#9B9C94", "rgb": [155, 156, 148], "kind": "solid", "automatic": true },
            { "code": "M1", "name": "M1", "hex": "#BBC6B6", "rgb": [187, 198, 182], "kind": "solid", "automatic": true },
            { "code": "M2", "name": "M2", "hex": "#909994", "rgb": [144, 153, 148], "kind": "solid", "automatic": true },
            { "code": "M3", "name": "M3", "hex": "#697E81", "rgb": [105, 126, 129], "kind": "solid", "automatic": true },
            { "code": "M4", "name": "M4", "hex": "#E0D4BC", "rgb": [224, 212, 188], "kind": "solid", "automatic": true },
            { "code": "M5", "name": "M5", "hex": "#D1CCAF", "rgb": [209, 204, 175], "kind": "solid", "automatic": true },
            { "code": "M6", "name": "M6", "hex": "#B0AA86", "rgb": [176, 170, 134], "kind": "solid", "automatic": true },
            { "code": "M7", "name": "M7", "hex": "#B0A796", "rgb": [176, 167, 150], "kind": "solid", "automatic": true },
            { "code": "M8", "name": "M8", "hex": "#AE8082", "rgb": [174, 128, 130], "kind": "solid", "automatic": true },
            { "code": "M9", "name": "M9", "hex": "#A68862", "rgb": [166, 136, 98], "kind": "solid", "automatic": true },
            { "code": "M10", "name": "M10", "hex": "#C4B3BB", "rgb": [196, 179, 187], "kind": "solid", "automatic": true },
            { "code": "M11", "name": "M11", "hex": "#9D7693", "rgb": [157, 118, 147], "kind": "solid", "automatic": true },
            { "code": "M12", "name": "M12", "hex": "#644B51", "rgb": [100, 75, 81], "kind": "solid", "automatic": true },
            { "code": "M13", "name": "M13", "hex": "#C79266", "rgb": [199, 146, 102], "kind": "solid", "automatic": true },
            { "code": "M14", "name": "M14", "hex": "#C27563", "rgb": [194, 117, 99], "kind": "solid", "automatic": true },
            { "code": "M15", "name": "M15", "hex": "#747D7A", "rgb": [116, 125, 122], "kind": "solid", "automatic": true },
        ],
    },
    {
        id: "artkal-m221-hansbug-178dafb",
        name: "Artkal M221 · 官方 RGB 参考",
        brand: "Artkal",
        version: "178dafbc9e77d3de556550dbd058270200129186/2026-05-19",
        sourceUrl: "https://github.com/HansBug/pindou-color-data/blob/178dafbc9e77d3de556550dbd058270200129186/artkal-m-221-official/colors.json",
        sourceNote: "220 条数值 RGB 已与 Artkal 官方 2025 M 系列 PDF 逐项核对，全部一致；RGB 仍是屏幕参考。MH1 仅有官方 Transparent 标记、没有官方 RGB，白色显示占位来自上游整理，必须手动选择且仍按一颗珠统计。固定 HansBug 178dafbc（2026-05-19）。官方源：https://cdn.shopify.com/s/files/1/1323/8195/files/M_MINI_Beads_RGB_Color_Chart_2025.pdf?v=1760661747",
        license: PINNED_DATA_LICENSE,
        colors: [
            { "code": "MA1", "name": "MA1", "hex": "#FFF6D4", "rgb": [255, 246, 212], "kind": "solid", "automatic": true },
            { "code": "MA2", "name": "MA2", "hex": "#F6F9E5", "rgb": [246, 249, 229], "kind": "solid", "automatic": true },
            { "code": "MA3", "name": "MA3", "hex": "#FFFBAA", "rgb": [255, 251, 170], "kind": "solid", "automatic": true },
            { "code": "MA4", "name": "MA4", "hex": "#FFDF58", "rgb": [255, 223, 88], "kind": "solid", "automatic": true },
            { "code": "MA5", "name": "MA5", "hex": "#FECF4D", "rgb": [254, 207, 77], "kind": "solid", "automatic": true },
            { "code": "MA6", "name": "MA6", "hex": "#FFA80C", "rgb": [255, 168, 12], "kind": "solid", "automatic": true },
            { "code": "MA7", "name": "MA7", "hex": "#FF8837", "rgb": [255, 136, 55], "kind": "solid", "automatic": true },
            { "code": "MA8", "name": "MA8", "hex": "#EAC431", "rgb": [234, 196, 49], "kind": "solid", "automatic": true },
            { "code": "MA9", "name": "MA9", "hex": "#F1AA8F", "rgb": [241, 170, 143], "kind": "solid", "automatic": true },
            { "code": "MA10", "name": "MA10", "hex": "#FF8F42", "rgb": [255, 143, 66], "kind": "solid", "automatic": true },
            { "code": "MA11", "name": "MA11", "hex": "#FFE1A1", "rgb": [255, 225, 161], "kind": "solid", "automatic": true },
            { "code": "MA12", "name": "MA12", "hex": "#F4B39C", "rgb": [244, 179, 156], "kind": "solid", "automatic": true },
            { "code": "MA13", "name": "MA13", "hex": "#FFB100", "rgb": [255, 177, 0], "kind": "solid", "automatic": true },
            { "code": "MA14", "name": "MA14", "hex": "#FF6510", "rgb": [255, 101, 16], "kind": "solid", "automatic": true },
            { "code": "MA15", "name": "MA15", "hex": "#DAF05C", "rgb": [218, 240, 92], "kind": "solid", "automatic": true },
            { "code": "MA16", "name": "MA16", "hex": "#F9FBBE", "rgb": [249, 251, 190], "kind": "solid", "automatic": true },
            { "code": "MA17", "name": "MA17", "hex": "#FFD976", "rgb": [255, 217, 118], "kind": "solid", "automatic": true },
            { "code": "MA18", "name": "MA18", "hex": "#FFCA9A", "rgb": [255, 202, 154], "kind": "solid", "automatic": true },
            { "code": "MA19", "name": "MA19", "hex": "#EC7A92", "rgb": [236, 122, 146], "kind": "solid", "automatic": true },
            { "code": "MA20", "name": "MA20", "hex": "#E5BE55", "rgb": [229, 190, 85], "kind": "solid", "automatic": true },
            { "code": "MA21", "name": "MA21", "hex": "#FFE596", "rgb": [255, 229, 150], "kind": "solid", "automatic": true },
            { "code": "MA22", "name": "MA22", "hex": "#F7E898", "rgb": [247, 232, 152], "kind": "solid", "automatic": true },
            { "code": "MA23", "name": "MA23", "hex": "#F0CBB1", "rgb": [240, 203, 177], "kind": "solid", "automatic": true },
            { "code": "MA24", "name": "MA24", "hex": "#F5FCD1", "rgb": [245, 252, 209], "kind": "solid", "automatic": true },
            { "code": "MA25", "name": "MA25", "hex": "#F6D487", "rgb": [246, 212, 135], "kind": "solid", "automatic": true },
            { "code": "MA26", "name": "MA26", "hex": "#FFCB4B", "rgb": [255, 203, 75], "kind": "solid", "automatic": true },
            { "code": "MB1", "name": "MB1", "hex": "#D2E318", "rgb": [210, 227, 24], "kind": "solid", "automatic": true },
            { "code": "MB2", "name": "MB2", "hex": "#79CD41", "rgb": [121, 205, 65], "kind": "solid", "automatic": true },
            { "code": "MB3", "name": "MB3", "hex": "#82D7A1", "rgb": [130, 215, 161], "kind": "solid", "automatic": true },
            { "code": "MB4", "name": "MB4", "hex": "#65DF4F", "rgb": [101, 223, 79], "kind": "solid", "automatic": true },
            { "code": "MB5", "name": "MB5", "hex": "#5FC873", "rgb": [95, 200, 115], "kind": "solid", "automatic": true },
            { "code": "MB6", "name": "MB6", "hex": "#49D1AE", "rgb": [73, 209, 174], "kind": "solid", "automatic": true },
            { "code": "MB7", "name": "MB7", "hex": "#009696", "rgb": [0, 150, 150], "kind": "solid", "automatic": true },
            { "code": "MB8", "name": "MB8", "hex": "#08774F", "rgb": [8, 119, 79], "kind": "solid", "automatic": true },
            { "code": "MB9", "name": "MB9", "hex": "#183823", "rgb": [24, 56, 35], "kind": "solid", "automatic": true },
            { "code": "MB10", "name": "MB10", "hex": "#83CFC3", "rgb": [131, 207, 195], "kind": "solid", "automatic": true },
            { "code": "MB11", "name": "MB11", "hex": "#5A6A27", "rgb": [90, 106, 39], "kind": "solid", "automatic": true },
            { "code": "MB12", "name": "MB12", "hex": "#045F45", "rgb": [4, 95, 69], "kind": "solid", "automatic": true },
            { "code": "MB13", "name": "MB13", "hex": "#E2FFB3", "rgb": [226, 255, 179], "kind": "solid", "automatic": true },
            { "code": "MB14", "name": "MB14", "hex": "#9DD12E", "rgb": [157, 209, 46], "kind": "solid", "automatic": true },
            { "code": "MB15", "name": "MB15", "hex": "#254B3C", "rgb": [37, 75, 60], "kind": "solid", "automatic": true },
            { "code": "MB16", "name": "MB16", "hex": "#D0FCAD", "rgb": [208, 252, 173], "kind": "solid", "automatic": true },
            { "code": "MB17", "name": "MB17", "hex": "#8CA12A", "rgb": [140, 161, 42], "kind": "solid", "automatic": true },
            { "code": "MB18", "name": "MB18", "hex": "#D2D958", "rgb": [210, 217, 88], "kind": "solid", "automatic": true },
            { "code": "MB19", "name": "MB19", "hex": "#49BCA9", "rgb": [73, 188, 169], "kind": "solid", "automatic": true },
            { "code": "MB20", "name": "MB20", "hex": "#E8FDEC", "rgb": [232, 253, 236], "kind": "solid", "automatic": true },
            { "code": "MB21", "name": "MB21", "hex": "#188B81", "rgb": [24, 139, 129], "kind": "solid", "automatic": true },
            { "code": "MB22", "name": "MB22", "hex": "#0C5C5B", "rgb": [12, 92, 91], "kind": "solid", "automatic": true },
            { "code": "MB23", "name": "MB23", "hex": "#3D461B", "rgb": [61, 70, 27], "kind": "solid", "automatic": true },
            { "code": "MB24", "name": "MB24", "hex": "#EAFCB6", "rgb": [234, 252, 182], "kind": "solid", "automatic": true },
            { "code": "MB25", "name": "MB25", "hex": "#538771", "rgb": [83, 135, 113], "kind": "solid", "automatic": true },
            { "code": "MB26", "name": "MB26", "hex": "#8A7A40", "rgb": [138, 122, 64], "kind": "solid", "automatic": true },
            { "code": "MB27", "name": "MB27", "hex": "#D2DEB6", "rgb": [210, 222, 182], "kind": "solid", "automatic": true },
            { "code": "MB28", "name": "MB28", "hex": "#9FF4C2", "rgb": [159, 244, 194], "kind": "solid", "automatic": true },
            { "code": "MB29", "name": "MB29", "hex": "#BBD747", "rgb": [187, 215, 71], "kind": "solid", "automatic": true },
            { "code": "MB30", "name": "MB30", "hex": "#F5FFE6", "rgb": [245, 255, 230], "kind": "solid", "automatic": true },
            { "code": "MB31", "name": "MB31", "hex": "#BFE1C2", "rgb": [191, 225, 194], "kind": "solid", "automatic": true },
            { "code": "MB32", "name": "MB32", "hex": "#9FBA5C", "rgb": [159, 186, 92], "kind": "solid", "automatic": true },
            { "code": "MC1", "name": "MC1", "hex": "#D5E3DE", "rgb": [213, 227, 222], "kind": "solid", "automatic": true },
            { "code": "MC2", "name": "MC2", "hex": "#BBF1F4", "rgb": [187, 241, 244], "kind": "solid", "automatic": true },
            { "code": "MC3", "name": "MC3", "hex": "#73C0DF", "rgb": [115, 192, 223], "kind": "solid", "automatic": true },
            { "code": "MC4", "name": "MC4", "hex": "#33B3E1", "rgb": [51, 179, 225], "kind": "solid", "automatic": true },
            { "code": "MC5", "name": "MC5", "hex": "#00A3CA", "rgb": [0, 163, 202], "kind": "solid", "automatic": true },
            { "code": "MC6", "name": "MC6", "hex": "#58A0D9", "rgb": [88, 160, 217], "kind": "solid", "automatic": true },
            { "code": "MC7", "name": "MC7", "hex": "#0588CC", "rgb": [5, 136, 204], "kind": "solid", "automatic": true },
            { "code": "MC8", "name": "MC8", "hex": "#005F9E", "rgb": [0, 95, 158], "kind": "solid", "automatic": true },
            { "code": "MC9", "name": "MC9", "hex": "#086FB9", "rgb": [8, 111, 185], "kind": "solid", "automatic": true },
            { "code": "MC10", "name": "MC10", "hex": "#52B4E0", "rgb": [82, 180, 224], "kind": "solid", "automatic": true },
            { "code": "MC11", "name": "MC11", "hex": "#00A9B9", "rgb": [0, 169, 185], "kind": "solid", "automatic": true },
            { "code": "MC12", "name": "MC12", "hex": "#1C375A", "rgb": [28, 55, 90], "kind": "solid", "automatic": true },
            { "code": "MC13", "name": "MC13", "hex": "#CEE0F0", "rgb": [206, 224, 240], "kind": "solid", "automatic": true },
            { "code": "MC14", "name": "MC14", "hex": "#EBF5F4", "rgb": [235, 245, 244], "kind": "solid", "automatic": true },
            { "code": "MC15", "name": "MC15", "hex": "#00AAAD", "rgb": [0, 170, 173], "kind": "solid", "automatic": true },
            { "code": "MC16", "name": "MC16", "hex": "#004C7D", "rgb": [0, 76, 125], "kind": "solid", "automatic": true },
            { "code": "MC17", "name": "MC17", "hex": "#5BD4F6", "rgb": [91, 212, 246], "kind": "solid", "automatic": true },
            { "code": "MC18", "name": "MC18", "hex": "#36515C", "rgb": [54, 81, 92], "kind": "solid", "automatic": true },
            { "code": "MC19", "name": "MC19", "hex": "#0F909D", "rgb": [15, 144, 157], "kind": "solid", "automatic": true },
            { "code": "MC20", "name": "MC20", "hex": "#0084B7", "rgb": [0, 132, 183], "kind": "solid", "automatic": true },
            { "code": "MC21", "name": "MC21", "hex": "#DDECFA", "rgb": [221, 236, 250], "kind": "solid", "automatic": true },
            { "code": "MC22", "name": "MC22", "hex": "#84BAC2", "rgb": [132, 186, 194], "kind": "solid", "automatic": true },
            { "code": "MC23", "name": "MC23", "hex": "#CBDBDB", "rgb": [203, 219, 219], "kind": "solid", "automatic": true },
            { "code": "MC24", "name": "MC24", "hex": "#88BDE2", "rgb": [136, 189, 226], "kind": "solid", "automatic": true },
            { "code": "MC25", "name": "MC25", "hex": "#B3ECE0", "rgb": [179, 236, 224], "kind": "solid", "automatic": true },
            { "code": "MC26", "name": "MC26", "hex": "#3E9EBF", "rgb": [62, 158, 191], "kind": "solid", "automatic": true },
            { "code": "MC27", "name": "MC27", "hex": "#E9F0F3", "rgb": [233, 240, 243], "kind": "solid", "automatic": true },
            { "code": "MC28", "name": "MC28", "hex": "#C2CDE3", "rgb": [194, 205, 227], "kind": "solid", "automatic": true },
            { "code": "MC29", "name": "MC29", "hex": "#586B8F", "rgb": [88, 107, 143], "kind": "solid", "automatic": true },
            { "code": "MD1", "name": "MD1", "hex": "#7292E2", "rgb": [114, 146, 226], "kind": "solid", "automatic": true },
            { "code": "MD2", "name": "MD2", "hex": "#6E8CCC", "rgb": [110, 140, 204], "kind": "solid", "automatic": true },
            { "code": "MD3", "name": "MD3", "hex": "#13419A", "rgb": [19, 65, 154], "kind": "solid", "automatic": true },
            { "code": "MD4", "name": "MD4", "hex": "#1E3175", "rgb": [30, 49, 117], "kind": "solid", "automatic": true },
            { "code": "MD5", "name": "MD5", "hex": "#B850B2", "rgb": [184, 80, 178], "kind": "solid", "automatic": true },
            { "code": "MD6", "name": "MD6", "hex": "#AD92E9", "rgb": [173, 146, 233], "kind": "solid", "automatic": true },
            { "code": "MD7", "name": "MD7", "hex": "#5F2D91", "rgb": [95, 45, 145], "kind": "solid", "automatic": true },
            { "code": "MD8", "name": "MD8", "hex": "#D7CDF1", "rgb": [215, 205, 241], "kind": "solid", "automatic": true },
            { "code": "MD9", "name": "MD9", "hex": "#BDB2E6", "rgb": [189, 178, 230], "kind": "solid", "automatic": true },
            { "code": "MD10", "name": "MD10", "hex": "#251B58", "rgb": [37, 27, 88], "kind": "solid", "automatic": true },
            { "code": "MD11", "name": "MD11", "hex": "#A2BBE7", "rgb": [162, 187, 231], "kind": "solid", "automatic": true },
            { "code": "MD12", "name": "MD12", "hex": "#CF8BBE", "rgb": [207, 139, 190], "kind": "solid", "automatic": true },
            { "code": "MD13", "name": "MD13", "hex": "#B80096", "rgb": [184, 0, 150], "kind": "solid", "automatic": true },
            { "code": "MD14", "name": "MD14", "hex": "#A137A7", "rgb": [161, 55, 167], "kind": "solid", "automatic": true },
            { "code": "MD15", "name": "MD15", "hex": "#4A388A", "rgb": [74, 56, 138], "kind": "solid", "automatic": true },
            { "code": "MD16", "name": "MD16", "hex": "#DCE8F6", "rgb": [220, 232, 246], "kind": "solid", "automatic": true },
            { "code": "MD17", "name": "MD17", "hex": "#AECEF0", "rgb": [174, 206, 240], "kind": "solid", "automatic": true },
            { "code": "MD18", "name": "MD18", "hex": "#B38EDB", "rgb": [179, 142, 219], "kind": "solid", "automatic": true },
            { "code": "MD19", "name": "MD19", "hex": "#E8D2EA", "rgb": [232, 210, 234], "kind": "solid", "automatic": true },
            { "code": "MD20", "name": "MD20", "hex": "#B460C3", "rgb": [180, 96, 195], "kind": "solid", "automatic": true },
            { "code": "MD21", "name": "MD21", "hex": "#842A94", "rgb": [132, 42, 148], "kind": "solid", "automatic": true },
            { "code": "MD22", "name": "MD22", "hex": "#4B5E9E", "rgb": [75, 94, 158], "kind": "solid", "automatic": true },
            { "code": "MD23", "name": "MD23", "hex": "#D6D2E2", "rgb": [214, 210, 226], "kind": "solid", "automatic": true },
            { "code": "MD24", "name": "MD24", "hex": "#7776D1", "rgb": [119, 118, 209], "kind": "solid", "automatic": true },
            { "code": "MD25", "name": "MD25", "hex": "#3837A8", "rgb": [56, 55, 168], "kind": "solid", "automatic": true },
            { "code": "MD26", "name": "MD26", "hex": "#DDC8DD", "rgb": [221, 200, 221], "kind": "solid", "automatic": true },
            { "code": "ME1", "name": "ME1", "hex": "#FDD6C9", "rgb": [253, 214, 201], "kind": "solid", "automatic": true },
            { "code": "ME2", "name": "ME2", "hex": "#FFD8F4", "rgb": [255, 216, 244], "kind": "solid", "automatic": true },
            { "code": "ME3", "name": "ME3", "hex": "#FFA0C3", "rgb": [255, 160, 195], "kind": "solid", "automatic": true },
            { "code": "ME4", "name": "ME4", "hex": "#F67AAB", "rgb": [246, 122, 171], "kind": "solid", "automatic": true },
            { "code": "ME5", "name": "ME5", "hex": "#DA5B95", "rgb": [218, 91, 149], "kind": "solid", "automatic": true },
            { "code": "ME6", "name": "ME6", "hex": "#FF4B78", "rgb": [255, 75, 120], "kind": "solid", "automatic": true },
            { "code": "ME7", "name": "ME7", "hex": "#9E156B", "rgb": [158, 21, 107], "kind": "solid", "automatic": true },
            { "code": "ME8", "name": "ME8", "hex": "#FFE1E6", "rgb": [255, 225, 230], "kind": "solid", "automatic": true },
            { "code": "ME9", "name": "ME9", "hex": "#F378CA", "rgb": [243, 120, 202], "kind": "solid", "automatic": true },
            { "code": "ME10", "name": "ME10", "hex": "#BE316D", "rgb": [190, 49, 109], "kind": "solid", "automatic": true },
            { "code": "ME11", "name": "ME11", "hex": "#FFE8DA", "rgb": [255, 232, 218], "kind": "solid", "automatic": true },
            { "code": "ME12", "name": "ME12", "hex": "#FFA5C6", "rgb": [255, 165, 198], "kind": "solid", "automatic": true },
            { "code": "ME13", "name": "ME13", "hex": "#B53883", "rgb": [181, 56, 131], "kind": "solid", "automatic": true },
            { "code": "ME14", "name": "ME14", "hex": "#FFDDC7", "rgb": [255, 221, 199], "kind": "solid", "automatic": true },
            { "code": "ME15", "name": "ME15", "hex": "#E5C6D0", "rgb": [229, 198, 208], "kind": "solid", "automatic": true },
            { "code": "ME16", "name": "ME16", "hex": "#F9F2EB", "rgb": [249, 242, 235], "kind": "solid", "automatic": true },
            { "code": "ME17", "name": "ME17", "hex": "#E7DCE6", "rgb": [231, 220, 230], "kind": "solid", "automatic": true },
            { "code": "ME18", "name": "ME18", "hex": "#FFD3E6", "rgb": [255, 211, 230], "kind": "solid", "automatic": true },
            { "code": "ME19", "name": "ME19", "hex": "#FFD5EC", "rgb": [255, 213, 236], "kind": "solid", "automatic": true },
            { "code": "ME20", "name": "ME20", "hex": "#F3DCE8", "rgb": [243, 220, 232], "kind": "solid", "automatic": true },
            { "code": "ME21", "name": "ME21", "hex": "#BD9CA3", "rgb": [189, 156, 163], "kind": "solid", "automatic": true },
            { "code": "ME22", "name": "ME22", "hex": "#C578A5", "rgb": [197, 120, 165], "kind": "solid", "automatic": true },
            { "code": "ME23", "name": "ME23", "hex": "#A37A9B", "rgb": [163, 122, 155], "kind": "solid", "automatic": true },
            { "code": "ME24", "name": "ME24", "hex": "#F4E8FF", "rgb": [244, 232, 255], "kind": "solid", "automatic": true },
            { "code": "MF1", "name": "MF1", "hex": "#FF7F67", "rgb": [255, 127, 103], "kind": "solid", "automatic": true },
            { "code": "MF2", "name": "MF2", "hex": "#FF5D46", "rgb": [255, 93, 70], "kind": "solid", "automatic": true },
            { "code": "MF3", "name": "MF3", "hex": "#E3564A", "rgb": [227, 86, 74], "kind": "solid", "automatic": true },
            { "code": "MF4", "name": "MF4", "hex": "#C7270D", "rgb": [199, 39, 13], "kind": "solid", "automatic": true },
            { "code": "MF5", "name": "MF5", "hex": "#BE0A27", "rgb": [190, 10, 39], "kind": "solid", "automatic": true },
            { "code": "MF6", "name": "MF6", "hex": "#83411E", "rgb": [131, 65, 30], "kind": "solid", "automatic": true },
            { "code": "MF7", "name": "MF7", "hex": "#730037", "rgb": [115, 0, 55], "kind": "solid", "automatic": true },
            { "code": "MF8", "name": "MF8", "hex": "#AB0022", "rgb": [171, 0, 34], "kind": "solid", "automatic": true },
            { "code": "MF9", "name": "MF9", "hex": "#DE7995", "rgb": [222, 121, 149], "kind": "solid", "automatic": true },
            { "code": "MF10", "name": "MF10", "hex": "#AB613C", "rgb": [171, 97, 60], "kind": "solid", "automatic": true },
            { "code": "MF11", "name": "MF11", "hex": "#5C2929", "rgb": [92, 41, 41], "kind": "solid", "automatic": true },
            { "code": "MF12", "name": "MF12", "hex": "#F34461", "rgb": [243, 68, 97], "kind": "solid", "automatic": true },
            { "code": "MF13", "name": "MF13", "hex": "#C64239", "rgb": [198, 66, 57], "kind": "solid", "automatic": true },
            { "code": "MF14", "name": "MF14", "hex": "#FFA5BB", "rgb": [255, 165, 187], "kind": "solid", "automatic": true },
            { "code": "MF15", "name": "MF15", "hex": "#BC0018", "rgb": [188, 0, 24], "kind": "solid", "automatic": true },
            { "code": "MF16", "name": "MF16", "hex": "#FFD7CB", "rgb": [255, 215, 203], "kind": "solid", "automatic": true },
            { "code": "MF17", "name": "MF17", "hex": "#F19D8A", "rgb": [241, 157, 138], "kind": "solid", "automatic": true },
            { "code": "MF18", "name": "MF18", "hex": "#DC7B45", "rgb": [220, 123, 69], "kind": "solid", "automatic": true },
            { "code": "MF19", "name": "MF19", "hex": "#C74651", "rgb": [199, 70, 81], "kind": "solid", "automatic": true },
            { "code": "MF20", "name": "MF20", "hex": "#D8A89E", "rgb": [216, 168, 158], "kind": "solid", "automatic": true },
            { "code": "MF21", "name": "MF21", "hex": "#EB9DB9", "rgb": [235, 157, 185], "kind": "solid", "automatic": true },
            { "code": "MF22", "name": "MF22", "hex": "#FFD4D4", "rgb": [255, 212, 212], "kind": "solid", "automatic": true },
            { "code": "MF23", "name": "MF23", "hex": "#EA8474", "rgb": [234, 132, 116], "kind": "solid", "automatic": true },
            { "code": "MF24", "name": "MF24", "hex": "#F7C1C5", "rgb": [247, 193, 197], "kind": "solid", "automatic": true },
            { "code": "MF25", "name": "MF25", "hex": "#FC5768", "rgb": [252, 87, 104], "kind": "solid", "automatic": true },
            { "code": "MG1", "name": "MG1", "hex": "#FFE7C8", "rgb": [255, 231, 200], "kind": "solid", "automatic": true },
            { "code": "MG2", "name": "MG2", "hex": "#FFD6C3", "rgb": [255, 214, 195], "kind": "solid", "automatic": true },
            { "code": "MG3", "name": "MG3", "hex": "#EEB694", "rgb": [238, 182, 148], "kind": "solid", "automatic": true },
            { "code": "MG4", "name": "MG4", "hex": "#D9A58C", "rgb": [217, 165, 140], "kind": "solid", "automatic": true },
            { "code": "MG5", "name": "MG5", "hex": "#F49630", "rgb": [244, 150, 48], "kind": "solid", "automatic": true },
            { "code": "MG6", "name": "MG6", "hex": "#F19937", "rgb": [241, 153, 55], "kind": "solid", "automatic": true },
            { "code": "MG7", "name": "MG7", "hex": "#AC745B", "rgb": [172, 116, 91], "kind": "solid", "automatic": true },
            { "code": "MG8", "name": "MG8", "hex": "#694A42", "rgb": [105, 74, 66], "kind": "solid", "automatic": true },
            { "code": "MG9", "name": "MG9", "hex": "#F7CC9D", "rgb": [247, 204, 157], "kind": "solid", "automatic": true },
            { "code": "MG10", "name": "MG10", "hex": "#C7832F", "rgb": [199, 131, 47], "kind": "solid", "automatic": true },
            { "code": "MG11", "name": "MG11", "hex": "#D3C391", "rgb": [211, 195, 145], "kind": "solid", "automatic": true },
            { "code": "MG12", "name": "MG12", "hex": "#E6B986", "rgb": [230, 185, 134], "kind": "solid", "automatic": true },
            { "code": "MG13", "name": "MG13", "hex": "#C67B4F", "rgb": [198, 123, 79], "kind": "solid", "automatic": true },
            { "code": "MG14", "name": "MG14", "hex": "#8D6242", "rgb": [141, 98, 66], "kind": "solid", "automatic": true },
            { "code": "MG15", "name": "MG15", "hex": "#F6F7E2", "rgb": [246, 247, 226], "kind": "solid", "automatic": true },
            { "code": "MG16", "name": "MG16", "hex": "#F2E7D7", "rgb": [242, 231, 215], "kind": "solid", "automatic": true },
            { "code": "MG17", "name": "MG17", "hex": "#786562", "rgb": [120, 101, 98], "kind": "solid", "automatic": true },
            { "code": "MG18", "name": "MG18", "hex": "#FEF5EB", "rgb": [254, 245, 235], "kind": "solid", "automatic": true },
            { "code": "MG19", "name": "MG19", "hex": "#F0AB47", "rgb": [240, 171, 71], "kind": "solid", "automatic": true },
            { "code": "MG20", "name": "MG20", "hex": "#AE6949", "rgb": [174, 105, 73], "kind": "solid", "automatic": true },
            { "code": "MG21", "name": "MG21", "hex": "#BF8C6E", "rgb": [191, 140, 110], "kind": "solid", "automatic": true },
            { "code": "MH1", "name": "MH1（透明珠）", "hex": "#FFFFFF", "rgb": [255, 255, 255], "kind": "transparent", "automatic": false },
            { "code": "MH2", "name": "MH2", "hex": "#FFFFFF", "rgb": [255, 255, 255], "kind": "solid", "automatic": true },
            { "code": "MH3", "name": "MH3", "hex": "#9B9B9B", "rgb": [155, 155, 155], "kind": "solid", "automatic": true },
            { "code": "MH4", "name": "MH4", "hex": "#6D6D6D", "rgb": [109, 109, 109], "kind": "solid", "automatic": true },
            { "code": "MH5", "name": "MH5", "hex": "#4D4D4D", "rgb": [77, 77, 77], "kind": "solid", "automatic": true },
            { "code": "MH6", "name": "MH6", "hex": "#3A3A3A", "rgb": [58, 58, 58], "kind": "solid", "automatic": true },
            { "code": "MH7", "name": "MH7", "hex": "#000000", "rgb": [0, 0, 0], "kind": "solid", "automatic": true },
            { "code": "MH8", "name": "MH8", "hex": "#FFF0F1", "rgb": [255, 240, 241], "kind": "solid", "automatic": true },
            { "code": "MH9", "name": "MH9", "hex": "#E3E6DF", "rgb": [227, 230, 223], "kind": "solid", "automatic": true },
            { "code": "MH10", "name": "MH10", "hex": "#E2E0E7", "rgb": [226, 224, 231], "kind": "solid", "automatic": true },
            { "code": "MH11", "name": "MH11", "hex": "#BCB8B5", "rgb": [188, 184, 181], "kind": "solid", "automatic": true },
            { "code": "MH12", "name": "MH12", "hex": "#F7F3E1", "rgb": [247, 243, 225], "kind": "solid", "automatic": true },
            { "code": "MH13", "name": "MH13", "hex": "#EADDC8", "rgb": [234, 221, 200], "kind": "solid", "automatic": true },
            { "code": "MH14", "name": "MH14", "hex": "#B8C8C5", "rgb": [184, 200, 197], "kind": "solid", "automatic": true },
            { "code": "MH15", "name": "MH15", "hex": "#99ABAC", "rgb": [153, 171, 172], "kind": "solid", "automatic": true },
            { "code": "MH16", "name": "MH16", "hex": "#444236", "rgb": [68, 66, 54], "kind": "solid", "automatic": true },
            { "code": "MH17", "name": "MH17", "hex": "#FAFBF5", "rgb": [250, 251, 245], "kind": "solid", "automatic": true },
            { "code": "MH18", "name": "MH18", "hex": "#FEFEEE", "rgb": [254, 254, 238], "kind": "solid", "automatic": true },
            { "code": "MH19", "name": "MH19", "hex": "#FBF2E4", "rgb": [251, 242, 228], "kind": "solid", "automatic": true },
            { "code": "MH20", "name": "MH20", "hex": "#9EAEAD", "rgb": [158, 174, 173], "kind": "solid", "automatic": true },
            { "code": "MH21", "name": "MH21", "hex": "#FDFFF2", "rgb": [253, 255, 242], "kind": "solid", "automatic": true },
            { "code": "MH22", "name": "MH22", "hex": "#EDEDE7", "rgb": [237, 237, 231], "kind": "solid", "automatic": true },
            { "code": "MH23", "name": "MH23", "hex": "#B4B8A7", "rgb": [180, 184, 167], "kind": "solid", "automatic": true },
            { "code": "MM1", "name": "MM1", "hex": "#AEBBA8", "rgb": [174, 187, 168], "kind": "solid", "automatic": true },
            { "code": "MM2", "name": "MM2", "hex": "#729376", "rgb": [114, 147, 118], "kind": "solid", "automatic": true },
            { "code": "MM3", "name": "MM3", "hex": "#6A8890", "rgb": [106, 136, 144], "kind": "solid", "automatic": true },
            { "code": "MM4", "name": "MM4", "hex": "#BEB39D", "rgb": [190, 179, 157], "kind": "solid", "automatic": true },
            { "code": "MM5", "name": "MM5", "hex": "#B8B78C", "rgb": [184, 183, 140], "kind": "solid", "automatic": true },
            { "code": "MM6", "name": "MM6", "hex": "#B2AC93", "rgb": [178, 172, 147], "kind": "solid", "automatic": true },
            { "code": "MM7", "name": "MM7", "hex": "#BC9F94", "rgb": [188, 159, 148], "kind": "solid", "automatic": true },
            { "code": "MM8", "name": "MM8", "hex": "#968381", "rgb": [150, 131, 129], "kind": "solid", "automatic": true },
            { "code": "MM9", "name": "MM9", "hex": "#B39D88", "rgb": [179, 157, 136], "kind": "solid", "automatic": true },
            { "code": "MM10", "name": "MM10", "hex": "#B796A3", "rgb": [183, 150, 163], "kind": "solid", "automatic": true },
            { "code": "MM11", "name": "MM11", "hex": "#B096B9", "rgb": [176, 150, 185], "kind": "solid", "automatic": true },
            { "code": "MM12", "name": "MM12", "hex": "#685951", "rgb": [104, 89, 81], "kind": "solid", "automatic": true },
            { "code": "MM13", "name": "MM13", "hex": "#C79582", "rgb": [199, 149, 130], "kind": "solid", "automatic": true },
            { "code": "MM14", "name": "MM14", "hex": "#CA694F", "rgb": [202, 105, 79], "kind": "solid", "automatic": true },
            { "code": "MM15", "name": "MM15", "hex": "#929FA9", "rgb": [146, 159, 169], "kind": "solid", "automatic": true },
        ],
    },
];

}
};
const cache = Object.create(null);
function load(id) {
  if (!Object.hasOwn(factories, id)) throw Error('Unknown bead runtime dependency');
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} };
  factories[id](module, module.exports, load);
  return module.exports;
}
module.exports = load('./bead-pattern');
