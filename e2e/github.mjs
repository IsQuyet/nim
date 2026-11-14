import assert from 'node:assert/strict'

const fetch = globalThis.fetch

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  if (request.url === 'https://github.com/login/oauth/access_token') {
    const body = new URLSearchParams(await request.text())
    assert.equal(body.get('client_id'), 'local-e2e-client')
    assert.equal(body.get('redirect_uri'), `${process.env.SITE_URL}/api/auth/callback/github`)
    assert.ok(body.get('code_verifier'))
    return Response.json({
      access_token: 'local-e2e-provider-token',
      token_type: 'bearer',
      scope: 'read:user,user:email',
    })
  }
  if (request.url === 'https://api.github.com/user') {
    return Response.json({ id: 1234, login: 'local-e2e-admin', name: 'Local administrator', email: null, avatar_url: null })
  }
  if (request.url === 'https://api.github.com/user/emails') {
    return Response.json([{ email: 'admin@example.test', primary: true, verified: true, visibility: 'private' }])
  }
  if (/^https:\/\/(?:api\.)?github\.com\//.test(request.url)) {
    throw new Error(`Unexpected GitHub fixture request: ${request.url}`)
  }
  return fetch(input, init)
}
