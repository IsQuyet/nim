import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
