import 'server-only'
import { getAdminSession } from './auth'

export type AdminResult<T> =
  | { authorized: false }
  | { authorized: true; value: T }

/** 只在当前请求属于管理员时执行操作。会话检查的故障原样抛出，不当作未登录。 */
export async function withAdmin<T>(operation: () => T): Promise<AdminResult<Awaited<T>>> {
  if (!(await getAdminSession())) return { authorized: false }
  return { authorized: true, value: await operation() }
}
