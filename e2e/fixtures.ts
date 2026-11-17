import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { test as base, expect, type Page } from '@playwright/test'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { PostStore } from '../modules/posts/model'
import { openDatabase } from '../lib/server/database'
import { createPostStore } from '../modules/posts/server/store'
import { postDrafts, postPublications, postPublished, postRevisions, posts, postWriteReceipts } from '../modules/posts/server/schema'
import { session } from '../modules/auth/server/schema'
import { createWritingStore } from '../modules/posts/server/writing-store'
import type { WritingStore } from '../modules/posts/writing'

type Runtime = {
  origin: string
  filename: string
  logs: () => string
  nextAddress: () => string
}

export async function withStore<T>(runtime: Runtime, operation: (store: PostStore) => T | Promise<T>): Promise<Awaited<T>> {
  const database = openDatabase(runtime.filename)
  try {
    return await operation(createPostStore(database))
  } finally {
    database.$client.close()
  }
}

export async function withWritingStore<T>(runtime: Runtime, operation: (store: WritingStore) => T | Promise<T>): Promise<Awaited<T>> {
  const database = openDatabase(runtime.filename)
  try {
    return await operation(createWritingStore(database))
  } finally {
    database.$client.close()
  }
}

export function snapshot(runtime: Runtime, id: string) {
  const database = openDatabase(runtime.filename)
  try {
    return {
      posts: database.select().from(posts).where(eq(posts.id, id)).all(),
      revisions: database.select().from(postRevisions).where(eq(postRevisions.postId, id)).orderBy(asc(postRevisions.id)).all(),
      drafts: database.select().from(postDrafts).where(eq(postDrafts.postId, id)).all(),
      publications: database.select().from(postPublications).where(eq(postPublications.postId, id)).orderBy(asc(postPublications.id)).all(),
      published: database.select().from(postPublished).where(eq(postPublished.postId, id)).all(),
      receipts: database.select().from(postWriteReceipts).where(eq(postWriteReceipts.postId, id)).orderBy(asc(postWriteReceipts.operationId)).all(),
    }
  } finally {
    database.$client.close()
  }
}

export async function signIn(page: Page, origin: string) {
  const response = await page.request.post(`${origin}/api/auth/sign-in/social`, {
    headers: { origin },
    data: { provider: 'github', callbackURL: '/admin', errorCallbackURL: '/admin/login' },
  })
  expect(response.ok()).toBe(true)
  const authorization = z.object({ url: z.url() }).parse(await response.json())
  const state = new URL(authorization.url).searchParams.get('state')
  assert.ok(state)
  await page.goto(`${origin}/api/auth/callback/github?code=admin&state=${encodeURIComponent(state)}`)
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible()
}

export async function expireSession(page: Page, runtime: Runtime) {
  const response = await page.request.get(`${runtime.origin}/api/auth/get-session`)
  const current = z.object({ session: z.object({ id: z.string() }) }).parse(await response.json())
  const database = openDatabase(runtime.filename)
  try {
    database.update(session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(session.id, current.session.id)).run()
  } finally {
    database.$client.close()
  }
}

async function freePort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const address = listener.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function stopServer(server: ChildProcess) {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return
  const stopped = once(server, 'exit')
  server.kill('SIGTERM')
  await Promise.race([stopped, sleep(10_000)])
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL')
    await Promise.race([stopped, sleep(5000).then(() => { throw new Error('测试进程未能退出。') })])
  }
}

export const test = base.extend<{ login: () => Promise<void>; checkBrowser: void }, { runtime: Runtime }>({
  runtime: [async ({ browserName }, provide, workerInfo) => {
    assert.ok(workerInfo.config.configFile)
    const root = dirname(workerInfo.config.configFile)
    const build = join(root, '.next')
    if (!existsSync(join(build, 'BUILD_ID'))) throw new Error('先运行 npm run build，再执行浏览器测试。')
    const directory = mkdtempSync(join(tmpdir(), `nim-e2e-${browserName}-`))
    const release = join(directory, 'release')
    const filename = join(directory, 'persistent', 'nim.sqlite')
    let server: ChildProcess | undefined
    let logs = ''
    let address = 0
    const failures: unknown[] = []
    try {
      const origin = `http://127.0.0.1:${await freePort()}`
      mkdirSync(release)
      cpSync(build, join(release, '.next'), {
        recursive: true,
        filter: source => !['cache', 'dev', 'diagnostics'].includes(relative(build, source).split(/[\\/]/)[0]),
      })
      for (const asset of ['public', 'drizzle', 'next.config.mjs', 'package.json']) {
        cpSync(join(root, asset), join(release, asset), { recursive: true })
      }
      symlinkSync(join(root, 'node_modules'), join(release, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      const environment: NodeJS.ProcessEnv = { NODE_ENV: 'production' }
      for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOME', 'COMSPEC']) {
        const value = process.env[key]
        if (value !== undefined) environment[key] = value
      }
      Object.assign(environment, {
        NEXT_TELEMETRY_DISABLED: '1', SITE_URL: origin, DATABASE_PATH: filename,
        GITHUB_CLIENT_ID: 'local-e2e-client', GITHUB_CLIENT_SECRET: 'local-e2e-client-secret', ADMIN_GITHUB_ID: '1234',
      })
      const initialize = join(release, 'initialize.ts')
      writeFileSync(initialize, `
import { initializeDatabase } from ${JSON.stringify(join(root, 'lib/server/database.ts'))}
import { initializeAuthSecret } from ${JSON.stringify(join(root, 'modules/auth/server/secret.ts'))}
async function initialize() { await initializeDatabase(); initializeAuthSecret() }
initialize().catch(error => { console.error(error); process.exitCode = 1 })
`)
      execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), initialize], {
        // 初始化脚本在发布目录运行，路径别名的来源需要显式给出。
        cwd: release, env: { ...environment, TSX_TSCONFIG_PATH: join(root, 'tsconfig.json') }, timeout: 30_000, stdio: 'pipe',
      })
      const fixture = pathToFileURL(join(root, 'e2e/github.mjs')).href
      server = spawn(process.execPath, ['--import', fixture, join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', new URL(origin).port], {
        cwd: release, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let launchError: Error | undefined
      server.on('error', error => { launchError = error })
      server.stdout?.on('data', chunk => { logs += String(chunk) })
      server.stderr?.on('data', chunk => { logs += String(chunk) })
      let ready = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (launchError) throw launchError
        if (server.exitCode !== null || server.signalCode !== null) throw new Error(`测试服务提前退出。\n${logs}`)
        try {
          const response = await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(1000) })
          if (response.ok) { ready = true; break }
        } catch { /* 服务尚未监听。 */ }
        await sleep(100)
      }
      if (!ready) throw new Error(`测试服务未就绪。\n${logs}`)
      await provide({ origin, filename, logs: () => logs, nextAddress: () => `192.0.2.${1 + address++ % 254}` })
    } catch (error) {
      failures.push(error)
    } finally {
      try {
        if (server) await stopServer(server)
      } catch (error) {
        failures.push(error)
      }
      const nextClosed = !server || !server.pid || server.exitCode !== null || server.signalCode !== null
      if (nextClosed) {
        try { rmSync(directory, { recursive: true, force: true }) } catch (error) { failures.push(error) }
      }
      try {
        mkdirSync(workerInfo.project.outputDir, { recursive: true })
        writeFileSync(join(workerInfo.project.outputDir, `runtime-${workerInfo.workerIndex}-cleanup.json`), JSON.stringify({
          nextPid: server?.pid ?? null,
          nextClosed,
          runtimeRemoved: !existsSync(directory),
          databaseRemoved: !existsSync(filename),
          secretRemoved: !existsSync(join(dirname(filename), 'auth-secret')),
          retainedRuntime: nextClosed ? null : directory,
          failures: failures.length,
        }, null, 2))
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, '测试启动或清理失败。')
  }, { scope: 'worker', timeout: 120_000 }],
  baseURL: async ({ runtime }, provide) => provide(runtime.origin),
  extraHTTPHeaders: async ({ runtime }, provide) => provide({ 'x-forwarded-for': runtime.nextAddress() }),
  login: async ({ page, runtime }, provide) => provide(() => signIn(page, runtime.origin)),
  checkBrowser: [async ({ context, page, runtime }, provide, testInfo) => {
    const errors: string[] = []
    const tracked = new Set<Page>()
    const observe = (opened: Page) => {
      if (tracked.has(opened)) return
      tracked.add(opened)
      opened.on('pageerror', error => errors.push(error.message))
    }
    observe(page)
    context.on('page', observe)
    await provide()
    context.off('page', observe)
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('server.log', { body: runtime.logs(), contentType: 'text/plain' })
    }
    expect(errors).toEqual([])
  }, { auto: true }],
})

export { expect }
