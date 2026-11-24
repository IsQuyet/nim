import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getAuthSecretPath } from '@/lib/server/data-paths'

export function getAuthSecret() {
  const configured = process.env.AUTH_SECRET?.trim()
  if (configured) return configured

  try {
    const secret = readFileSync(getAuthSecretPath(), 'utf8').trim()
    if (!secret) throw new Error('会话密钥文件为空，请检查持久化目录。')

    return secret
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function initializeAuthSecret() {
  if (getAuthSecret()) return

  const filename = getAuthSecretPath()
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const secret = randomBytes(32).toString('base64url')

  try {
    // 独占创建，不覆盖已有文件，避免两个启动进程互相更换密钥。
    writeFileSync(filename, `${secret}\n`, { flag: 'wx', mode: 0o600, flush: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !getAuthSecret()) throw error
  }
}
