export async function downloadFile(filename: string, content: string, type = 'application/json;charset=utf-8'): Promise<boolean> {
  if (typeof window !== 'undefined' && window.desktop?.fileDialogs?.saveText) {
    return (await window.desktop.fileDialogs.saveText({ filename, text: content, mimeType: type })).saved;
  }
  const href = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}

export function previewSvg(title: string, accent = '#6658e8') {
  const safeTitle = title.replace(/[<>&"']/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#f6f4ef"/><rect x="1000" width="600" height="900" fill="${accent}"/><circle cx="1300" cy="440" r="180" fill="white" opacity=".2"/><text x="110" y="200" font-family="Microsoft YaHei, sans-serif" font-size="22" fill="#777">XUZUO STUDIO · 交互原型预览</text><text x="110" y="390" font-family="Microsoft YaHei, sans-serif" font-size="66" fill="#24282f">${safeTitle.slice(0, 18)}</text><text x="115" y="475" font-family="Microsoft YaHei, sans-serif" font-size="25" fill="#777">创作有序，交付从容。</text><text x="110" y="790" font-family="Microsoft YaHei, sans-serif" font-size="18" fill="#999">演示内容 · 非真实AI生成文件</text></svg>`;
}
