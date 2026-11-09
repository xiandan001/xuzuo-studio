# macOS 开发与验收

## 2.6.0 合并回归（2026-11-09）

`develop-macos` 合入 `develop-owner` 的 7 个新提交，截至 `4bd387f`。
保留 macOS 原生窗口、Command 快捷键、路径与备份处理、钥匙串延迟授权和动画布局修复，
接入独立聊天、推理强度选择、快速模型接入、图集/GIF 制作与导出优化及 iPad 横屏壁纸。
新聊天适配器同时保留明确的凭证授权错误：拒绝钥匙串后不发送请求，且不回显原始异常或密钥。

- 最终源码回归：3062 项通过，0 项失败；4 项 Windows 专用用例跳过。
- Python 离线测试：26 项通过；独立动画运行时实际导出、解码、帧时长及取消清理共 16 场景通过。
- 真实 React 与生产样式的隔离浏览器验收：图集/GIF 20 项基础布局、16 项完整 Mac 壳层、32 项长标题预览通过；导出按钮可滚达，Command 撤销/重做与切换条目停止播放通过。
- 实际 `App.tsx` 在最小桌面窗口 1120×760 下，15 个页面的浅/深主题及 Mac 标题栏、隐藏 Windows 窗口按钮、Command-K 搜索与发送按钮可达性，共 34 项通过。
- 独立聊天在内存桥接下通过 9 项功能及 24 项 Mac 布局检查，覆盖推理强度、流式回复、停止、重新回答、快捷键、会话恢复、制作入口与失败保留输入；无项目时也可聊天。
- 2.6.0 `.app`、DMG 与 ZIP 构建成功；499 个源码文件及 50 个动画资源核对一致，Electron 45.2.3、arm64 架构与完整 ad-hoc 签名检查通过；DMG 只读挂载及 ZIP 解压后检查通过。
- 修正 macOS CI 产物收集路径，支持新版 `release-v*` 输出目录。

本次使用隔离浏览器和模拟桥接验证界面，不启动 Electron GUI、不访问真实钥匙串、
不调用外部供应商 API。因此不将本轮结果表述为新版原生 GUI 或所有外部模型已实测。
Intel、外部 LibreOffice 和 Developer ID 公证的限制同下文。
完整本机证据见 `outputs/macos-merge-validation-report.json`；原始日志与截图保存在 `work/`。

## 本机验收记录（2026-11-08）

环境：macOS 26.6.2、Apple Silicon arm64、Node.js 24、Electron 45.2.3。

- 最终源码回归：2883 项通过，0 项失败；4 项 Windows 专用用例跳过。
- Python 离线测试：26 项通过；本地动画生产 16 场景通过，取消后无残留进程。
- 实际 `.app` 验收：页面加载、IPC、三个懒加载页面、中文空格路径保存与正常退出，共 7 项通过。
- 拼豆实际 PDF 分页、全局坐标、像素及安全检查通过；商品图真实文字与图片渲染通过。
- 最终 DMG/ZIP：源码一致性、Electron 版本、最低系统、Mach-O 架构、完整签名、只读挂载/解压检查通过。
- 钥匙串延迟初始化：14 项凭证库模拟测试及 3 项界面模拟测试通过。该修改之后遵照用户意愿，仅执行模拟测试与打包校验，未再次启动 GUI 或访问真实钥匙串。

本机只验证 Apple Silicon。Intel 已配置 CI，尚未在本轮运行；本机未安装 LibreOffice，
其外部转 PDF 未实测。供应商付费 API 未调用，本地回环模型链路验证不代表外部服务可用性。
当前安装包使用 ad-hoc 签名，未做 Developer ID 签名或 Apple 公证。

汇总报告位于 `outputs/macos-validation-report.json`，测试原始报告与截图保存在 `work/`。

最低系统为 macOS 13 Ventura（Electron 45 自身最低版本）。支持 Apple Silicon
与 Intel，安装包须在对应架构 Mac 上原生构建；动画工具含独立 Python 运行时，
最终用户无需安装 Python、Node.js 或任何构建依赖。

Electron 固定为 **45.2.3**。本机同源码对比发现，45.1.0 打包版在保存退出后会残留
主进程；45.2.3 已通过真实 `.app` 保存退出验收，退出码为 0。

## 从源码运行

需要 Node.js 24，推荐 Python 3.13（仅构建动画工具需要）。在仓库根目录执行：

```sh
npm ci
node node_modules/electron/install.js
npm run build
npm run desktop
```

`npm run dev` 是浏览器开发预览；完整文件系统、密钥存储和本地导出功能由桌面版提供。
`npm` 命令优先使用根目录依赖，仍兼容原有 `work/ui-build` 隔离依赖目录。

动画源代码调试需要已有 Python 和 Pillow。无需 Python 的桌面成品应先按下节构建
动画运行时。应用不会自动执行 pip 或下载工具。

## 构建安装包

```sh
python3 -m venv work/animation-build-venv
work/animation-build-venv/bin/python -m pip install -r tools/gif-factory/build-requirements.txt
export ANIMATION_PYTHON="$PWD/work/animation-build-venv/bin/python"
npm run package:mac
npm run verify:mac
node scripts/verify-macos-installers.mjs
node scripts/verify-macos-launch.mjs
```

`package:mac` 构建 `.app`、拖入 Applications 的 `.dmg` 以及 `.zip`，目录为
`outputs/release-v2.6.0/`；仅需 `.app` 时使用 `npm run package:mac:dir`。
`npm run package` 在当前系统自动选择 macOS 或原有 Windows 安装流程。
Windows C# 磁盘助手和 WPF 维护程序不参与 macOS 构建。

默认使用 ad-hoc 签名，并验证完整 bundle 签名；此签名不包含 Developer ID 或 Apple 公证。
面向其他用户发行前，应配置自己的 Apple Developer ID 和公证凭据，使用
`npm run package:mac -- --config.mac.identity="Developer ID Application: ..."` 构建；源码
和本机验收不代表已获得 Apple 公证。安装后更新采用新 DMG 替换应用，卸载采用
Finder 移除应用；工作区与用户数据保留。

## 回归验证

```sh
npm test -- --config .github/vitest.config.mjs
work/animation-build-venv/bin/python -B -m unittest discover -s tools/gif-factory/tests -v
node scripts/verify-animation-native.cjs
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/verify-macos-desktop.cjs
npm run verify:mac
```

最后一项核对实际 app.asar 与源代码、Mach-O 架构、图标、隐私描述、完整动画资源
及独立工具离线启动；结果写入 `outputs/release-v2.5.0/macos-package-verification.json`。
桌面验收使用隔离配置与中文空格路径，并禁止网络请求；结果及截图位于
`work/macos-desktop-*/`。动画验收实际解码 GIF/PNG、核对帧时长和 ZIP，并检查取消
及退出后的进程清理。测试不会调用付费模型。

安装介质验收会只读挂载 DMG、解压 ZIP 并检查签名及包内内容；真实安装包启动
验收通过本机回环调试连接检查页面、文件保存及正常退出，报告在
`work/macos-package-launch-*/report.json`。常规回归无需输入登录钥匙串密码。
`electron/credential-self-test.cjs` 是独立系统加密诊断，会访问专用测试钥匙串项，
切换 Electron 二进制时可能重新弹出系统授权；无需将它加入常规回归或重复运行。
macOS 启动、刷新密钥库状态与查看凭证元数据均不会初始化钥匙串。只有主动保存
或使用密钥时才调用系统加密；拒绝授权后，后台状态刷新不会重新申请。

生成时出现“登录”钥匙串授权框，所需密码通常是本机 Mac 账户的登录密码。
拒绝或取消后，已保存的 API Key 无法解密，应用会在发送模型请求前停止；此次费用
标记为未发生。界面会区分钥匙串解密失败、凭证库读取失败和凭证缺失，不再统一
提示为附件或结果保存失败。授权完成后仍无法解密时，再在“模型与设置 → 凭证”
替换对应 Key；旧凭证不会被自动删除，失败任务不会自动重发。

`.github/workflows/macos-regression.yml` 在 `develop-macos` 分支和 PR 中分别使用
Apple Silicon 与 Intel 原生 runner 执行测试与打包。旧 Windows 回归流程仍保留。

## 平台行为

- 原生 macOS 标题栏与红黄绿按钮；应用菜单支持 Command 快捷键。
- 路径按 POSIX 语义处理；只接受系统的 `/tmp`、`/var`、`/etc` 三个标准别名，
  仍禁止工作区内部任意符号链接重定向。
- 文件浏览可访问用户目录和 `/Volumes` 中的已挂载卷。首次访问受保护目录时，
  由 macOS 提示授权。
- API 密钥由 Electron safeStorage 使用 macOS 钥匙串加密；不会沿用 Windows 密钥文件。
- Office 原生预览按当前 Mac 的 LibreOffice 安装状态提供；实际支持情况在界面显示，
  其他内置文档与本地图片导出不依赖 Windows Office COM。
