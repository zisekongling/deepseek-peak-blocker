// deepseek-peak-blocker browser half：自渲染管控层（阻塞模态框 / 顶部提醒横幅 /
// 右下角状态面板——可拖动、可收起、半透明）。
// 发现规则：package.json 的 dsh.client.platform="web" + exports["./client"] → 本文件
// 作为客户端插件 bundle 经 __ModuleLoader__ 内核加载（apply(ctx) 返回清理器）。
// 零平台模块依赖：纯 DOM + fetch，CSS 内联注入；端点与 lib/routes.mjs 保持一致。
// 说明：与 Node half 通过 HTTP 端点通信（state 轮询 / resolve 裁决），非 harness RPC。
window.__ModuleLoader__.load({
  id: 'deepseek-peak-blocker',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // 端点（与 lib/routes.mjs 单一前缀保持一致）
    var ROUTE_PREFIX = '/deepseek-peak-blocker'
    var STATE_PATH = ROUTE_PREFIX + '/state'
    var RESOLVE_PATH = ROUTE_PREFIX + '/resolve'
    var POLL_MS = 1000
    var BANNER_MS = 10000

    var CSS = [
      '.pkb-root{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:system-ui,-apple-system,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif}',
      '.pkb-modal-backdrop{position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(8,10,16,.62);pointer-events:auto}',
      '.pkb-modal{width:min(460px,92vw);background:#1b2230;color:#e8ecf4;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:26px 30px;box-shadow:0 24px 64px rgba(0,0,0,.55)}',
      '.pkb-modal h3{margin:0 0 12px;font-size:17px;font-weight:600}',
      '.pkb-body{margin:0 0 18px;color:#c6cddb;line-height:1.65;font-size:14px}',
      '.pkb-info{display:grid;gap:7px;margin-bottom:22px;font-size:13px;color:#a9b3c6}',
      '.pkb-info b{color:#eef2fa;font-weight:600;margin-left:6px}',
      '.pkb-actions{display:flex;gap:12px;justify-content:flex-end}',
      '.pkb-btn{border:0;border-radius:9px;padding:9px 18px;font-size:14px;cursor:pointer;font-family:inherit}',
      '.pkb-btn-primary{background:#4f7cff;color:#fff}',
      '.pkb-btn-primary:hover{background:#4068e0}',
      '.pkb-btn-secondary{background:rgba(255,255,255,.1);color:#e8ecf4}',
      '.pkb-btn-secondary:hover{background:rgba(255,255,255,.18)}',
      '.pkb-banner{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:5;width:min(720px,calc(100vw - 32px));background:#2b3142;color:#f3e9a4;border:1px solid rgba(243,233,164,.45);border-radius:10px;padding:11px 42px 11px 16px;box-shadow:0 10px 28px rgba(0,0,0,.4);font-size:14px;line-height:1.5;animation:pkb-slide .4s ease,pkb-fadeout .6s ease 9.4s forwards}',
      '.pkb-banner-close{position:absolute;top:7px;right:9px;padding:2px 7px;background:none;border:0;color:#f3e9a4;font-size:15px;cursor:pointer;border-radius:6px;pointer-events:auto}',
      '.pkb-banner-close:hover{background:rgba(243,233,164,.16)}',
      '@keyframes pkb-slide{from{transform:translateX(-50%) translateY(-130%)}to{transform:translateX(-50%) translateY(0)}}',
      '@keyframes pkb-fadeout{to{opacity:0;transform:translateX(-50%) translateY(-18px)}}',
      '.pkb-panel{position:fixed;right:16px;bottom:16px;z-index:4;width:236px;background:rgba(18,22,32,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 14px 12px;color:#d9dfeb;font-size:12.5px;box-shadow:0 12px 32px rgba(0,0,0,.3);pointer-events:auto;user-select:none}',
      '.pkb-panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px}',
      '.pkb-panel-handle{flex:1;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b95ab;cursor:grab;touch-action:none;user-select:none;padding:2px 0}',
      '.pkb-panel-handle:active{cursor:grabbing}',
      '.pkb-panel-collapse{background:none;border:0;color:#8b95ab;font-size:12px;cursor:pointer;padding:0 5px;border-radius:6px;pointer-events:auto;line-height:1.4}',
      '.pkb-panel-collapse:hover{background:rgba(255,255,255,.12);color:#d9dfeb}',
      '.pkb-pill{position:fixed;right:16px;bottom:16px;z-index:4;display:inline-flex;align-items:center;gap:8px;background:rgba(18,22,32,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:8px 10px 8px 12px;color:#e2e8f2;font-size:13px;box-shadow:0 10px 28px rgba(0,0,0,.3);pointer-events:auto;user-select:none;cursor:grab;touch-action:none}',
      '.pkb-pill-handle{display:inline-flex;align-items:center;gap:7px}',
      '.pkb-pill-toggle{background:none;border:0;color:#8b95ab;font-size:10px;cursor:pointer;padding:2px 4px;border-radius:6px}',
      '.pkb-pill-toggle:hover{background:rgba(255,255,255,.12);color:#d9dfeb}',
      '.pkb-row{display:flex;align-items:center;justify-content:space-between;padding:4px 0;gap:10px}',
      '.pkb-row b{font-weight:600;color:#f0f4fb}',
      '.pkb-phase{display:inline-flex;align-items:center;gap:6px}',
      '.pkb-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}',
      '.pkb-dot-peak{background:#ff5252;box-shadow:0 0 6px rgba(255,82,82,.85)}',
      '.pkb-dot-low{background:#2ecc71;box-shadow:0 0 6px rgba(46,204,113,.85)}'
    ].join('')

    function formatRemaining(minutes) {
      var totalSeconds = Math.max(0, Math.round(minutes * 60))
      if (totalSeconds > 3600) {
        var h = Math.floor(totalSeconds / 3600)
        var m = Math.floor((totalSeconds % 3600) / 60)
        return h + '小时' + m + '分钟'
      }
      if (totalSeconds > 60) return Math.floor(totalSeconds / 60) + '分钟'
      return Math.max(1, Math.ceil(totalSeconds)) + '秒'
    }

    function apply(ctx) {
      // 幂等守卫：bundle 重复执行（dev/HMR 重建、loader 重跑）时不双实例双样式
      if (document.querySelector('.pkb-root') !== null) {
        console.warn('[deepseek-peak-blocker] 已存在实例，跳过重复挂载')
        return function () {}
      }

      var style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)

      var root = document.createElement('div')
      root.className = 'pkb-root'
      document.body.appendChild(root)

      // ---- 右下角状态面板（可拖动 / 可收起 / 半透明） ----
      var panel = document.createElement('div')
      panel.className = 'pkb-panel'
      panel.innerHTML =
        '<div class="pkb-panel-header">' +
        '<span class="pkb-panel-handle" title="拖动移动面板">DeepSeek 高峰管控</span>' +
        '<button class="pkb-panel-collapse" title="收起面板" aria-label="收起面板">—</button>' +
        '</div>' +
        '<div class="pkb-row"><span>当前时段</span><span class="pkb-phase"><i class="pkb-dot"></i><b class="pkb-phase-label">低谷</b></span></div>' +
        '<div class="pkb-row"><span>拦截状态</span><b class="pkb-enabled">未启用</b></div>' +
        '<div class="pkb-row"><span>距下一阶段</span><b class="pkb-remaining">—</b></div>' +
        '<div class="pkb-row"><span>活跃 DeepSeek 请求</span><b class="pkb-active">0</b></div>'
      root.appendChild(panel)

      // ---- 收起态胶囊 ----
      var pill = document.createElement('div')
      pill.className = 'pkb-pill'
      pill.style.display = 'none'
      pill.innerHTML =
        '<span class="pkb-pill-handle" title="拖动移动，点击展开"><i class="pkb-dot"></i><b class="pkb-pill-label">低谷</b></span>' +
        '<button class="pkb-pill-toggle" title="展开面板" aria-label="展开面板">▲</button>'
      root.appendChild(pill)

      // ---- 顶部提醒横幅（10 秒自动淡出，可 ✕ 关闭） ----
      var banner = document.createElement('div')
      banner.className = 'pkb-banner'
      banner.style.display = 'none'
      var bannerText = document.createElement('span')
      var bannerClose = document.createElement('button')
      bannerClose.className = 'pkb-banner-close'
      bannerClose.textContent = '✕'
      bannerClose.setAttribute('aria-label', '关闭')
      banner.appendChild(bannerText)
      banner.appendChild(bannerClose)
      root.appendChild(banner)

      // ---- 阻塞式模态框（覆盖全屏，等用户裁决） ----
      var modal = document.createElement('div')
      modal.className = 'pkb-modal-backdrop'
      modal.style.display = 'none'
      modal.innerHTML =
        '<div class="pkb-modal" role="dialog" aria-modal="true">' +
        '<h3>DeepSeek API 请求确认</h3>' +
        '<p class="pkb-body"></p>' +
        '<div class="pkb-info">' +
        '<div>当前时段：<b class="pkb-m-phase"></b></div>' +
        '<div>距下一阶段切换：<b class="pkb-m-remaining"></b></div>' +
        '<div>拦截状态：<b class="pkb-m-enabled"></b></div>' +
        '</div>' +
        '<div class="pkb-actions">' +
        '<button class="pkb-btn pkb-btn-secondary" type="button">取消请求</button>' +
        '<button class="pkb-btn pkb-btn-primary" type="button">继续执行</button>' +
        '</div>' +
        '</div>'
      root.appendChild(modal)

      // ---- 运行时状态 ----
      var snap = null
      var collapsed = false
      var pos = null // { left, top } | null（null = 默认右下角）
      var bannerNonce = 0
      var bannerTimer = null
      var pollTimer = null
      var dragState = null
      var disposed = false

      // ---- 拖动（原生 pointer 事件，视口边缘钳制） ----
      function surface() {
        return collapsed ? pill : panel
      }
      function beginDrag(e) {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return
        e.preventDefault()
        var el = surface()
        var rect = el.getBoundingClientRect()
        dragState = { baseLeft: rect.left, baseTop: rect.top, startX: e.clientX, startY: e.clientY, width: rect.width, height: rect.height }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
      }
      function onMove(ev) {
        if (dragState === null) return
        var vw = (typeof window !== 'undefined' ? window.innerWidth : 0) || 1280
        var vh = (typeof window !== 'undefined' ? window.innerHeight : 0) || 800
        var left = Math.min(Math.max(dragState.baseLeft + ev.clientX - dragState.startX, 8), Math.max(8, vw - dragState.width - 8))
        var top = Math.min(Math.max(dragState.baseTop + ev.clientY - dragState.startY, 8), Math.max(8, vh - dragState.height - 8))
        pos = { left: Math.round(left), top: Math.round(top) }
        applyPosition(surface())
      }
      function onUp() {
        dragState = null
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      function applyPosition(el) {
        if (pos !== null) {
          el.style.left = pos.left + 'px'
          el.style.top = pos.top + 'px'
          el.style.right = 'auto'
          el.style.bottom = 'auto'
        } else {
          el.style.left = ''
          el.style.top = ''
          el.style.right = ''
          el.style.bottom = ''
        }
      }

      // ---- 事件接线 ----
      panel.querySelector('.pkb-panel-handle').addEventListener('pointerdown', beginDrag)
      panel.querySelector('.pkb-panel-collapse').addEventListener('click', function () {
        collapsed = true
        render()
      })
      pill.querySelector('.pkb-pill-handle').addEventListener('pointerdown', beginDrag)
      pill.querySelector('.pkb-pill-toggle').addEventListener('click', function () {
        collapsed = false
        render()
      })
      bannerClose.addEventListener('click', function () {
        banner.style.display = 'none'
        if (bannerTimer !== null) {
          clearTimeout(bannerTimer)
          bannerTimer = null
        }
      })
      modal.querySelector('.pkb-btn-secondary').addEventListener('click', function () {
        resolvePending('cancel')
      })
      modal.querySelector('.pkb-btn-primary').addEventListener('click', function () {
        resolvePending('continue')
      })

      function resolvePending(decision) {
        var p = snap && snap.pending
        if (!p) return
        fetch(RESOLVE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: p.id, decision: decision }),
        }).catch(function () {})
      }

      // ---- 渲染 ----
      function render() {
        if (snap === null || disposed) return
        var isPeak = snap.phase === 'peak'
        var remaining = formatRemaining(snap.nextTransitionMinutes)
        var enabled = snap.interceptionEnabled
        var dotClass = 'pkb-dot ' + (isPeak ? 'pkb-dot-peak' : 'pkb-dot-low')
        var dots = root.querySelectorAll('.pkb-dot')
        for (var i = 0; i < dots.length; i++) dots[i].className = dotClass

        panel.querySelector('.pkb-phase-label').textContent = snap.phaseLabel
        panel.querySelector('.pkb-enabled').textContent = enabled ? '已启用' : '未启用'
        panel.querySelector('.pkb-remaining').textContent = remaining
        panel.querySelector('.pkb-active').textContent = String(snap.activeCount)
        pill.querySelector('.pkb-pill-label').textContent = snap.phaseLabel

        // 面板 / 胶囊切换
        panel.style.display = collapsed ? 'none' : ''
        pill.style.display = collapsed ? '' : 'none'

        // 横幅：新 nonce 展示一次，10 秒后自动淡出（CSS 动画），✕ 可立即关闭
        var b = snap.banner
        if (b && b.nonce !== bannerNonce) {
          bannerNonce = b.nonce
          bannerText.textContent = b.text
          banner.style.display = ''
          if (bannerTimer !== null) clearTimeout(bannerTimer)
          bannerTimer = setTimeout(function () {
            banner.style.display = 'none'
            bannerTimer = null
          }, BANNER_MS)
        }

        // 模态框：存在待裁决请求时显示
        var pending = snap.pending
        if (pending) {
          modal.querySelector('.pkb-body').textContent = pending.blockMessage
          modal.querySelector('.pkb-m-phase').textContent = snap.phaseLabel
          modal.querySelector('.pkb-m-remaining').textContent = remaining
          modal.querySelector('.pkb-m-enabled').textContent = enabled ? '已启用' : '未启用'
          modal.style.display = ''
        } else {
          modal.style.display = 'none'
        }

        applyPosition(surface())
      }

      // ---- 每秒轮询 Host 状态 ----
      function poll() {
        fetch(STATE_PATH, { cache: 'no-store' })
          .then(function (res) {
            if (res.ok) return res.json()
            throw new Error('state ' + res.status)
          })
          .then(function (state) {
            snap = state
            render()
          })
          .catch(function () { /* Host 尚未就绪/瞬态错误：等待下一轮 */ })
      }
      poll()
      pollTimer = setInterval(poll, POLL_MS)

      // ---- 清理器（fiber 卸载 / 页面关闭时调用） ----
      var dispose = function () {
        if (disposed) return
        disposed = true
        if (pollTimer !== null) clearInterval(pollTimer)
        if (bannerTimer !== null) clearTimeout(bannerTimer)
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        root.remove()
        style.remove()
      }
      return dispose
    }

    module.exports = { name: 'deepseek-peak-blocker', apply: apply }
    return module.exports
  }
})
