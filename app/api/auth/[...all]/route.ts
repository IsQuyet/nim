import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

export const { GET, POST } = toNextJsHandler(async (request: Request) => {
  const auth = getAuth()
  if (!auth) {
    return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  }

  return auth.handler(request)
})
