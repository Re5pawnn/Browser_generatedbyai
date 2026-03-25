# Nebula Browser (Chromium-based)

这是一个基于 **Chromium 内核** 的桌面浏览器原型，底层使用 Electron（Electron 内核即 Chromium + Node.js）。

## 已实现功能

- 多标签页（新建、切换、关闭）
- 地址栏导航（输入 URL 或关键词搜索）
- 前进 / 后退 / 刷新 / 主页
- 开发者工具开关（F12）
- 书签功能（添加、打开、删除）
- 本地书签持久化（`userData/bookmarks.json`）

## 快速启动

1. 安装依赖（PowerShell 下建议用 `cmd /c` 规避执行策略问题）

```powershell
cmd /c npm install
```

如果 Electron 下载慢或失败（常见于网络问题），可使用镜像源：

```powershell
cmd /c "set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && npm install"
```

2. 启动

```powershell
cmd /c npm start
```

## 快捷键

- `Ctrl+T`: 新建标签页
- `Ctrl+W`: 关闭当前标签页
- `Ctrl+L`: 聚焦地址栏
- `Ctrl+R`: 刷新
- `Ctrl+D`: 添加/移除当前页书签
- `F12`: 打开/关闭开发者工具

## 项目结构

```text
src/
  main/
    main.js       # 主进程：窗口、标签、导航、书签 IPC
    preload.js    # 安全桥接 API
  renderer/
    index.html    # 顶部 UI
    styles.css    # UI 样式
    renderer.js   # 交互逻辑
```

## 说明

- 这是一个可以继续扩展的浏览器壳工程，目标是快速构建“可运行 + 可二开”的 Chromium 浏览器应用。
- 如果你要做“更接近原生 Chromium 产品”的版本，下一阶段建议引入：
  - 用户配置管理（启动参数、代理、UA、下载目录）
  - 历史记录和会话恢复
  - 下载管理器
  - 插件系统（扩展协议/脚本注入）
  - 自动更新与安装包构建
