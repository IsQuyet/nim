import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/** 服务端与水合首帧保持 false，之后才显示依赖浏览器状态的内容。 */
export function useIsClient() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
