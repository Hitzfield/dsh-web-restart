# dsh-web-restart

**DeepSeek Harness Web 界面的一键重启按钮。**

在侧边栏底部（设置按钮旁）增加一个圆形重启按钮（↻）。**单击**即可立即重启 `dsh web` 进程——页面断开约 15–20 秒，刷新后一切恢复（会话数据自动落盘并恢复）。按钮是**常驻**的：它触发的重启不会把它自己带走。

> 仅限 Windows：重启通过独立的隐藏 PowerShell 进程拉起 `dsh web`，因此即使 harness 进程被杀死，脚本也会继续执行完毕。

## 功能

- 单击直接重启——无需二次确认，也不用连点两下。
- 常驻：以 bundle 层插件安装，DSH 重启后依然存在（不是会话级动态插件）。
- 轻量：位于侧边栏底部设置入口旁；56px 窄轨只显示图标，宽轨显示图标 + 文字。
- 状态反馈：请求处理中按钮变红并显示「重启中…」→「已触发」。
- 防重入：重启进行中再次点击会被拒绝。

## 安装

### 通过 GitHub（本仓库）

```bash
dsh plugin --profile web add github:YOUR_OWNER/dsh-web-restart
```

然后重启一次 `dsh web`，让 bundle 层加载。

### 手动（编辑 profile 文件）

1. 添加依赖：

```jsonc
// ~/.dsh/profiles/web/package.json
{
  "dependencies": {
    "dsh-web-restart": "github:YOUR_OWNER/dsh-web-restart"
  }
}
```

2. 添加插件行（本仓库自带 `cordis.patch.yml`——可将其中的行合并进你的 profile 的 `cordis.patch.yml`，或用上面的 `dsh plugin` 命令自动完成）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: dsh-web-restart
      name: dsh-web-restart
```

3. 在 profile 目录执行 `pnpm install`，然后重启 `dsh web`。

## 工作原理

| 层 | 文件 | 作用 |
| --- | --- | --- |
| Host | `lib/index.js` | 在 webServer 注册精确路由 `POST /restart-dsh`；以 `danger-full-access` 沙箱策略、独立隐藏 PowerShell 进程启动重启脚本 |
| Client | `lib/client.js` | 在 `sidebar.footer.action` slot 注册侧边栏底部按钮；单击 `fetch` `POST /restart-dsh` |
| Bundle | `cordis.patch.yml` | 同时挂载 host / client 两半的加载器行 |

host 路由在重启发生**之前**返回（约 1 秒宿主定时器 + 3 秒内部延迟），给浏览器留出渲染「重启中」状态的时间。

### 为什么路由 handler 里不用 `ctx.timeout`

`ctx.timeout` 是 Cordis mixin，底层由 `ctx.effect()` 实现，而 `ctx.effect` 绑定 **fiber** 生命周期。`webServer` 路由 handler 是纯 Node HTTP 回调——不在任何 fiber 上下文中——因此 `ctx.effect` 注册的定时器会被静默丢弃，重启永远不触发。本插件在 handler 中使用 Node 原生 `setTimeout` 解决。

## 兼容性

- DeepSeek Harness `0.1.0-rc.6`（web profile）。
- 重启脚本路径（`D:\1\dsh-web-host.ps1`）硬编码自作者机器——**请 fork 后自行调整**（或替换 `lib/index.js` 中的命令）。欢迎贡献使其可配置。

## 开发

client bundle 按标准线格式手写（`window.__ModuleLoader__.load({ id, factory })`），因此无需构建步骤：

```bash
node --check lib/index.js
node --check lib/client.js
```

## License

MIT
