// deepseek-peak-blocker Node half：DeepSeek 官方 API 高峰时段智能管控。
// 发现规则：bundle 插件（package.json dsh.bundle.patch → cordis.patch.yml 挂载），
// name/inject/apply 三件套为标准 Cordis 插件；浏览器端经 webServer 注册的 HTTP
// 端点（见 routes.mjs）轮询状态与裁决请求——不在同一进程内走 harness RPC。
//
// 拦截面（与 DSH 架构对应）：
// - provider 路由 deepseek-official 即官方 DeepSeek 直连计费通道（适配器
//   @deepseek-ai/dsh-llm-deepseek，默认 baseURL https://api.deepseek.com）；
//   第三方/自定义路由一律放行，零开销。
// - agent/request 瀑布：请求发起瞬间判定，高峰窗口内挂起等浏览器裁决。
// - llm/stream 瀑布：活跃官方请求进出成对计数，完成/报错/中止均释放。
import { STATE_PATH, RESOLVE_PATH } from './routes.mjs'
import { NAMESPACE, DEFAULTS, buildSchema, validateConfig } from './config.mjs'

export const name = 'deepseek-peak-blocker'
// 关键：webServer 必须声明为硬依赖（inject）——cordis 会挂起本插件直到 webServer
// 服务就绪（webServer 由 dsh-web-app 层提供，晚于 dsh-base 的 timer/commands）。
// 若只用 ctx.get('webServer') 可选读取，apply 会在 webServer 出现前执行，
// 路由注册被静默跳过（fiber 虽 active 但端点全无；whale-girl 正是靠 inject 规避）。
export const inject = ['commands', 'timer', 'webServer']

const DEEPSEEK_PROVIDER = 'deepseek-official'

export function apply(ctx) {
  // ==================== 配置（settings 服务条件接入；缺失时回退 DEFAULTS） ====================
  let configRef = { ...DEFAULTS }
  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  if (settings !== undefined && typeof settings.register === 'function') {
    try {
      const scope = settings.register(NAMESPACE, buildSchema(), { applies: 'live', validate: validateConfig })
      configRef = { ...DEFAULTS, ...scope.get() }
      scope.watch((next) => {
        configRef = { ...DEFAULTS, ...next }
      })
    } catch {
      // register 失败（如重复注册）→ 保持 DEFAULTS
    }
  }

  // ==================== 北京时间（UTC+8）时段计算 ====================
  const beijingMinutes = (date) => (date.getUTCHours() * 60 + date.getUTCMinutes() + 480) % 1440
  const parseMin = (s) => {
    const p = s.split(':')
    return Number(p[0]) * 60 + Number(p[1] ?? 0)
  }
  const windowsOf = () => (configRef.peakHours ?? [])
    .map((w) => {
      const parts = String(w).split('-')
      return { start: parseMin(parts[0].trim()), end: parseMin(parts[1].trim()) }
    })
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
  const inWindow = (m, win) => {
    const s = (win.start - configRef.bufferMinutes + 1440) % 1440
    const e = (win.end + configRef.bufferMinutes) % 1440
    return s <= e ? (m >= s && m < e) : (m >= s || m < e) // 支持跨零点时段
  }
  const phaseAt = (m) => (windowsOf().some((w) => inWindow(m, w)) ? 'peak' : 'low')
  const nextTransitionMinutes = (m) => {
    let best = Infinity
    for (const w of windowsOf()) {
      for (const b of [(w.start - configRef.bufferMinutes + 1440) % 1440, (w.end + configRef.bufferMinutes) % 1440]) {
        let d = b - m
        if (d <= 0) d += 1440
        if (d < best) best = d
      }
    }
    return Number.isFinite(best) ? best : 1440
  }
  const formatRemaining = (minutes) => {
    const totalSeconds = Math.max(0, Math.round(minutes * 60))
    if (totalSeconds > 3600) {
      const h = Math.floor(totalSeconds / 3600)
      const m = Math.floor((totalSeconds % 3600) / 60)
      return `${h}小时${m}分钟`
    }
    if (totalSeconds > 60) return `${Math.floor(totalSeconds / 60)}分钟`
    return `${Math.max(1, Math.ceil(totalSeconds))}秒`
  }

  // ==================== 进程内存状态 ====================
  let activeCount = 0 // 当前活跃的 DeepSeek 官方流式请求数
  const bypassTokens = new Map() // sessionId -> true（一次性豁免令牌，仅存内存）
  const pendingBlocks = new Map() // blockId -> entry（等待浏览器裁决的请求）
  let lastPhase = null // 'peak' | 'low'
  let bannerFired = false // 本高峰周期是否已触发过横幅（回落低谷后重置）
  let banner = null // { nonce, text } | null
  let blockSeq = 0
  let bannerSeq = 0

  // ==================== 状态快照 ====================
  const snapshot = (now) => {
    const m = beijingMinutes(now)
    const peak = phaseAt(m) === 'peak'
    let pending = null
    for (const entry of pendingBlocks.values()) pending = entry // 取最新一个待裁决请求
    return {
      phase: peak ? 'peak' : 'low',
      phaseLabel: peak ? '高峰' : '低谷',
      interceptionEnabled: peak,
      activeCount,
      nextTransitionMinutes: nextTransitionMinutes(m),
      banner,
      pending: pending ? { id: pending.id, blockMessage: configRef.blockMessage } : null,
    }
  }

  // ==================== 斜杠命令：/bypass 与 /status ====================
  try {
    ctx.commands.register({
      name: 'bypass',
      description: '为当前会话设置一次性 DeepSeek 高峰豁免令牌：下一次 DeepSeek API 请求直接放行',
      handler: (invocation) => {
        bypassTokens.set(invocation.agent.id, true)
        return { kind: 'success', text: '已为当前会话设置一次性高峰豁免令牌：下一次 DeepSeek API 请求将无视高峰时段，直接放行（令牌使用后立即失效）。' }
      },
    })
  } catch (error) {
    console.error('[deepseek-peak-blocker] 注册 /bypass 失败', error)
  }
  try {
    ctx.commands.register({
      name: 'status',
      description: '查看 DeepSeek 高峰管控实时状态（时段/剩余切换时间/拦截状态/活跃请求数）',
      handler: () => {
        const s = snapshot(new Date())
        return {
          kind: 'success',
          text: [
            `当前时段：${s.phaseLabel}`,
            `拦截状态：${s.interceptionEnabled ? '已启用' : '未启用'}`,
            `距下一阶段切换：${formatRemaining(s.nextTransitionMinutes)}`,
            `当前活跃 DeepSeek API 请求：${s.activeCount}`,
          ].join('\n'),
        }
      },
    })
  } catch (error) {
    console.error('[deepseek-peak-blocker] 注册 /status 失败', error)
  }

  // ==================== 阻塞式拦截管道（agent/request 瀑布） ====================
  const createPending = (payload, now) => {
    const id = `blk-${++blockSeq}`
    const entry = { id, sessionId: payload.agent.id, createdAt: now.getTime(), settled: false, resolve: null }
    const decisionPromise = new Promise((resolve) => {
      entry.resolve = resolve
    })
    const abortPromise = new Promise((_, reject) => {
      const onAbort = () => reject(new Error('agent turn aborted while awaiting peak-block decision'))
      if (payload.signal.aborted) onAbort()
      else payload.signal.addEventListener('abort', onAbort, { once: true })
      entry.cleanupAbort = () => payload.signal.removeEventListener('abort', onAbort)
    })
    entry.decision = Promise.race([decisionPromise, abortPromise])
    entry.settle = (decision) => {
      if (entry.settled) return
      entry.settled = true
      if (typeof entry.cleanupAbort === 'function') {
        entry.cleanupAbort()
        entry.cleanupAbort = null
      }
      entry.resolve(decision)
    }
    // 安全兜底：长时间无人裁决则自动取消，避免请求永久挂起
    entry.safetyTimer = ctx.setTimeout(() => {
      if (pendingBlocks.get(id) === entry) entry.settle('cancel')
    }, configRef.decisionTimeoutMs)
    pendingBlocks.set(id, entry)
    return entry
  }

  ctx.on('agent/request', async (payload, next) => {
    const config = await next() // 取最终冻结的调用配置（含用户当前选择的 provider/model）
    if (!config || config.provider !== DEEPSEEK_PROVIDER) return config // 非官方通道：完全放行
    const sessionId = payload.agent.id
    if (bypassTokens.delete(sessionId)) return config // /bypass 一次性令牌：本次直接放行并立即失效
    const now = new Date()
    if (phaseAt(beijingMinutes(now)) !== 'peak') return config // 低谷：直接放行（发起瞬间快照判定）

    // 高峰窗口：冻结时间快照，等待浏览器模态框裁决
    const entry = createPending(payload, now)
    let decision
    try {
      decision = await entry.decision
    } finally {
      if (pendingBlocks.get(entry.id) === entry) pendingBlocks.delete(entry.id)
      entry.settle('cancel') // 幂等：已裁决则无操作
    }
    if (decision === 'continue') return config
    const cancel = new Error(configRef.cancelMessage)
    cancel.name = 'PeakBlockCanceled'
    throw cancel // 抛错 = 彻底中止该请求；上层界面收到 cancelMessage 作为取消提示
  })

  // ==================== 活跃请求精确计数（llm/stream 瀑布，进出必成对） ====================
  ctx.on('llm/stream', (options, next) => {
    if (!options || options.provider !== DEEPSEEK_PROVIDER) return next()
    activeCount += 1
    let stream
    try {
      stream = next()
    } catch (error) {
      activeCount = Math.max(0, activeCount - 1)
      throw error
    }
    const tracked = (async function* () {
      try {
        for await (const chunk of await stream) yield chunk
      } finally {
        activeCount = Math.max(0, activeCount - 1) // 完成/报错/中止均会释放计数，杜绝泄漏
      }
    })()
    return tracked
  })

  // ==================== 每秒常驻定时器：时段切换检测 + 主动提醒 ====================
  const tickId = ctx.setInterval(() => {
    const now = new Date()
    const peak = phaseAt(beijingMinutes(now)) === 'peak'
    if (peak) {
      if (lastPhase === 'low') {
        // 刚从低谷跨入高峰：仅当此刻存在活跃请求时触发一次横幅；本周期内不再重复
        bannerFired = true
        if (activeCount > 0) {
          banner = { nonce: ++bannerSeq, text: configRef.peakNotification }
          const myNonce = banner.nonce
          ctx.setTimeout(() => {
            if (banner && banner.nonce === myNonce) banner = null
          }, 10000) // 横幅展示 10 秒后由 Host 侧清空（浏览器侧同步自动淡出）
        }
      }
    } else if (lastPhase === 'peak') {
      bannerFired = false // 回落低谷：重置触发资格，下次进入高峰可再次提醒
    }
    lastPhase = peak ? 'peak' : 'low'
  }, 1000)

  // ==================== 浏览器端 HTTP 端点（state 轮询 / resolve 裁决） ====================
  // webServer 已声明为 inject 硬依赖：cordis 保证 apply 执行时服务必然就绪。
  const webServer = ctx.webServer
  const disposers = []
  const json = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra })
    res.end(JSON.stringify(body))
  }
  // POST 端点 CSRF 面：跨源请求拒绝（恶意网页不能替用户裁决/喂请求）
  const isCrossOrigin = (req) => {
    const origin = req.headers?.origin
    const host = req.headers?.host
    if (typeof origin !== 'string' || origin === '') return false
    if (typeof host !== 'string' || host === '') return true
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }
  if (webServer !== undefined && typeof webServer.register === 'function') {
    // 每条路由独立 try/catch：单条注册失败不牵连另一条，且错误可见
    try {
      disposers.push(webServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          try {
            json(res, 200, snapshot(new Date()), { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }))
      // resolve 端点独立注册
      try {
        disposers.push(webServer.register({
          kind: 'exact',
          path: RESOLVE_PATH,
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { allow: 'POST' })
              res.end()
              return
            }
            if (isCrossOrigin(req)) {
              json(res, 403, { error: 'cross-origin request rejected' })
              return
            }
            let raw = ''
            try {
              for await (const chunk of req) {
                raw += chunk
                if (raw.length > 4096) {
                  res.writeHead(413)
                  res.end()
                  return
                }
              }
            } catch {
              json(res, 400, { error: 'invalid request body' })
              return
            }
            let body = null
            try {
              body = JSON.parse(raw || '{}')
            } catch {
              json(res, 400, { error: 'invalid JSON body' })
              return
            }
            const id = typeof body?.id === 'string' ? body.id : null
            const entry = id && pendingBlocks.get(id)
            if (!entry) {
              json(res, 200, { ok: false })
              return
            }
            pendingBlocks.delete(id)
            entry.settle(body?.decision === 'continue' ? 'continue' : 'cancel')
            json(res, 200, { ok: true })
          },
        }))
      } catch (error) {
        console.error('[deepseek-peak-blocker] 注册 resolve 端点失败', error)
      }
    } catch (error) {
      console.error('[deepseek-peak-blocker] 注册 state 端点失败', error)
    }
  }

  // ==================== 资源回收：插件停止时释放所有挂起请求 ====================
  ctx.effect(() => () => {
    for (const entry of pendingBlocks.values()) entry.settle('cancel')
    pendingBlocks.clear()
    ctx.clearInterval(tickId)
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 端点已随 fiber 卸载时忽略
      }
    }
  })
}
