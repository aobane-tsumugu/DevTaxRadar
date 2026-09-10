import { useState } from 'react'
import type { ObservationRecord, ObservationRecordSummary } from '../../accounting/observationRecord'
import { isLocalRuntime } from '../dashboard'

type Listing = { records: ObservationRecordSummary[]; unreadable: number; nextOffset?: number }

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`数値記録を読み込めません（${response.status}）。保存記録は変更していません。`)
  return response.json() as Promise<T>
}

export default function ObservationRecordsPanel() {
  const [listing, setListing] = useState<Listing>()
  const [record, setRecord] = useState<ObservationRecord>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!isLocalRuntime()) return null

  async function load(offset = 0) {
    setBusy(true)
    try {
      const next = await readJson<Listing>(`/api/observations/records?offset=${offset}`)
      setListing((current) => offset === 0 ? next : {
        ...next,
        records: [...(current?.records ?? []), ...next.records]
          .filter((row, index, rows) => rows.findIndex((value) => value.id === row.id) === index),
        unreadable: (current?.unreadable ?? 0) + next.unreadable,
      })
      setMessage(next.unreadable ? '検証できない記録があります。削除せず保持しています。' : '')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '数値記録を読み込めませんでした。')
    } finally { setBusy(false) }
  }

  async function open(id: string) {
    setBusy(true)
    try {
      const result = await readJson<{ record: ObservationRecord }>(`/api/observations/records/${id}`)
      setRecord(result.record)
      setMessage('保存時点の記録を開きました。現在の入力・採用済み資料を変更していません。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '記録を開けませんでした。')
    } finally { setBusy(false) }
  }

  function download() {
    if (!record) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `devtax-numeric-record-${record.id}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <details aria-label="取得時点の数値記録">
    <summary>再走査前後の数値記録を読む（年度未採用でも保存）</summary>
    <p>元履歴が消える前に取り込んだ数値、費用の入力と計算結果、取得来歴を保存しています。原本・会話本文の控えでも、税務処理の採用や法定保存の代替でもありません。</p>
    <button type="button" disabled={busy} onClick={() => void load()}>保存した数値記録を表示</button>
    {message && <p role="status">{message}</p>}
    {listing && <>
      {listing.unreadable > 0 && <p>検証できない記録：{listing.unreadable}件。個人用バックアップではDB全体を保持してください。</p>}
      {!listing.records.length && <p>表示できる保存記録はありません。取得済みの数値または取得状態が変わると自動保存します。</p>}
      {listing.records.map((row) => <article key={row.id}>
        <p>{row.createdAt} / {row.year}年 / 入力の版 {row.workspaceRevision} / 取得値 {row.observationCount}件</p>
        <p>前回値を使用したファイル {row.deferredPrevious}件、初回取得を保留したファイル {row.deferredMissing}件、取得来歴が不明または不完全な読み取り元 {row.incompleteSources}件</p>
        <button type="button" disabled={busy} onClick={() => void open(row.id)}>この数値記録を開く</button>
      </article>)}
      {listing.nextOffset !== undefined && <button type="button" disabled={busy} onClick={() => void load(listing.nextOffset)}>さらに前の記録を読む</button>}
    </>}
    {record && <section aria-label="開いた数値記録">
      <h3>{record.payload.costs.year}年・保存時点の計算</h3>
      <p>既知の費用基礎：{record.payload.costs.totals.knownBasisJpy.toLocaleString()}円 / 未算定：{record.payload.costs.totals.unknownBasisIds.length}件 / 計算時間帯：{record.payload.timeZone}</p>
      <p>記録ID：{record.id}</p>
      <details><summary>出力する内容を確認</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '32rem', overflowY: 'auto' }}>{JSON.stringify(record, null, 2)}</pre></details>
      <p>このJSONは入力の自由記述を含む個人用の数値記録です。第三者へ渡す前に上の内容を確認してください。秘密情報の自動匿名化はしていません。復元用DBバックアップとは別です。</p>
      <button type="button" onClick={download}>確認した数値記録をJSONで保存</button>
    </section>}
  </details>
}
