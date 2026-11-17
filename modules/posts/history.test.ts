import { describe, expect, it } from 'vitest'
import { restoreRevisionSchema, revisionHistoryQuerySchema } from './history'

describe('修订历史契约', () => {
  it('历史查询将规范数字字符串解析为修订与页码，不接受歧义数组或非整数', () => {
    expect(revisionHistoryQuerySchema.parse({})).toEqual({ page: 1 })
    expect(revisionHistoryQuerySchema.parse({ page: '2', revisionId: '3' })).toEqual({ page: 2, revisionId: 3 })
    for (const value of ['', '0', '-1', '1.5', '1e3', '9007199254740992', ['1']]) {
      expect(revisionHistoryQuerySchema.safeParse({ page: value }).success).toBe(false)
      expect(revisionHistoryQuerySchema.safeParse({ revisionId: value }).success).toBe(false)
    }
  })

  it('恢复命令明确绑定目标修订和必填编辑基线，不接受额外版本机制', () => {
    expect(restoreRevisionSchema.parse({ revisionId: 4, expectedRevisionId: 7 }))
      .toEqual({ revisionId: 4, expectedRevisionId: 7 })
    for (const input of [
      { revisionId: 4 },
      { revisionId: 4, expectedRevisionId: null },
      { revisionId: 4, expectedRevisionId: 0 },
      { revisionId: 4, expectedRevisionId: 7, version: 'extra' },
    ]) expect(restoreRevisionSchema.safeParse(input).success).toBe(false)
  })
})
