import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export async function registerStaticFiles(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, {
    root,
    // Resolve at request time so files added after startup are visible.
    wildcard: true,
    setHeaders(response, path) {
      if (path.endsWith('.html')) response.header('Cache-Control', 'no-store')
      response.header('X-Content-Type-Options', 'nosniff')
    },
  })
  app.setNotFoundHandler(async (request, reply) => {
    let path: string
    try {
      path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    } catch {
      return reply.code(400).send({ error: 'invalid_path' })
    }
    const destination = request.headers['sec-fetch-dest']
    const navigation =
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.headers.accept
        ?.split(',')
        .some((part) => part.trim().split(';')[0] === 'text/html') &&
      (!destination || destination === 'document') &&
      path !== '/api' &&
      !path.startsWith('/api/') &&
      path !== '/assets' &&
      !path.startsWith('/assets/') &&
      !path.split('/').at(-1)?.includes('.')
    if (!navigation || !existsSync(join(root, 'index.html')))
      return reply.code(404).send({ error: 'not_found' })
    return reply.header('Cache-Control', 'no-store').sendFile('index.html')
  })
}
