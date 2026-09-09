import type { RouteShorthandOptions } from 'fastify'
import { WORKSPACE_BODY_LIMIT } from '../planning/workspaceLimits.js'

export { WORKSPACE_BODY_LIMIT } from '../planning/workspaceLimits.js'

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
