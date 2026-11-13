import NextAuth from 'next-auth'
import type { NextRequest } from 'next/server'
import { getAuthOptions } from '@/lib/auth'

type AuthRouteContext = {
  params: Promise<{ nextauth: string[] }>
}

async function handler(request: NextRequest, context: AuthRouteContext) {
  const options = getAuthOptions()
  if (!options) {
    return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  }

  return NextAuth(options)(request, context)
}

export { handler as GET, handler as POST }
