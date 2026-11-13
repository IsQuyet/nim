// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, encode } from 'next-auth/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthSecret, initializeAuthSecret } from './auth-secret'
import { getAuthSecretPath } from './data-paths'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-auth-secret-'))
  vi.stubEnv('DATABASE_PATH', join(directory, 'data', 'nim.sqlite'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true })
})

describe('会话密钥的初始化与持久保存', () => {
  it('读取未初始化的密钥时不偷偷生成文件', () => {
    expect(getAuthSecret()).toBeNull()
    expect(existsSync(getAuthSecretPath())).toBe(false)
  })

  it('首次生成 32 字节随机密钥，重复初始化后旧会话仍可验证', async () => {
    initializeAuthSecret()
    const secret = getAuthSecret()!
    const filename = getAuthSecretPath()
    const stored = readFileSync(filename, 'utf8')
    const token = await encode({ secret, token: { githubId: '1234' }, maxAge: 3600 })

    expect(Buffer.from(secret, 'base64url')).toHaveLength(32)
    expect(secret).toHaveLength(43)
    expect(filename).toBe(join(directory, 'data', 'auth-secret'))
    if (process.platform !== 'win32') {
      expect(statSync(filename).mode & 0o777).toBe(0o600)
    }

    initializeAuthSecret()

    expect(readFileSync(filename, 'utf8')).toBe(stored)
    expect(getAuthSecret()).toBe(secret)
    expect(await decode({ secret: getAuthSecret()!, token })).toMatchObject({ githubId: '1234' })
  })

  it('已有密钥文件为空时明确失败，不生成新密钥覆盖它', () => {
    initializeAuthSecret()
    writeFileSync(getAuthSecretPath(), '')

    expect(() => getAuthSecret()).toThrow('会话密钥文件为空')
    expect(() => initializeAuthSecret()).toThrow('会话密钥文件为空')
    expect(readFileSync(getAuthSecretPath(), 'utf8')).toBe('')
  })
})
