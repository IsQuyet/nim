import { z } from 'zod'

/** 服务器操作未能完成时交给界面的结果。signInRequired 表示原因是登录失效，界面据此提供重新登录的入口。 */
export const actionFailureSchema = z.object({
  status: z.literal('error'),
  message: z.string(),
  signInRequired: z.literal(true).optional(),
}).strict()

export type ActionFailure = z.infer<typeof actionFailureSchema>

export function signInRequired(message: string): ActionFailure {
  return { status: 'error', message, signInRequired: true }
}
