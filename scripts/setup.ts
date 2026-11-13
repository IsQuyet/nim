import { loadEnvConfig } from '@next/env'
import { getDatabasePath } from '../lib/data-paths'
import { initializeDatabase } from '../lib/database'
import { initializeAuthSecret } from '../lib/auth-secret'

const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production'
loadEnvConfig(process.cwd(), !production)

const filename = getDatabasePath()
initializeDatabase(filename)
initializeAuthSecret()
console.log(`数据库已初始化：${filename}`)
console.log('会话密钥已准备。')
