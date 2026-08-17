// 配置系统：体验层 schema + 默认值（单一来源）。
// 契约：
// - DEFAULTS 是消费端的唯一权威默认值来源；消费端不得再写第二份默认值字面量。
// - schemastery schema 供 settings.register 使用（宿主原生格式，可注入校验）。
// - 零宿主依赖、可单测。
import z from 'schemastery'

export const NAMESPACE = 'deepseek-peak-blocker'

/** 体验层默认值（消费端唯一权威）。 */
export const DEFAULTS = Object.freeze({
  peakHours: ['09:00-12:00', '14:00-18:00'], // 北京时间高峰时段（HH:MM-HH:MM，可任意非连续，支持跨零点）
  bufferMinutes: 5, // 高峰前后软缓冲分钟数，设 0 关闭
  blockMessage: '当前为 DeepSeek API 高峰时段，是否继续请求？',
  cancelMessage: '请求已被用户取消。',
  peakNotification: '⏰ 已进入 API 高峰时段，当前有对话正在进行，请注意响应速度可能受影响。',
  decisionTimeoutMs: 30 * 60 * 1000, // 安全兜底：模态框无人应答时自动取消请求的时长
})

/** schemastery schema（settings.register 用；默认值 = DEFAULTS，防双源漂移）。 */
export function buildSchema() {
  return z.object({
    peakHours: z.array(z.string()).default(DEFAULTS.peakHours),
    bufferMinutes: z.number().min(0).max(120).default(DEFAULTS.bufferMinutes),
    blockMessage: z.string().default(DEFAULTS.blockMessage),
    cancelMessage: z.string().default(DEFAULTS.cancelMessage),
    peakNotification: z.string().default(DEFAULTS.peakNotification),
    decisionTimeoutMs: z.number().min(1000).max(3600000).default(DEFAULTS.decisionTimeoutMs),
  })
}

/** 跨字段校验（schema 表达不了的约束；settings.register 的 validate 用）。 */
export function validateConfig(value) {
  const hours = value?.peakHours
  if (!Array.isArray(hours)) return
  for (const h of hours) {
    if (typeof h !== 'string' || !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(h.trim())) {
      throw new Error(`peakHours 条目 "${String(h)}" 必须是 "HH:MM-HH:MM" 格式`)
    }
  }
}
