// @vitest-environment node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase } from '@/lib/server/database'
import { parseMarkdownFile, serializeMarkdownFile } from './file-format'
import { decodeMarkdownBytes, exportPostMarkdown, importPostMarkdown } from './file-exchange'
import { createPostStore, importPublishedPosts, type PostStore } from './store'
import { createWritingStore } from './writing-store'
import { createTestDraft, publishTestDraft, saveTestDraft } from '@/test/post-commands'

const script = fileURLToPath(new URL('../../../scripts/post-file.ts', import.meta.url))
const tsx = fileURLToPath(import.meta.resolve('tsx/cli'))
const tsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const content = {
  title: '  中文标题  ',
  description: '\n摘要\r\n',
  body: '    code\r\n\n# 正文\r\n末尾空白  \r\n',
}
const noIdSource = '---\ntitle: No identity\n---\n# New draft\r\n'
let directory: string
let filename: string
let database: AppDatabase
let store: PostStore

function parse(source: string) {
  const result = parseMarkdownFile(source)
  assert.ok(result.success)
  return result.data
}

function snapshot() {
  return Object.fromEntries(['posts', 'post_revisions', 'post_drafts', 'post_publications', 'post_published']
    .map(table => [table, database.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

function runCli(args: string[], databasePath = filename): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, script, ...args], {
      cwd: directory,
      // 子进程仅接触测试目录和临时库，不继承站点认证配置或读取项目环境文件。
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: directory,
        TMP: directory,
        TMPDIR: directory,
        NODE_ENV: 'production',
        DATABASE_PATH: databasePath,
        TSX_DISABLE_CACHE: '1',
        // 子进程不在仓库目录运行，路径别名的来源需要显式给出。
        TSX_TSCONFIG_PATH: tsconfig,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    if (!child.stdout || !child.stderr) {
      reject(new Error('无法捕获 CLI 输出。'))
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => resolve({ code, stdout, stderr }))
  })
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-post-files-'))
  filename = join(directory, 'nim.sqlite')
  await initializeDatabase(filename)
  database = openDatabase(filename)
  store = createPostStore(database)
})

afterEach(() => {
  if (database?.$client.open) database.$client.close()
  if (directory) rmSync(directory, { recursive: true })
})

describe('Markdown 文件与真实文章存储', () => {
  it('明确 ID 完整替换同一草稿，追加导入修订但不改变公开版本', () => {
    const draft = createTestDraft(createWritingStore(database), content)
    const published = publishTestDraft(createWritingStore(database), draft)
    const replacement = { id: draft.id, title: 'Imported title', description: '', body: '# Imported\r\n\n' }
    const imported = importPostMarkdown(store, serializeMarkdownFile(replacement), randomUUID())
    assert.ok(imported.status === 'success')
    expect(imported.value).toMatchObject(replacement)
    expect(imported.value.createdAt).toBe(draft.createdAt)
    expect(imported.value.revisionId).not.toBe(draft.revisionId)
    expect(store.getPublishedPost(draft.id)).toEqual(published)
    expect(store.listRevisions(draft.id)[0]).toMatchObject({
      title: replacement.title, description: replacement.description, body: replacement.body,
      postId: draft.id, source: 'import',
    })
    expect(store.listPosts()).toHaveLength(1)
  })

  it('未知明确 ID 原样创建未发布草稿，不用请求 ID 替换文件身份', () => {
    const id = '019496D5-2F8A-7B35-8C34-123456789ABC'
    const result = importPostMarkdown(store, serializeMarkdownFile({ ...content, id }), randomUUID())
    assert.ok(result.status === 'success')
    expect(result.value).toMatchObject({ ...content, id })
    expect(store.getPublishedPost(id)).toBeNull()
    expect(store.listRevisions(id)[0].source).toBe('import')
  })

  it('无 ID 使用同一次请求的系统身份，原文重试幂等，修改内容则冲突且不覆盖', () => {
    const id = randomUUID()
    const first = importPostMarkdown(store, noIdSource, id)
    assert.ok(first.status === 'success')
    expect(first.value).toMatchObject({ id, title: 'No identity', description: '', body: '# New draft\r\n' })
    expect(store.listRevisions(id)[0].source).toBe('import')
    const before = snapshot()
    expect(importPostMarkdown(store, noIdSource, id)).toEqual(first)
    expect(snapshot()).toEqual(before)
    expect(importPostMarkdown(store, noIdSource.replace('New draft', 'Changed draft'), id))
      .toEqual({ status: 'conflict' })
    expect(snapshot()).toEqual(before)
    expect(store.getPublishedPost(id)).toBeNull()
  })

  it.each([
    '# No front matter',
    '---\ntitle: Invalid\nid: not-a-uuid\n---\n',
    '---\ntitle: "   "\n---\n',
    '---\ntitle: Title\nunknown: value\n---\n',
  ])('无效文件不改变任何文章或历史记录 %#', source => {
    createTestDraft(createWritingStore(database), content)
    const before = snapshot()
    expect(importPostMarkdown(store, source, randomUUID()).status).toBe('invalid')
    expect(snapshot()).toEqual(before)
  })

  it('无 ID 文件的请求身份也必须满足 UUID 契约', () => {
    const before = snapshot()
    expect(importPostMarkdown(store, noIdSource, 'not-a-uuid').status).toBe('invalid')
    expect(snapshot()).toEqual(before)
  })

  it('默认导出草稿，显式公开导出只读取公开引用，均不携带内部元数据', () => {
    const draft = createTestDraft(createWritingStore(database), content)
    publishTestDraft(createWritingStore(database), draft)
    const edited = { ...content, title: 'Private title', description: 'Private summary', body: '# Private body\r\n' }
    saveTestDraft(createWritingStore(database), draft, edited)
    const exportedDraft = exportPostMarkdown(store, draft.id)
    const exportedPublished = exportPostMarkdown(store, draft.id, 'published')
    assert.ok(exportedDraft.status === 'success' && exportedPublished.status === 'success')
    expect(parse(exportedDraft.source)).toEqual({ ...edited, id: draft.id })
    expect(parse(exportedPublished.source)).toEqual({ ...content, id: draft.id })
    expect(exportedDraft.filename).toBe(`${draft.id}.md`)
    for (const exported of [exportedDraft, exportedPublished]) {
      expect(exported.source).not.toMatch(/(?:^|\n)(?:revisionId|publicationId|createdAt|updatedAt|source|stage):/)
    }
  })

  it('草稿导出只读明确保存的修订，未完成标题不能替换已保存内容', () => {
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, content)
    const edited = { ...content, body: '\n明确保存的正文\r\n' }
    const saved = saveTestDraft(writer, draft, edited)
    const before = snapshot()
    const exported = exportPostMarkdown(store, draft.id)
    assert.equal(exported.status, 'success')
    expect(parse(exported.source)).toEqual({ ...edited, id: draft.id })
    expect(store.getDraft(draft.id)).toEqual(saved)
    expect(writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: saved.revisionId,
      intent: 'save', content: { ...edited, title: '' },
    }).status).toBe('invalid')
    expect(snapshot()).toEqual(before)
    expect(exportPostMarkdown(store, draft.id)).toEqual(exported)
  })

  it('导出再导入完整保留身份和内容，重复导入不追加修订', () => {
    const draft = createTestDraft(createWritingStore(database), content)
    const exported = exportPostMarkdown(store, draft.id)
    assert.ok(exported.status === 'success')
    const before = snapshot()
    const imported = importPostMarkdown(store, exported.source, randomUUID())
    expect(imported).toEqual({ status: 'success', value: draft })
    expect(importPostMarkdown(store, exported.source, randomUUID())).toEqual(imported)
    expect(snapshot()).toEqual(before)
    expect(parse(exported.source)).toEqual({ ...content, id: draft.id })
  })

  it('缺失文章或公开版本返回 missing，不回退到草稿', () => {
    expect(exportPostMarkdown(store, randomUUID())).toEqual({ status: 'missing' })
    const draft = createTestDraft(createWritingStore(database), content)
    expect(exportPostMarkdown(store, draft.id, 'published')).toEqual({ status: 'missing' })
  })

  it('旧非 UUID 文章可以留在存储中，但导出返回 invalid 而非伪造身份', () => {
    importPublishedPosts(database, [{ ...content, id: 'legacy-post' }])
    const before = snapshot()
    expect(exportPostMarkdown(store, 'legacy-post').status).toBe('invalid')
    expect(exportPostMarkdown(store, 'legacy-post', 'published').status).toBe('invalid')
    expect(snapshot()).toEqual(before)
  })

  it('严格拒绝非法 UTF-8 字节，BOM 与 CRLF 交给格式层识别而不丢失正文', () => {
    const before = snapshot()
    expect(decodeMarkdownBytes(new Uint8Array([0xc3, 0x28]))).toMatchObject({ success: false })
    const source = String.fromCharCode(0xFEFF) + '---\r\ntitle: BOM title\r\n---\r\n\r\n    code\r\n'
    const encoded = new TextEncoder().encode(source)
    const decoded = decodeMarkdownBytes(encoded)
    assert.ok(decoded.success)
    expect(decoded.source).toBe(source)
    const buffer = new ArrayBuffer(encoded.byteLength)
    new Uint8Array(buffer).set(encoded)
    expect(decodeMarkdownBytes(buffer)).toEqual(decoded)
    expect(snapshot()).toEqual(before)
    const imported = importPostMarkdown(store, decoded.source, randomUUID())
    assert.ok(imported.status === 'success')
    expect(imported.value.body).toBe('\r\n    code\r\n')
  })
})

describe('文件 CLI 与隔离数据库', () => {
  it.each([
    ['import'],
    ['import', 'file.md', '--published'],
    ['import', 'file.md', '--overwrite'],
    ['export', 'not-a-uuid', 'output.md'],
    ['export', randomUUID(), 'output.md', '--unknown'],
  ])('命令参数错误在打开数据库前失败：%j', async (...args) => {
    const missingDatabase = join(directory, 'not-created.sqlite')
    const result = await runCli(args, missingDatabase)
    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toMatch(/Cannot open database|unable to open database/i)
    expect(existsSync(missingDatabase)).toBe(false)
    expect(snapshot().posts).toEqual([])
  }, 15_000)

  it('导入以元数据 ID 而非文件名确定目标，不发布且只输出身份结果', async () => {
    const draft = createTestDraft(createWritingStore(database), content)
    const published = publishTestDraft(createWritingStore(database), draft)
    const file = join(directory, 'unrelated-name.md')
    const imported = { id: draft.id, title: 'CLI title', description: '', body: '# CLI_PRIVATE_BODY\r\n' }
    writeFileSync(file, serializeMarkdownFile(imported))
    const result = await runCli(['import', file, '--production'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(draft.id)
    expect(result.stdout).not.toContain('CLI_PRIVATE_BODY')
    expect(store.getDraft(draft.id)).toMatchObject(imported)
    expect(store.getPublishedPost(draft.id)).toEqual(published)
    expect(store.listPosts()).toHaveLength(1)
    expect(store.listRevisions(draft.id)[0].source).toBe('import')
  }, 15_000)

  it('CLI 无 ID 导入生成身份，未初始化库明确失败而不自动迁移', async () => {
    const file = join(directory, 'no-id.md')
    writeFileSync(file, noIdSource)
    const missingDatabase = join(directory, 'missing.sqlite')
    const failed = await runCli(['import', file], missingDatabase)
    expect(failed.code).not.toBe(0)
    expect(failed.stdout).toBe('')
    expect(existsSync(missingDatabase)).toBe(false)
    const imported = await runCli(['import', file])
    expect(imported.code, imported.stderr).toBe(0)
    const posts = store.listPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].id).not.toBe('no-id')
    expect(imported.stdout).toContain(posts[0].id)
    expect(store.getPublishedPost(posts[0].id)).toBeNull()
  }, 20_000)

  it('非法 UTF-8 与无效文件均非零失败且不打印成功、不写数据库', async () => {
    const file = join(directory, 'invalid.md')
    const before = snapshot()
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('# No metadata')]) {
      writeFileSync(file, bytes)
      const result = await runCli(['import', file])
      expect(result.code).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(snapshot()).toEqual(before)
    }
  }, 20_000)

  it('导出默认草稿，--published 显式导出公开内容，并自动创建输出目录', async () => {
    const draft = createTestDraft(createWritingStore(database), content)
    publishTestDraft(createWritingStore(database), draft)
    const edited = { ...content, body: '# CLI private draft\r\n' }
    saveTestDraft(createWritingStore(database), draft, edited)
    const output = join(directory, 'nested', 'draft.md')
    const publishedOutput = join(directory, 'nested', 'published.md')
    const first = await runCli(['export', draft.id, output])
    const second = await runCli(['export', draft.id, publishedOutput, '--published'])
    expect(first.code, first.stderr).toBe(0)
    expect(second.code, second.stderr).toBe(0)
    expect(parse(readFileSync(output, 'utf8'))).toEqual({ ...edited, id: draft.id })
    expect(parse(readFileSync(publishedOutput, 'utf8'))).toEqual({ ...content, id: draft.id })
    expect(first.stdout).not.toContain('CLI private draft')
    expect(readdirSync(join(directory, 'nested')).sort()).toEqual(['draft.md', 'published.md'])
  }, 20_000)

  it('默认拒绝覆盖既有文件，显式覆盖完成后才报告成功，且清理临时文件', async () => {
    const draft = createTestDraft(createWritingStore(database), content)
    const outputDirectory = join(directory, 'exports')
    mkdirSync(outputDirectory)
    const output = join(outputDirectory, 'post.md')
    writeFileSync(output, 'USER_EXISTING_CONTENT')
    const denied = await runCli(['export', draft.id, output])
    expect(denied.code).not.toBe(0)
    expect(denied.stdout).toBe('')
    expect(readFileSync(output, 'utf8')).toBe('USER_EXISTING_CONTENT')
    expect(readdirSync(outputDirectory)).toEqual(['post.md'])
    const overwritten = await runCli(['export', draft.id, output, '--overwrite'])
    expect(overwritten.code, overwritten.stderr).toBe(0)
    expect(parse(readFileSync(output, 'utf8'))).toEqual({ ...content, id: draft.id })
    expect(readdirSync(outputDirectory)).toEqual(['post.md'])
  }, 20_000)

  it('输出替换失败时不打印成功，清理自己的临时文件且不删除用户目标', async () => {
    const draft = createTestDraft(createWritingStore(database), content)
    const outputDirectory = join(directory, 'exports')
    const target = join(outputDirectory, 'occupied')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'keep.txt'), 'KEEP')
    const failed = await runCli(['export', draft.id, target, '--overwrite'])
    expect(failed.code).not.toBe(0)
    expect(failed.stdout).toBe('')
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('KEEP')
    expect(readdirSync(outputDirectory)).toEqual(['occupied'])
  }, 15_000)

  it('未发布文章不能用 --published 导出，不创建输出路径', async () => {
    const draft = createTestDraft(createWritingStore(database), content)
    const output = join(directory, 'not-created', 'public.md')
    const result = await runCli(['export', draft.id, output, '--published'])
    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(existsSync(output)).toBe(false)
    expect(existsSync(join(directory, 'not-created'))).toBe(false)
  }, 15_000)
})
