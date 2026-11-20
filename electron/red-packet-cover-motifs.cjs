// Identify detached ink groups on a single-colour illustration. This is
// geometric grouping, not OCR: lettering, punctuation and accents keep their pixels.
function coverMotifs(source, background) {
  const unit = Math.max(1, source.width / 168, source.height / 224);
  const width = Math.ceil(source.width / unit), height = Math.ceil(source.height / unit);
  const labels = new Int32Array(width * height), ink = new Uint8Array(labels.length);
  for (let y = 0; y < source.height; y++) {
    const row = Math.floor(y / unit) * width;
    for (let x = 0, at = 4 * y * source.width; x < source.width; x++, at += 4) {
      const alpha = source.data[at + 3] / 255, white = 255 * (1 - alpha);
      if (Math.max(Math.abs(source.data[at] * alpha + white - background[0]),
        Math.abs(source.data[at + 1] * alpha + white - background[1]),
        Math.abs(source.data[at + 2] * alpha + white - background[2])) > 52) ink[row + Math.floor(x / unit)] = 1;
    }
  }
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    const x = i % width, y = Math.floor(i / width);
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++)
      for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) labels[yy * width + xx] = -1;
  }
  const groups = [], queue = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== -1) continue;
    const id = groups.length + 1;
    let read = 0, used = 1, x0 = width, x1 = 0, y0 = height, y1 = 0, cx = 0, cy = 0;
    labels[i] = id; queue[0] = i;
    const add = j => { if (labels[j] === -1) { labels[j] = id; queue[used++] = j; } };
    while (read < used) {
      const j = queue[read++], x = j % width, y = Math.floor(j / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      cx += x; cy += y;
      if (x) add(j - 1);
      if (x + 1 < width) add(j + 1);
      if (y) add(j - width);
      if (y + 1 < height) add(j + width);
    }
    groups.push({ id, count: used, x0, x1, y0, y1, cx: cx / used, cy: cy / used });
  }
  if (!groups.length) return;
  groups.sort((a, b) => b.count - a.count);
  const main = groups[0];
  const heading = groups.slice(1).find(g => g.count > main.count * 0.035 && g.count < main.count * 0.7 &&
    g.cy < main.cy && g.cy < height * 0.42 && g.y1 - g.y0 < height * 0.33 &&
    (Math.abs(g.cx - main.cx) > width * 0.12 ||
      // A clearly detached horizontal line can be a centered title as well.
      (g.y1 < main.y0 - height * 0.03 && g.x1 - g.x0 >= (g.y1 - g.y0) * 2)));
  const detachedHeading = heading && heading.y1 < main.y0 - height * 0.03;
  const roles = new Uint8Array(groups.length + 1), bounds = [null, null, null, null];
  for (const group of groups) {
    const isHeading = heading && (group === heading || group !== main && group.count <= heading.count &&
      group.x0 < heading.x1 + width * 0.09 && group.x1 > heading.x0 - width * 0.09 &&
      group.y0 < heading.y1 + height * 0.08 && group.y1 > heading.y0 - height * 0.08);
    // An isolated grain at the opposite canvas edge should not shrink the whole
    // hero. Keep such marks in their original locations on the paper instead.
    const floatingAccent = detachedHeading && group.cy < main.y0 && group.y1 < main.y0 + height * 0.035 &&
      group.count <= main.count * 0.035;
    const role = isHeading ? 2 : group !== main && (group.count <= 9 || floatingAccent) ? 3 : 1;
    roles[group.id] = role;
    const box = bounds[role] ||= { left: source.width, right: 0, top: source.height, bottom: 0 };
    box.left = Math.min(box.left, group.x0 * unit); box.right = Math.max(box.right, Math.min(source.width, group.x1 * unit));
    box.top = Math.min(box.top, group.y0 * unit); box.bottom = Math.max(box.bottom, Math.min(source.height, group.y1 * unit));
  }
  // When the title is on its own line above the subject, keep the original
  // shaded region under it. A strong-colour mask alone can erase pale fur.
  const heroRegion = detachedHeading && heading.y1 < main.y0 - height * 0.12 ? {
    left: Math.max(0, bounds[1].left - source.width * 0.035),
    right: Math.min(source.width, bounds[1].right + source.width * 0.035),
    top: Math.max(bounds[2].bottom + unit * 2, bounds[1].top - source.height * 0.16),
    bottom: Math.min(source.height, bounds[1].bottom + source.height * 0.025),
  } : undefined;
  return { unit, width, labels, roles, bounds, heroRegion };
}
module.exports = { coverMotifs };
