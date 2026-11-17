import { readdirSync } from 'node:fs'
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'

// 模块按层排列，后面的层可以引用前面的层，同层之间互不引用。新增模块时在这里登记。
const moduleTiers = [['auth', 'markdown'], ['media'], ['posts']]

const moduleNames = moduleTiers.flat()
const unlisted = readdirSync(new URL('./modules', import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !moduleNames.includes(entry.name))
  .map(entry => entry.name)
if (unlisted.length > 0) {
  throw new Error(`modules/ 下的 ${unlisted.join('、')} 还没有登记到 eslint.config.mjs 的 moduleTiers。`)
}

const tests = ['**/*.test.ts', '**/*.test.tsx']

// server/ 目录只在服务器运行。其余代码可能进入浏览器，只能经 server/actions/ 调用服务器。
const serverOnly = {
  regex: '(^|/)server/(?!actions/)',
  message: '这里的代码可能进入浏览器，不能引用 server/ 下的实现。需要调用服务器时使用 server/actions/。',
}

function restrictImports(files, ignores, patterns) {
  return {
    files,
    ignores: [...tests, ...ignores],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns }] },
  }
}

const boundaries = [
  restrictImports(['lib/**', 'components/**', 'hooks/**'], ['lib/server/**'], [serverOnly]),
  ...moduleNames.map(name => restrictImports([`modules/${name}/**`], [`modules/${name}/server/**`], [serverOnly])),
]

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  ...boundaries,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
])
