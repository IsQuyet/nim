import { unstable_rethrow } from 'next/navigation'
import type { AdminResult } from './admin'
import { signInRequired } from '../failure'

export type AdminActionError = {
  status: 'error'
  message: string
  signInRequired?: true
}

type AdminActionOptions = {
  unauthorizedMessage: string
  errorLog: string
  errorMessage: string
}

/**
 * 统一执行后台 Server Action：经过管理员鉴权与存储上下文，将未授权与非控制流异常收敛为可见错误。
 */
export async function runAdminAction<Store, Result>(
  withStore: <T>(operation: (store: Store) => Promise<T> | T) => Promise<AdminResult<T>>,
  options: AdminActionOptions,
  operation: (store: Store) => Promise<Result> | Result,
): Promise<Result | AdminActionError> {
  try {
    const result = await withStore(operation)
    return result.authorized ? result.value : signInRequired(options.unauthorizedMessage)
  } catch (error) {
    unstable_rethrow(error)
    console.error(options.errorLog, error)
    return { status: 'error', message: options.errorMessage }
  }
}
