# Codex Quota Orb

Codex Quota Orb 是一个仅在本机运行的 Windows 额度悬浮球。它在检测到 Codex 桌面端运行时显示，读取本机 Codex App Server 返回的 5h、7d 和月度 Token 数据。

## 第一版范围

- Windows 10/11 x64。
- 88×88、112×112、136×136 三档透明紫色液体悬浮球。
- 悬浮球固定为紧凑的 88×88 尺寸。
- 5h 与 7d 在球内上下显示；液位代表 7d 剩余额度。
- 320ms 展开、260ms 收起为只包含 7d 和 Token 统计的面板。
- 登录后台启动，Codex 启动时显示、退出时隐藏。
- 面板展开期间仅监听鼠标按下位置，用于识别外部点击并收回；不监听键盘，不保存坐标。
- 本地数据处理，不上传遥测，不保存账号令牌。

## 本地检查

```powershell
npm install
npm run typecheck
npm test
npm run dev
```

非 Windows 系统可以运行类型检查、测试和渲染层构建，但不能证明 Windows 透明窗口、进程监测、登录启动或安装包真实可用。

## Windows 安装包

GitHub Actions 的 `Build Windows test installer` 工作流会生成：

```text
CodexQuotaOrb-Setup-0.1.3-x64.exe
```

该测试包未进行 Authenticode 签名，Windows SmartScreen 可能显示未知发布者提示。

## 数据兼容性

额度读取依赖 Codex 本地 App Server 的实验接口：

- `account/rateLimits/read`
- `account/usage/read`

300 分钟窗口识别为 5h，10080 分钟窗口识别为 7d。Codex 更新后如果协议发生变化，应先更新解析测试，不得用样例或旧额度代替读取失败。
