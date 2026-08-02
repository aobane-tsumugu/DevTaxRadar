import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

export const csrfToken = randomBytes(24).toString('base64url')

function tokenMatches(candidate: string | undefined): boolean {
  if (!candidate) {
    return false
  }
  const expected = Buffer.from(csrfToken)
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

/**
 * DNS rebinding defeats the browser's same-origin check: an attacker page can
 * keep serving from `attacker.com` while pointing its own DNS record at
 * 127.0.0.1, so the browser's `fetch` still treats the request as same-origin
 * even though the TCP connection lands on this loopback server. `Origin`
 * validation alone does not catch this because a rebound page's `Origin`
 * header can itself be forged to `http://127.0.0.1:<port>`; the `Host` header
 * is the one signal the attacker cannot control, since it is fixed by the
 * app's own JS source (`fetch('/api/...')`, resolved against the page's
 * declared origin, which is what changed to point at us). Reject anything
 * whose Host does not name this exact loopback port -- for every method,
 * including GET, since several read endpoints now return prompt text and
 * absolute paths.
 */
export function createLoopbackHostGuard(
  port: number,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  return async function requireLoopbackHost(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const host = request.headers.host
    if (!host || !allowedHosts.has(host)) {
      await reply.code(403).send({ error: 'host_not_allowed' })
    }
  }
}

export async function protectMutation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return
  }

  const origin = request.headers.origin
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    await reply.code(403).send({ error: 'origin_not_allowed' })
    return
  }

  const candidate = request.headers['x-devtax-csrf']
  if (typeof candidate !== 'string' || !tokenMatches(candidate)) {
    await reply.code(403).send({ error: 'csrf_token_invalid' })
  }
}
