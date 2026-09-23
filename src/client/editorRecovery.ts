/** Unsent editor copies, deliberately separate from immutable HTTP request receipts. */
export type EditorCopy<T> = {
  version: 1
  datasetId: string
  editor: string
  id: string
  parentRevision: number
  updatedAt: string
  value: T
}
export const EDITOR_COPY_LIMIT = 2 * 1024 * 1024
export const EDITOR_FILE_LIMIT = 16 * 1024 * 1024
const prefix = (datasetId: string, editor: string) =>
  'devtax:editor-draft:v1:' + encodeURIComponent(datasetId) + ':' + encodeURIComponent(editor) + ':'
export const editorCopyKey = (copy: EditorCopy<unknown>) =>
  prefix(copy.datasetId, copy.editor) + copy.id
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value)

export function encodeEditorCopy<T>(copy: EditorCopy<T>, maxBytes = EDITOR_COPY_LIMIT): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > EDITOR_FILE_LIMIT)
    throw new Error('編集控えの容量指定が不正です。')
  if (
    copy.version !== 1 ||
    !identifier(copy.datasetId) ||
    !identifier(copy.editor) ||
    !identifier(copy.id) ||
    !Number.isSafeInteger(copy.parentRevision) ||
    copy.parentRevision < 0 ||
    typeof copy.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(copy.updatedAt)) ||
    Object.keys(copy).sort().join(',') !==
      'datasetId,editor,id,parentRevision,updatedAt,value,version'
  )
    throw new Error('編集控えの接続先・対象・保存元の版を確認してください。')
  const raw = JSON.stringify(copy, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('未完成の数値は控えに保存できません。画面の入力は保持しています。')
    return value
  })
  if (new TextEncoder().encode(raw).byteLength > maxBytes)
    throw new Error(
      '編集控えの容量を超えました。入力は保持しています。個人用ファイルへ控えを保存してください。',
    )
  return raw
}

export function decodeEditorCopy<T>(
  raw: string,
  valid: (value: unknown) => value is T,
): EditorCopy<T> {
  if (new TextEncoder().encode(raw).byteLength > EDITOR_FILE_LIMIT)
    throw new Error('編集控えが大きすぎます。')
  const copy = JSON.parse(raw) as EditorCopy<T>
  if (!copy || typeof copy !== 'object' || Array.isArray(copy))
    throw new Error('編集控えの形式が不正です。')
  encodeEditorCopy(copy, EDITOR_FILE_LIMIT)
  if (!valid(copy.value)) throw new Error('この編集画面に対応しない控えです。削除せず保持します。')
  return copy
}

export function listEditorCopies<T>(
  storage: Storage,
  datasetId: string,
  editor: string,
  valid: (value: unknown) => value is T,
): { copies: { copy: EditorCopy<T>; raw: string }[]; unreadable: number } {
  const copies: { copy: EditorCopy<T>; raw: string }[] = []
  let unreadable = 0
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix(datasetId, editor))) continue
    try {
      const raw = storage.getItem(key)
      if (raw === null) continue
      const copy = decodeEditorCopy(raw, valid)
      if (copy.datasetId !== datasetId || copy.editor !== editor || editorCopyKey(copy) !== key)
        throw new Error('編集控えの対象が一致しません。')
      copies.push({ copy, raw })
    } catch {
      unreadable++
    }
  }
  return {
    copies: copies.sort((a, b) => b.copy.updatedAt.localeCompare(a.copy.updatedAt)),
    unreadable,
  }
}

/** Each tab starts a distinct ID. A recovered copy is never silently overwritten or removed. */
export function retainEditorCopy<T>(
  storage: Storage,
  copy: EditorCopy<T>,
  expected: string | null,
): string {
  const raw = encodeEditorCopy(copy)
  if (storage.getItem(editorCopyKey(copy)) !== expected)
    throw new Error('別の画面で編集控えが変わりました。画面の入力と既存の控えを両方保持します。')
  storage.setItem(editorCopyKey(copy), raw)
  return raw
}
export function removeEditorCopy(
  storage: Storage,
  copy: EditorCopy<unknown>,
  expected: string,
): void {
  if (storage.getItem(editorCopyKey(copy)) !== expected)
    throw new Error('編集控えが変わったため削除しません。内容を確認してください。')
  storage.removeItem(editorCopyKey(copy))
}
export function restoreEditorCopy<T>(
  raw: string,
  datasetId: string,
  editor: string,
  valid: (value: unknown) => value is T,
): EditorCopy<T> {
  const copy = decodeEditorCopy(raw, valid)
  if (copy.datasetId !== datasetId || copy.editor !== editor)
    throw new Error('別のデータセット・編集対象の控えは適用できません。')
  // Keep the original parentRevision and previous record for the normal conflict comparison.
  return structuredClone(copy)
}
