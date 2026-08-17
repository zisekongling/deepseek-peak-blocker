// 路由前缀单一来源：Node half 的 webServer 端点与浏览器 half 的 fetch 路径共用
// 同一前缀（client bundle 为单文件自包含，此处常量与 lib/client.js 顶部常量保持一致）。
export const ROUTE_PREFIX = '/deepseek-peak-blocker'
export const STATE_PATH = `${ROUTE_PREFIX}/state`
export const RESOLVE_PATH = `${ROUTE_PREFIX}/resolve`
