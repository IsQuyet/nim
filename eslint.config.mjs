import { readdirSync } from 'node:fs'
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'

// 模块按层排列，后面的层可以引用前面的层，同层之间互不引用。新增模块时在这里登记。
const moduleTiers = [['auth', 'markdown'], ['media'], ['posts', 'gallery'], ['site']]

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

// 跨越目录边界的引用统一写成 @/ 路径，下面按路径判断方向的规则才不会被相对路径绕过。
const crossBoundary = {
  regex: `^(\\.\\./)+(${['app', 'components', 'hooks', 'lib', 'modules', ...moduleNames].join('|')})/`,
  message: '跨模块或跨顶层目录的引用使用 @/ 路径。',
}

function outside(allowedModules) {
  const forbidden = ['app', ...moduleNames.filter(name => !allowedModules.includes(name)).map(name => `modules/${name}`)]
  return {
    regex: `^@/(${forbidden.join('|')})(/|$)`,
    message: '依赖方向是 lib、components → modules（按 moduleTiers 的层）→ app，这里引用了自己之上或同层的代码。',
  }
}

function restrictImports(files, ignores, patterns) {
  return {
    files,
    ignores: [...tests, ...ignores],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns }] },
  }
}

// 同一条规则在多个配置块里后者覆盖前者，所以每类文件只落在一个块里，块内列全它要遵守的限制。
const boundaries = [
  restrictImports(['app/**'], [], [crossBoundary]),
  restrictImports(['lib/server/**'], [], [crossBoundary, outside([])]),
  restrictImports(['lib/**', 'components/**', 'hooks/**'], ['lib/server/**'], [crossBoundary, outside([]), serverOnly]),
  ...moduleTiers.flatMap((tier, index) => tier.flatMap(name => {
    const direction = outside([name, ...moduleTiers.slice(0, index).flat()])
    return [
      restrictImports([`modules/${name}/server/**`], [], [crossBoundary, direction]),
      restrictImports([`modules/${name}/**`], [`modules/${name}/server/**`], [crossBoundary, direction, serverOnly]),
    ]
  })),
]

// 界面颜色只用 app/globals.css 里按用途命名的角色（bg-background、text-muted-foreground 等），明暗取值在那里统一给出。
const paletteColor = '(?:^|[\\s:!])(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to|decoration|shadow|accent|caret|placeholder)-'
  + '(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}|white|black)(?![\\w-])'
const paletteMessage = '这里直接写了色板颜色。改用 app/globals.css 定义的语义颜色，需要新的用途时先在那里增加角色。'
const semanticColors = {
  files: ['app/**', 'components/**', 'hooks/**', 'modules/**'],
  ignores: tests,
  rules: {
    'no-restricted-syntax': ['error',
      { selector: `Literal[value=/${paletteColor}/]`, message: paletteMessage },
      { selector: `TemplateElement[value.raw=/${paletteColor}/]`, message: paletteMessage },
    ],
  },
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  ...boundaries,
  semanticColors,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
])
