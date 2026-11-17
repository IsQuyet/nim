import { dirname, join, resolve } from 'node:path'

export function getDatabasePath() {
  // 持久化数据由运行时提供，不应追踪并打包到构建产物中。
  return resolve(
    /* turbopackIgnore: true */ process.env.DATABASE_PATH?.trim() || '.data/nim.sqlite',
  )
}

export function getAuthSecretPath() {
  return join(/* turbopackIgnore: true */ dirname(getDatabasePath()), 'auth-secret')
}

export function getMediaDirectory() {
  return join(/* turbopackIgnore: true */ dirname(getDatabasePath()), 'media')
}
