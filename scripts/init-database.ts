import { loadEnvConfig } from '@next/env'
import { getDatabasePath, initializeDatabase } from '../lib/database'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')

const filename = getDatabasePath()
initializeDatabase(filename)
console.log(`数据库已初始化：${filename}`)
