import { dirname, join, resolve } from 'node:path'

const POSTGRES_URL_PATTERN = /^postgres(?:ql)?:\/\//i

export function isPostgresUrl(value: string) {
  return POSTGRES_URL_PATTERN.test(value.trim())
}

export function getDatabaseUrl() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) return null
  if (!isPostgresUrl(url)) {
    throw new Error('DATABASE_URL 必须以 postgres:// 或 postgresql:// 开头。')
  }
  return url
}

export function getLocalDatabasePath() {
  const configured = process.env.DATABASE_PATH?.trim()
  return resolve(/* turbopackIgnore: true */ configured || '.data/pgdata')
}

export function getDatabaseTarget() {
  return getDatabaseUrl() ?? getLocalDatabasePath()
}

export function getDataDirectory() {
  const explicit = process.env.DATA_DIR?.trim()
  if (explicit) return resolve(/* turbopackIgnore: true */ explicit)
  return dirname(/* turbopackIgnore: true */ getLocalDatabasePath())
}

export function getAuthSecretPath() {
  return join(/* turbopackIgnore: true */ getDataDirectory(), 'auth-secret')
}

export function getMediaDirectory() {
  return join(/* turbopackIgnore: true */ getDataDirectory(), 'media')
}
