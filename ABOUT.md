# 回响 PALINODE

本地照片重建研究原型，基于 duoduoaiduoduo/gemos-still。

## 已实现

- 原版 SHARP / ONNX Runtime 推理、WebGPU 桌面路径及 CPU/WASM 手机路径。
- 本机记忆库、照片选择、进度与取消、重试、`.still` 导入导出。
- 全新金属环架光学舱、照片入舱动画、可旋转缩放场景。
- 手机底部调节面板、自动环绕、全屏和可配置手机模型源。

## 启动

安装 Node.js 后，在此目录执行 `node tools/serve.mjs`，打开控制台显示的网址。
发布时可将整个静态目录部署到 HTTPS 站点，不需要应用后端。
NFC 标签写入发布后的 HTTPS 网页网址即可。

## 手机模型部署

仓库不附带约 809 MB 的 AI 权重。默认请求本站 `models/gemos-still-lite-v1/`。
从上游官方发布的 Gemos-Still-Lite-256.gemosmodel 包提取以下两文件，放入该目录：

- lite256int8.onnx
- lite256int8.onnx.data

也可在新建记忆的「模型与缓存」内导入模型包，或保存自己的 HTTPS 模型目录。
模型服务器需要正确的 Content-Length、Range / Content-Range；跨域源还需允许 CORS，并暴露长度及范围响应头。
代码保留上游的 SHA-256 校验。桌面模型保持上游下载及缓存逻辑。
手机推理是实验功能，内存和设备兼容性需要真实设备验证。

## 来源及使用范围

原项目：https://github.com/duoduoaiduoduo/gemos-still
保留 LICENSE、THIRD_PARTY_NOTICES.md 和 browser-inference/licenses/。
独立应用代码遵循其 MIT 授权，SHARP 模型不随之获得 MIT 权利。
SHARP 模型限于许可规定的非商业研究和学术用途；本原型不意味着取得产品或商用授权。
请在公开产品开发、发布或商业使用之前解决模型授权。

仓库中的原版 photo.jpg / model.memorygs 等示例仅保留用于本机研究验收，不是本项目自有素材，也不自动具有再发布授权。
正式发布前必须将示例照片、模型和 memory.json 换成有权使用的内容。
原版影片功能暂保留其原有片尾及素材；发布前也应完成影片素材替换与复核。
新观测舱与主界面不使用原作者头像、贴纸或电脑外壳。
