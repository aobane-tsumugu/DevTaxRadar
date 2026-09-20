import { useEffect, useRef, useState } from 'react'
import {
  encodeEditorCopy, listEditorCopies, retainEditorCopy, removeEditorCopy, restoreEditorCopy,
  EDITOR_FILE_LIMIT, type EditorCopy,
} from './editorRecovery'

/** A local edit copy is not a save request. Restoration never sends or confirms anything. */
export function useEditorRecovery<T>(datasetId: string, editor: string, parentRevision: number,
  valid: (value: unknown) => value is T) {
  type Retained = { copy: EditorCopy<T>; raw: string | null }
  const active = useRef<Retained | null>(null)
  const source = useRef<Retained | null>(null)
  const mounted = useRef(true)
  const identity = useRef({ datasetId, editor })
  identity.current = { datasetId, editor }
  const [value, setValue] = useState<T | null>(null)
  const [copies, setCopies] = useState<{ copy: EditorCopy<T>; raw: string }[]>([])
  const [warning, setWarning] = useState('')
  const [unreadable, setUnreadable] = useState(0)
  const belongsHere = () => mounted.current && identity.current.datasetId === datasetId && identity.current.editor === editor
  function refresh() {
    if (!belongsHere()) return
    try {
      const result = listEditorCopies(window.localStorage, datasetId, editor, valid)
      setCopies(result.copies.filter(({ copy }) => copy.id !== active.current?.copy.id))
      setUnreadable(result.unreadable)
    } catch { setWarning('ブラウザの控えを読み取れません。編集中の入力は画面に保持しています。') }
  }
  useEffect(() => {
    mounted.current = true
    refresh()
    const changed = () => refresh()
    window.addEventListener('storage', changed)
    return () => { mounted.current = false; window.removeEventListener('storage', changed) }
  }, [datasetId, editor])
  useEffect(() => {
    if (!value) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [value])
  function change(next: T, originRevision = parentRevision, explicitRebase = false) {
    if (!belongsHere()) return
    const previous = active.current
    if (previous && (previous.copy.datasetId !== datasetId || previous.copy.editor !== editor)) {
      setWarning('接続先が変わりました。元の入力を保持し、別の保存資料へは適用しません。')
      return
    }
    const copy: EditorCopy<T> = {
      version: 1, datasetId, editor, id: previous?.copy.id ?? crypto.randomUUID(),
      parentRevision: explicitRebase ? originRevision : previous?.copy.parentRevision ?? originRevision,
      updatedAt: new Date().toISOString(), value: structuredClone(next),
    }
    let raw = previous?.raw ?? null
    try { raw = retainEditorCopy(window.localStorage, copy, raw); setWarning('') }
    catch (error) {
      setWarning((error instanceof Error ? error.message : '控えを保存できません。') +
        ' 入力は画面に保持しています。個人用ファイルへ控えを保存してから画面を閉じてください。')
    }
    active.current = { copy, raw }; setValue(copy.value); refresh()
  }
  function restore(raw: string, imported = false): boolean {
    if (!belongsHere()) return false
    if (active.current) { setWarning('先に編集中の入力を保存または明示的に破棄してください。'); return false }
    try {
      const original = restoreEditorCopy(raw, datasetId, editor, valid)
      // Fork the selected copy. Two tabs recovering the same record do not share an update key.
      source.current = imported ? null : { copy: original, raw }
      const copy = { ...original, id: crypto.randomUUID(), updatedAt: new Date().toISOString() }
      let retained: string | null = null
      try { retained = retainEditorCopy(window.localStorage, copy, null) }
      catch { /* Keep the imported/original copy and the in-memory form. */ }
      active.current = { copy, raw: retained }; setValue(copy.value); refresh()
      setWarning(retained === null ? '入力を復旧しましたが、新しい控えを保存できません。元ファイル・元の控えは保持しています。' :
        copy.parentRevision === parentRevision ? '' :
          `保存元${copy.parentRevision}版の入力を復旧しました。現在の保存内容との差は、保存前に確認してください。`)
      return true
    } catch (error) { setWarning(error instanceof Error ? error.message : '復旧できません。'); return false }
  }
  function close(): boolean {
    if (!belongsHere()) return false
    let retained = false
    for (const item of [active.current, source.current]) {
      if (!item || item.raw === null) continue
      try { removeEditorCopy(window.localStorage, item.copy, item.raw) }
      catch { retained = true } // Never delete another tab's changed copy or undo a successful DB save.
    }
    active.current = null; source.current = null; setValue(null); refresh()
    setWarning(retained ? '画面の編集を終了しました。変更された控えや整理できなかった控えは削除せず残しています。' : '')
    return true
  }
  function exportCopy() {
    if (!belongsHere() || !active.current) return
    try {
      const raw = encodeEditorCopy(active.current.copy, EDITOR_FILE_LIMIT)
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url; link.download = `devtax-editor-${active.current.copy.id}.json`
      document.body.appendChild(link)
      try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) { setWarning(error instanceof Error ? error.message : '控えを作成できません。') }
  }
  return { value, change, restore, close, exportCopy, copies, unreadable, warning,
    rebase: (next: T, revision: number) => change(next, revision, true),
    parentRevision: active.current?.copy.parentRevision ?? parentRevision }
}
