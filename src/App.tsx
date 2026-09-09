import WorkspaceAttemptPanel from './client/pages/WorkspaceAttemptPanel'
import {
  writeWorkspaceAttempt,
  removeWorkspaceAttempt,
  type WorkspaceAttempt,
} from './client/workspaceAttempt'
import { useEffect, useMemo, useRef, useState } from 'react'
import RestoreSourcesPanel from './client/pages/RestoreSourcesPanel'

// __UNTOUCHED_FILE_CONTENT__
        throw new Error('控えの保存元から内容が変わっています。最新との比較で確認してください。')
      }
    }
    const attempt = activeRuntime.datasetId
      ? writeWorkspaceAttempt(window.localStorage, {
          version: 1,
          datasetId: activeRuntime.datasetId,
          createdAt: new Date().toISOString(),
          base: structuredClone(base),
          request,
        })
      : null
    try {
      const next = await saveWorkspace(activeRuntime.csrfToken, request)
      pendingSave.current = null
      refreshSequence.current++
      applyWorkspace(next, true)
      if (attempt) removeWorkspaceAttempt(window.localStorage, attempt)
      recoveredWorkspace.current = false
    } catch (error) {
      if (
        error instanceof ApiRequestError &&

// __UNTOUCHED_FILE_CONTENT__
  async function retryWorkspaceAttempt(record: WorkspaceAttempt): Promise<void> {
    const freshRuntime = await getRuntime()
    if (freshRuntime.datasetId !== record.datasetId)
      throw new Error('接続先の資料が変わっています。再読込して確認してください。')
    // Revalidate the retained request before sending its original ID and content.
    const retained = writeWorkspaceAttempt(window.localStorage, record)
    try {
      const next = await saveWorkspace(freshRuntime.csrfToken, retained.request)
      refreshSequence.current++
      applyWorkspace(next)
      removeWorkspaceAttempt(window.localStorage, retained)
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.code === 'workspace_conflict'
