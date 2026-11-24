import { loadEnvConfig } from '@next/env'
import { getDatabaseTarget } from '../lib/server/data-paths'
import { initializeDatabase } from '../lib/server/database'
import { initializeAuthSecret } from '../modules/auth/server/secret'

const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production'
loadEnvConfig(process.cwd(), !production)

async function setup() {
  const target = getDatabaseTarget()
  await initializeDatabase(target)
  initializeAuthSecret()
  console.log(`数据库已初始化：${target}`)
  console.log('会话密钥已准备。')
}

setup().catch(error => {
  console.error('初始化失败。', error)
  process.exitCode = 1
})
