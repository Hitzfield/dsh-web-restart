/**
 * dsh-web-restart — host half (hardened fork).
 *
 * Registers an exact POST route `/restart-dsh` on the webServer. The client
 * button (lib/client.js) fetches this route; the handler launches the machine
 * restart script (see restartScriptPath()) as an independent hidden
 * PowerShell process (Start-Process wrapper so the script survives the DSH
 * kill), under danger-full-access so netstat/taskkill are not sandbox-denied.
 *
 * Also registers GET /dsh-health — a lightweight liveness probe the client
 * status dot polls every few seconds.
 *
 * The route returns BEFORE the restart happens (1s timer + the script's own
 * 2s pre-sleep), so the browser has time to render the "restarting" state
 * before the page drops.
 *
 * Changes vs upstream (0.1.0):
 *  - restart script path is configurable: env DSH_WEB_RESTART_SCRIPT, else
 *    <DSH_HOME>/dsh-web-restart/restart-dsh-web.ps1 — no hardcoded machine
 *    path. The resolved path must be absolute and must exist, otherwise the
 *    route answers 500 with the reason instead of launching garbage.
 *  - the script is launched with `-File` (a quoted argument), never by
 *    string-building a `-Command` blob.
 *  - POST /restart-dsh rejects requests whose Origin/Referer host does not
 *    match the request Host (cheap CSRF fence for this unauthenticated route).
 */
import { join, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

export const name = 'dsh-web-restart'
export const inject = ['webServer', 'shell']

function restartScriptPath() {
  const configured = process.env.DSH_WEB_RESTART_SCRIPT
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  const home = process.env.DSH_HOME || homedir()
  return join(home, 'dsh-web-restart', 'restart-dsh-web.ps1')
}

/** Cheap CSRF fence: if the caller sent Origin/Referer, its host must equal the request Host. */
function originMatchesHost(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return true
  for (const value of [req.headers.origin, req.headers.referer]) {
    if (typeof value !== 'string' || value === '') continue
    let url
    try {
      url = new URL(value)
    } catch {
      return false
    }
    if (url.host !== host) return false
  }
  return true
}

export function apply(ctx) {
  let restarting = false

  const disposeHealth = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-health',
    handler: async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, ts: Date.now() }))
    }
  })

  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/restart-dsh',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      if (!originMatchesHost(req)) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'forbidden: cross-origin restart is not allowed' }))
        return
      }
      if (restarting) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: '重启已在进行中，请稍候' }))
        return
      }
      const script = restartScriptPath()
      if (!isAbsolute(script) || !existsSync(script)) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: `重启脚本不存在或路径无效: ${script}（可用环境变量 DSH_WEB_RESTART_SCRIPT 指定）` }))
        return
      }
      restarting = true
      // 注意：webServer handler 是纯 Node http 回调，不在 Cordis fiber 上下文里，
      // ctx.timeout（mixin→ctx.effect）在此不触发；改用 Node 原生 setTimeout。
      setTimeout(() => {
        try {
          // 独立进程 + 脚本内置 2 秒延迟：DSH 被脚本杀掉后脚本继续执行，前端有时间渲染状态。
          // -File 传脚本路径（单引号转义），避免 -Command 字符串拼接。
          const command = `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script.replace(/'/g, "''")}' -WindowStyle Hidden`
          const spec = ctx.shell.resolve({
            command,
            sandboxPolicy: { mode: 'danger-full-access' }
          })
          ctx.shell.start(spec)
          console.log(`[dsh-web-restart] restart script launched: ${script}`)
        } catch (error) {
          restarting = false
          console.error('[dsh-web-restart] failed to launch restart:', error)
        }
      }, 1000)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, message: '重启已触发：DSH 将断开约 15-20 秒，之后请刷新页面' }))
    }
  })

  return () => { disposeHealth(); disposeRoute() }
}
