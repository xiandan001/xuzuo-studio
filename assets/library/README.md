# 序作实用素材包 v1

本包包含 28 件实际图像：8 款留白背景、8 款业务图解、4 款透明装饰、8 款 Lucide 线性图标。每件都提供 Office 可直接使用的 PNG、SVG 源文件及小尺寸 PNG 缩略图，不依赖在线图片链接，不调用收费模型。

## 使用

- 通过素材库预览、另存或复制到当前工作区/项目。PNG 可用于 Word、PPT 和图片创作；SVG 是可继续修改的原始矢量文件。
- 留白背景适合放置标题或正文。业务图解提供通用结构，不包含真实经营数据，也不表示实际预测或业绩。
- 透明装饰和图标保留真实 Alpha 通道。将它们放在浅色或深色底上检查最终对比度。
- 图解文字是 PNG 的图像内容；若需重排文字，可修改随包 SVG 或在文档/PPT 中另行填写文字，不把图片文字声称为可直接编辑的正文。

## 来源与许可

20 件原创几何背景、图解、装饰由本项目代码绘制，按 CC0 1.0 Universal 提供。许可原文在 `licenses/CC0-1.0.txt`，可复制、修改、用于商业项目及再分发。CC0 不涉及第三方商标、肖像、专利或他人额外添加的内容；本包未使用人物照片或品牌标志。

8 件开源图标来源于 Lucide 0.468.0（与本项目已安装的 lucide-react 版本一致），许可为 ISC。完整版权与许可文本在 `licenses/ISC-LUCIDE.txt`。ISC 允许有偿或无偿使用、复制、修改和分发，但要求副本保留版权及许可文本。每个图标的 PNG tEXt 元数据及 SVG 注释均保留完整 ISC 原文；将素材交给客户或另行分发时，也应保留相应授权说明。

- 官方版本许可：https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE
- 图标具体源文件地址、作者、版本、许可及逐文件 SHA-256 见 `catalog.json`。
- CC0 官方法律文本：https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt

`licenses` 文本于 2026-11-02 从上述官方来源核对。所有源文件为 UTF-8 / LF，图像均随安装包提供。

## 重新生成

在本项目健康依赖目录 `work/ui-build/node_modules` 和本机 Playwright Chromium 已准备好的情况下执行：

```powershell
node scripts/build-asset-library.mjs
```

生成过程只在本地绘制 SVG 并栅格化，不下载图片，不读取 API Key。新增或更新开源图标版本时必须先重新核对许可，并更新精确来源版本与清单哈希。
