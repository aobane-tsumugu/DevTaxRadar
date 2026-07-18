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

export async function protectMutation(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
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
