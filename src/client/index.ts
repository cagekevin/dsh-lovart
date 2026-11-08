/**
 * client 半边唯一入口：注册侧栏 tab。
 *
 * `inject` 写**服务名** `betterSidebar`；`package.json` 的 `dsh.client.inject` 写**包名**
 * `dsh-better-sidebar`，两者不可混（规范 §6 C2）。
 * tab 的 disposer 交给 ctx.effect，卸载时由 DSH 统一清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { LovartIcon, LovartTab, type TabProps } from './Tab.tsx'
import { ensureStyles } from './styles.ts'

/** Cordis 插件名；loader 以本文件导出为准。 */
export const name = 'dsh-lovart'

/** 服务名，不是包名。 */
export const inject = ['betterSidebar']

/** better-sidebar 的 TabDescriptor 里本插件用到的字段（0.28.2）。 */
interface SidebarTabDescriptor {
  readonly id: string
  readonly title: string
  readonly icon?: ReactNode
  readonly component: ComponentType<TabProps>
}

/** 服务上本插件唯一用到的成员；`mediaUrl` 未公开，见 client/media.ts。 */
interface SidebarService {
  registerTab(tab: SidebarTabDescriptor): () => void
}

/** 装配入口；每次 apply 只注册一个 tab。 */
export function apply(ctx: Context): void {
  const sidebar = sidebarOf(ctx)
  ensureStyles()
  ctx.effect(() =>
    sidebar.registerTab({
      id: 'lovart',
      title: 'Lovart',
      icon: createElement(LovartIcon),
      component: LovartTab,
    }),
  )
}

/** `inject` 保证服务存在；缺失直接报错，不静默跳过注册。 */
function sidebarOf(ctx: Context): SidebarService {
  const getter = (ctx as unknown as { get(name: string): unknown }).get
  const service = getter.call(ctx, 'betterSidebar')
  if (
    typeof service !== 'object' ||
    service === null ||
    typeof (service as { registerTab?: unknown }).registerTab !== 'function'
  ) {
    throw new Error('缺少 betterSidebar 服务，侧栏 tab 无法注册')
  }
  return service as SidebarService
}
