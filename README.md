# deepseek-peak-blocker

DSH（DeepSeek Harness）插件：**DeepSeek 官方 API 高峰时段智能管控**。

在高峰时段（北京时间，UTC+8）对发往 DeepSeek 官方 API 的新请求进行**友好拦截与询问**，实时监控时段切换并对进行中的对话发出**非阻塞提醒**，提供**全局状态面板**（可拖动/可收起）与**手动豁免命令**。

> 架构说明：DSH 中浏览器不直接调用 `api.deepseek.com`，所有模型请求由 Host 进程发起。因此本插件是**混合形态**——Node half 在 `agent/request` / `llm/stream` 处真正拦截与计数，browser half 渲染 UI 并经 HTTP 端点轮询/裁决。判定依据是官方适配器唯一 provider 路由 `deepseek-official`（默认 baseURL `https://api.deepseek.com`，即官方直连计费通道）；第三方代理、Ollama、自定义 provider 一律放行。

## 功能

- **阻塞式拦截**：高峰窗口内发起新的官方请求 → 全屏模态框（时段属性 / 距下一阶段切换剩余时间 / 拦截状态），"继续执行"放行、"取消请求"中止（前端收到 `cancelMessage` 提示，不产生费用）。
- **主动提醒横幅**：低谷→高峰切换瞬间且存在活跃请求时，顶部滑入横幅（自定义文案），10 秒自动淡出或点 ✕；单高峰周期仅一次，回落低谷后重置。
- **右下角状态面板**：每秒刷新——时段（红/绿指示灯）、拦截启用状态、距下一阶段剩余时间（`X小时X分钟` / `X分钟` / `X秒`）、当前活跃 DeepSeek 请求数。可按住标题栏拖动、可收起为胶囊、半透明。
- **斜杠命令**：
  - `/bypass`：当前会话一次性豁免令牌，下一次官方请求直接放行（用后即失效；仅存内存，插件重启清空）。
  - `/status`：向聊天窗口回复面板四项实时状态。
- **长任务**：判定仅基于请求发起瞬间快照；低谷发起的请求跨入高峰不中断；SDK 网络重试作为新请求重新独立判定。
- **精确计数**：`llm/stream` 进出成对维护，完成/报错/中止均释放，无泄漏。

## 高峰时段与缓冲

默认高峰时段（北京时间）：`09:00-12:00`、`14:00-18:00`，前后各 5 分钟软缓冲（实际生效窗口 `08:55-12:05`、`13:55-18:05`）。全部按 UTC+8 计算，不受浏览器/系统时区影响。支持任意非连续时段与跨零点时段（如 `22:00-02:00`）。

## 可配置参数

通过 DSH 的 settings（namespace `deepseek-peak-blocker`）配置，可在 `settings.yaml` 或设置界面调整；未配置时使用以下默认值：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `peakHours` | string[] | `["09:00-12:00", "14:00-18:00"]` | 北京时间高峰时段（`HH:MM-HH:MM`） |
| `bufferMinutes` | number | `5` | 高峰前后缓冲分钟数，`0` 关闭 |
| `blockMessage` | string | `当前为 DeepSeek API 高峰时段，是否继续请求？` | 模态框正文 |
| `cancelMessage` | string | `请求已被用户取消。` | 取消时返回给上层的错误提示 |
| `peakNotification` | string | `⏰ 已进入 API 高峰时段，当前有对话正在进行，请注意响应速度可能受影响。` | 顶部横幅文案 |

## 安装（DSH 插件发现规则）

本插件遵守 DSH bundle 插件发现规则：`package.json` 声明 `dsh.bundle.patch`（组合补丁挂载）与 `dsh.client.platform: "web"`（客户端模块声明），`cordis.patch.yml` 向 web 组合插入插件行，`exports["./client"]` 指向经 `__ModuleLoader__` 加载的客户端 bundle。

在 profile（如 `~/.dsh/profiles/web/`）中：

1. `package.json` 的 `dependencies` 添加（GitHub 安装）：
   ```json
   "deepseek-peak-blocker": "github:<owner>/deepseek-peak-blocker#main"
   ```
2. 同一文件的 `dsh.profile.bundles` 数组追加：
   ```json
   "deepseek-peak-blocker"
   ```
3. 在 profile 目录执行 `pnpm install`（按现有 `whale-girl` 的安装方式即可）。
4. 重启 DSH。Web 端右下角出现状态面板即加载成功；可输入 `/status` 验证。

## 使用提醒

- `/bypass` 令牌与时段状态记录均存于进程内存：插件重启后令牌清空（页面刷新不影响——令牌在 Host 侧）。
- 若将 `api.deepseek.com` 反代至自定义域名并注册为**新 provider**，本插件无法识别、不拦截（视为绕过官方直连计费通道）；若仅修改官方适配器的 baseURL 环境变量，路由标识不变、仍会拦截。
- 模态框长时间无人应答（默认 30 分钟，`decisionTimeoutMs`）会自动取消该请求，避免请求永久挂起。

## License

MIT
