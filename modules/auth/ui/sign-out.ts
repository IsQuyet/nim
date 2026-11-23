import { authClient } from '../client'

/** 撤销当前浏览器的管理员会话。会话已经不存在也算完成，读取或撤销失败时返回 false。 */
export async function signOut() {
  try {
    const session = await authClient.getSession()
    if (session.error) return false
    if (session.data) {
      const result = await authClient.revokeSession({ token: session.data.session.token })
      if (result.error) return false
    }
    return true
  } catch {
    return false
  }
}
