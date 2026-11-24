import { randomUUID } from 'node:crypto'
import { mkdir, link, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnvConfig } from '@next/env'
import { postIdSchema } from '../modules/posts/model'
import { closeDatabaseConnections, withDatabase } from '../lib/server/database'
import type { PostFileStage } from '../modules/posts/files'
import { decodeMarkdownBytes, exportPostMarkdown, importPostMarkdown } from '../modules/posts/server/file-exchange'
import { createPostStore } from '../modules/posts/server/store'

const usage = [
  '用法：',
  '  post-file import <file> [--production]',
  '  post-file export <postId> <output> [--production] [--published] [--overwrite]',
].join('\n')

type Command =
  | { kind: 'help' }
  | { kind: 'import'; input: string; production: boolean }
  | { kind: 'export'; id: string; output: string; stage: PostFileStage; overwrite: boolean; production: boolean }

function parseCommand(args: string[]): Command {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      production: { type: 'boolean' },
      published: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) return { kind: 'help' }

  const [command, first, second] = positionals
  const production = values.production === true || process.env.NODE_ENV === 'production'
  if (command === 'import' && positionals.length === 2 && first) {
    if (values.published || values.overwrite) {
      throw new Error(`import 不接受 --published 或 --overwrite。\n${usage}`)
    }
    return { kind: 'import', input: resolve(first), production }
  }
  if (command === 'export' && positionals.length === 3 && first && second) {
    if (!postIdSchema.safeParse(first).success) throw new Error('导出文章 ID 必须是 UUID。')
    return {
      kind: 'export',
      id: first,
      output: resolve(second),
      stage: values.published ? 'published' : 'draft',
      overwrite: values.overwrite === true,
      production,
    }
  }
  throw new Error(usage)
}

async function writeExport(filename: string, source: string, overwrite: boolean) {
  const directory = dirname(filename)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.nim-post-${randomUUID()}.tmp`)
  let created = false
  try {
    const file = await open(temporary, 'wx', 0o600)
    created = true
    try {
      await file.writeFile(source, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }

    if (overwrite) {
      await rename(temporary, filename)
    } else {
      // 同目录硬链接只在目标不存在时发布完整文件，不会覆盖用户已有文件。
      await link(temporary, filename)
    }
  } finally {
    // 只清理本次成功创建的临时名，不删除输出路径或碰巧同名的既有文件。
    if (created) await rm(temporary, { force: true })
  }
}

async function importFile(filename: string) {
  const decoded = decodeMarkdownBytes(await readFile(filename))
  if (!decoded.success) throw new Error(decoded.message)

  const result = await withDatabase(database => importPostMarkdown(createPostStore(database), decoded.source, randomUUID()))
  if (result.status === 'invalid') throw new Error(result.message)
  if (result.status === 'conflict') throw new Error('创建请求与已有草稿冲突，未覆盖已有内容。')
  if (result.status === 'missing') throw new Error('目标草稿不存在，未完成导入。')
  console.log(`已导入草稿：${result.value.id}`)
}

async function exportFile(command: Extract<Command, { kind: 'export' }>) {
  const result = await withDatabase(database => exportPostMarkdown(createPostStore(database), command.id, command.stage))
  if (result.status === 'missing') {
    throw new Error(command.stage === 'published' ? '该文章没有公开版本，未导出文件。' : '目标草稿不存在，未导出文件。')
  }
  if (result.status === 'invalid') throw new Error(result.message)
  await writeExport(command.output, result.source, command.overwrite)
  console.log(`已导出${command.stage === 'published' ? '公开版本' : '草稿'}：${command.id} -> ${command.output}`)
}

async function main() {
  const command = parseCommand(process.argv.slice(2))
  if (command.kind === 'help') {
    console.log(usage)
    return
  }
  loadEnvConfig(process.cwd(), !command.production)
  try {
    if (command.kind === 'import') await importFile(command.input)
    else await exportFile(command)
  } finally {
    await closeDatabaseConnections()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : '文件操作失败。')
  process.exitCode = 1
})
