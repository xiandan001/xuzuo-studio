const { canvas, identity, button, titleBand, cornerDepth } = require('./red-packet-cover-layout.json');

const { coverMotifs } = require('./red-packet-cover-motifs.cjs');

function rgbOnWhite(data, index, channel) {
  const alpha = data[index + 3];
  return alpha === 255 ? data[index + channel] : 255 + (data[index + channel] - 255) * alpha / 255;
}

function median(colors) {
  return [0, 1, 2].map(channel => colors.map(rgb => rgb[channel]).sort((a, b) => a - b)[colors.length >> 1]);
}

function borderColors({ width, height, data }) {
  const samples = [], corners = [[], [], [], []];
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    for (const [x, y] of [[t, 0], [t, 1], [0, t], [1, t]]) {
      const index = 4 * (Math.round(y * (height - 1)) * width + Math.round(x * (width - 1)));
      const color = [0, 1, 2].map(c => rgbOnWhite(data, index, c));
      samples.push(color);
      corners[(x >= 0.5 ? 1 : 0) + (y >= 0.5 ? 2 : 0)].push(color);
    }
  }
  const base = median(samples);
  const close = samples.filter(color => color.every((value, c) => Math.abs(value - base[c]) <= 36));
  const texture = close.length ? median(close.map(rgb => rgb.map((value, c) => Math.abs(value - base[c])))) : [0, 0, 0];
  return { base, corners: corners.map(median), texture, simple: close.length >= samples.length * 0.85 };
}

function backgroundPixels({ corners, texture }) {
  const { width, height } = canvas;
  const data = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const left = corners[0].map((value, c) => value + (corners[2][c] - value) * t);
    const right = corners[1].map((value, c) => value + (corners[3][c] - value) * t);
    const step = right.map((value, c) => (value - left[c]) / (width - 1));
    for (let x = 0; x < width; x++) {
      // Procedural grain uses only colour statistics. Never repeat a source tile,
      // which could inadvertently copy letters or facial features into an overlay.
      const seed = Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
      const grain = ((Math.imul(seed ^ seed >>> 13, 1597334677) >>> 24) / 128 - 1) * 1.8;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.max(0, Math.round(left[c] + x * step[c] + grain * Math.min(9, texture[c]))));
    }
  }
  return data;
}

// Distances are measured in canvas pixels against the official illustration's
// estimated overlays. Only the synthetic background may contribute inside them.
function clearance(x, y) {
  const { width, height } = canvas;
  const info = Math.max(width * identity.left - x, x - width * identity.right, height * identity.top - y, y - height * identity.bottom);
  const open = Math.hypot(x - width * button.centerX, y - height * button.centerY) - width * button.diameterRatio / 2;
  const u = 2 * x / width - 1;
  const corner = height * (1 - cornerDepth * u * u) - y;
  return Math.min(info, open, corner);
}

function transform(box, scale, cx, cy) {
  return { scale, left: cx - scale * (box.left + box.right) / 2, top: cy - scale * (box.top + box.bottom) / 2 };
}

function sourceColor(source, x, y, out) {
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, source.width - 1), y1 = Math.min(y0 + 1, source.height - 1);
  const fx = x - x0, fy = y - y0;
  const a = 4 * (y0 * source.width + x0), b = 4 * (y0 * source.width + x1);
  const c = 4 * (y1 * source.width + x0), d = 4 * (y1 * source.width + x1);
  for (let ch = 0; ch < 3; ch++) {
    const upper = rgbOnWhite(source.data, a, ch) * (1 - fx) + rgbOnWhite(source.data, b, ch) * fx;
    const lower = rgbOnWhite(source.data, c, ch) * (1 - fx) + rgbOnWhite(source.data, d, ch) * fx;
    out[ch] = upper * (1 - fy) + lower * fy;
  }
}

function paint(data, source, placement, background, motifs, role) {
  const { width, height } = canvas, { scale, left, top } = placement;
  const box = role ? motifs.bounds[role] : { left: 0, right: source.width, top: 0, bottom: source.height };
  const startX = Math.max(0, Math.ceil(left + box.left * scale - 0.5)), endX = Math.min(width, Math.ceil(left + box.right * scale - 0.5));
  const startY = Math.max(0, Math.ceil(top + box.top * scale - 0.5)), endY = Math.min(height, Math.ceil(top + box.bottom * scale - 0.5));
  const color = [0, 0, 0];
  for (let y = startY; y < endY; y++) {
    const sy = Math.min(source.height - 1, Math.max(0, (y + 0.5 - top) / scale - 0.5));
    for (let x = startX; x < endX; x++) {
      const safe = clearance(x + 0.5, y + 0.5);
      if (safe <= 2) continue;
      const sx = Math.min(source.width - 1, Math.max(0, (x + 0.5 - left) / scale - 0.5));
      if (role && motifs.roles[motifs.labels[Math.floor(sy / motifs.unit) * motifs.width + Math.floor(sx / motifs.unit)]] !== role) continue;
      sourceColor(source, sx, sy, color);
      let alpha = Math.min(1, (safe - 2) / (background.simple ? 8 : height * 0.11));
      if (role) {
        // Chroma-matte the existing paper away; keep the strokes, fur and type.
        const contrast = Math.max(Math.abs(color[0] - background.base[0]), Math.abs(color[1] - background.base[1]), Math.abs(color[2] - background.base[2]));
        alpha *= Math.max(0, Math.min(1, (contrast - 16) / 38));
      } else if (left > 0 || top > 0 || left + source.width * scale < width || top + source.height * scale < height) {
        const distance = Math.min(x + 0.5 - left, left + source.width * scale - x - 0.5, y + 0.5 - top, top + source.height * scale - y - 0.5);
        alpha *= Math.max(0, Math.min(1, distance / (width * 0.05)));
      }
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(alpha * color[c] + (1 - alpha) * data[i + c]);
    }
  }
}

function needsPlacement(motifs, placement, onlyRole) {
  const { width, unit, labels, roles } = motifs;
  for (let i = 0; i < labels.length; i++) {
    const role = roles[labels[i]];
    if (!role || role === 3 || (onlyRole && role !== onlyRole)) continue;
    const x = (i % width + 0.5) * unit * placement.scale + placement.left;
    const y = (Math.floor(i / width) + 0.5) * unit * placement.scale + placement.top;
    if (x < 0 || x > canvas.width || y < 0 || y > canvas.height || clearance(x, y) < 3 + 0.71 * unit * placement.scale) return true;
  }
  return false;
}

function largeMotifPlacement(motifs, full) {
  for (const zoom of [1, 0.85, 0.72]) {
    for (const x of [0.5, 0.28, 0.72, 0.15, 0.85]) {
      for (const y of [0.61, 0.5, 0.72]) {
        const candidate = transform(motifs.bounds[1], full.scale * zoom, canvas.width * x, canvas.height * y);
        if (!needsPlacement(motifs, candidate, 1)) return candidate;
      }
    }
  }
}

// For a full photographic scene, keep the scale of the original. Prefer a small
// pan when it preserves more edges outside the system UI; do not shrink it into a badge.
function placeScene(source, full) {
  const points = [], step = Math.max(1, Math.ceil(Math.max(source.width, source.height) / 80));
  for (let y = step; y < source.height; y += step) {
    for (let x = step; x < source.width; x += step) {
      const i = 4 * (y * source.width + x);
      let weight = 0;
      for (let c = 0; c < 3; c++) weight += Math.abs(rgbOnWhite(source.data, i, c) - rgbOnWhite(source.data, i - step * 4, c))
        + Math.abs(rgbOnWhite(source.data, i, c) - rgbOnWhite(source.data, i - source.width * step * 4, c));
      points.push([x * full.scale + full.left, y * full.scale + full.top, Math.min(240, weight)]);
    }
  }
  let best = full, minCost = Infinity, valid = false;
  for (const offset of [0, 0.09, -0.09, 0.18, -0.18, 0.27]) {
    const dy = canvas.height * offset;
    let cost = points.length * 14 * Math.abs(offset), occupied = 0, sharp = 0;
    for (const [x, y, weight] of points) {
      const ty = y + dy;
      if (x < 0 || x > canvas.width || ty < 0 || ty > canvas.height) cost += 1.5 * weight;
      else if (clearance(x, ty) < 16) {
        cost += weight;
        occupied++;
        if (weight > 100) sharp++;
      }
    }
    // Do not paint over a crowded area of a photograph and present it as a
    // verified placement. Keep the source available for local composition.
    if (occupied > 0 && sharp / occupied > 0.25) continue;
    if (cost < minCost) { valid = true; minCost = cost; best = { ...full, top: full.top + dy }; }
  }
  if (!valid) throw Error('这张图的头像昵称区或底部按钮区仍有密集细节。请调整源图构图，将脸和题字移到遮挡区外再导出。');
  return best;
}

function composeCover(source) {
  const { width, height } = canvas, background = borderColors(source);
  const data = backgroundPixels(background);
  const full = transform({ left: 0, right: source.width, top: 0, bottom: source.height },
    Math.max(width / source.width, height / source.height), width / 2, height / 2);
  const motifs = background.simple && coverMotifs(source, background.base);
  if (!motifs || !needsPlacement(motifs, full)) {
    paint(data, source, motifs ? full : placeScene(source, full), background);
  } else {
    if (motifs.bounds[3]) paint(data, source, full, background, motifs, 3);
    const hero = motifs.bounds[1], top = height * (identity.bottom + 0.008);
    const foot = height * button.centerY - width * button.diameterRatio / 2 - height * 0.02;
    const heroScale = Math.min(width / (hero.right - hero.left), (foot - top) / (hero.bottom - hero.top));
    let heroPlacement = transform(hero, heroScale, width * 0.5, (top + foot) / 2);
    // Try the side gutters before reducing a tall illustration to a small stamp.
    // Never silently cut a face or glyph off to make a larger variant fit.
    if (heroScale < full.scale * 0.68 && hero.bottom - hero.top > source.height * 0.6) {
      const larger = largeMotifPlacement(motifs, full);
      if (!larger) throw Error('完整保留这张图会把主体缩得过小。请在源图中将脸和题字错开排布，再导出封面。');
      heroPlacement = larger;
    }
    paint(data, source, heroPlacement, background, motifs, 1);
    const title = motifs.bounds[2];
    if (title) {
      const scale = Math.min(width * 0.82 / (title.right - title.left), height * (titleBand.bottom - titleBand.top) / (title.bottom - title.top));
      paint(data, source, transform(title, scale, width / 2, height * (titleBand.top + titleBand.bottom) / 2), background, motifs, 2);
    }
  }
  return { width, height, data };
}

module.exports = { composeCover };
