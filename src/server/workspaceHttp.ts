import type { RouteShorthandOptions } from 'fastify'

// The whole UTF-8 JSON request, including its revision and preview/save fields.
// Keep the ordinary 64 KiB default and the separate balance/adoption limits intact.
export const WORKSPACE_BODY_LIMIT = 2 * 1024 * 1024

export const workspaceRequestOptions: RouteShorthandOptions = {
  bodyLimit: WORKSPACE_BODY_LIMIT,
  errorHandler(error, _request, reply) {
    if (error.code !== 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.send(error)
    return reply.code(413).send({
      error: 'workspace_too_large',
      message:
        '入力が受信上限（UTF-8のJSON全体で2MiB）を超えています。保存済みデータは変更していません。編集中の画面を閉じず、入力を控えてから内容を調整してください。',
      limitBytes: WORKSPACE_BODY_LIMIT,
    })
  },
}
