/**
 * 侧栏图片地址的唯一封装点（规范 §10.2）。
 *
 * 只用 `ctx.betterSidebar.hostRouteUrl()` 拼 better-sidebar 自己的 `/sidebar/file` 路由，
 * 参数一律经 `URLSearchParams` 编码。写错的表现是「图不显示且不报错」——最难查的一种失败，
 * 所以别处不许再拼 `sidebar/file`；将来换回原生侧栏也只改这一个文件。
 */

/** 侧栏作用域；与 better-sidebar 的 SessionScope 同形，只取本插件用到的两项。 */
export interface MediaScope {
  readonly sessionId: string
  /** 会话工作目录；带上它，host 才能在会话尚未 hydrate 时解析路径。 */
  readonly cwd?: string
}

/** better-sidebar@0.28.2 服务上本插件唯一用到的成员；`mediaUrl` 未公开。 */
export interface SidebarHostPort {
  hostRouteUrl(path: string): string
}

/** ctx 上只用到 get；写成结构类型，真 Context 与测试假对象都直接满足。 */
export interface SidebarServiceLocator {
  get(name: string): unknown
}

/** 唯一入口：绝对路径 → 可直接塞 `<img src>` 的地址（`LovartMeta.files[]` 本来就是绝对路径）。 */
export function mediaUrl(ctx: SidebarServiceLocator, scope: MediaScope, path: string): string {
  const host = sidebarHostOf(ctx)
  const params = new URLSearchParams({ sessionId: scope.sessionId, path })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  // 不带前导斜杠：hostRouteUrl 负责保留反代前缀，带斜杠会钉死在源站根并 404。
  return host.hostRouteUrl(`sidebar/file?${params.toString()}`)
}

/** `inject: ['betterSidebar']` 保证服务存在；缺失直接报错，不静默降级成空地址。 */
function sidebarHostOf(ctx: SidebarServiceLocator): SidebarHostPort {
  const service = ctx.get('betterSidebar')
  if (
    typeof service !== 'object' ||
    service === null ||
    typeof (service as { hostRouteUrl?: unknown }).hostRouteUrl !== 'function'
  ) {
    throw new Error('缺少 betterSidebar 服务，无法生成侧栏图片地址')
  }
  return service as SidebarHostPort
}
