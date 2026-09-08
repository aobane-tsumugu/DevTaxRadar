// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import {
  decodeRecovery,
  encodeRecovery,
  listRecoveries,
  removeRecovery,
  writeRecovery,
  type BalanceRecovery,
} from '../../src/client/balanceRecovery'
afterEach(() => localStorage.clear())
const fixture = (): BalanceRecovery => ({
  version: 1,
  datasetId: crypto.randomUUID(),
  editorId: crypto.randomUUID(),
  recordId: crypto.randomUUID(),
  sequence: 1,
  savedAt: '2026-09-08T00:00:00.000Z',
  base: {
    revision: 0,
    snapshot: { version: 1, accounts: [], movements: [], pendingDecisions: [] },
  },
  snapshot: {
    version: 1,
    accounts: [
      {
        id: 'a',
        name: '',
        taxUnitId: '',
        kind: 'asset',
        openingYear: NaN,
        opening: { status: 'known', amountJpy: NaN },
      },
    ],
    movements: [],
    pendingDecisions: [],
  },
  year: '',
})
it('round trips incomplete numeric fields distinctly from unknown amounts and rejects newer formats without deleting them', () => {
  const row = fixture()
  row.snapshot.pendingDecisions.push({
    id: 'question',
    taxYear: 2026,
    taxUnitId: '',
    amount: { status: 'unknown', amountJpy: null, reasons: [''] },
    accountIds: [],
    sourceIds: [],
    reasons: ['用途の確認'],
    answers: [
      {
        id: 'answer',
        taxYear: NaN,
        receivedOn: '',
        kind: 'method',
        answer: '入力途中の回答',
        source: '',
      },
    ],
  })
  row.snapshot.movements.push({
    id: 'm',
    kind: 'expense',
    accountId: 'a',
    occurredOn: '',
    amountJpy: NaN,
    sourceIds: [],
    decisionId: '',
    reason: '',
    balanceAllocations: [
      {
        sourceKind: 'movement',
        sourceId: 't',
        amountJpy: NaN,
        costAllocations: [{ costYear: 2026, contributionId: 'c', amountJpy: NaN }],
      },
    ],
  })
  row.snapshot.accounts.push({
    ...row.snapshot.accounts[0]!,
    id: 'b',
    opening: { status: 'unknown', amountJpy: null, reasons: [''] },
  })
  expect(decodeRecovery(encodeRecovery(row))).toEqual(row)
  writeRecovery(localStorage, row)
  const key = localStorage.key(0)!
  localStorage.setItem(key, JSON.stringify({ ...row, version: 2 }))
  expect(listRecoveries(localStorage, row.datasetId)).toEqual({ records: [], unreadable: 1 })
  expect(localStorage.getItem(key)).not.toBeNull()
})
it('isolates datasets and editors and refuses to remove a record modified since it was listed', () => {
  const row = fixture(),
    other = fixture()
  writeRecovery(localStorage, row)
  writeRecovery(localStorage, other)
  const second = { ...row, editorId: crypto.randomUUID() }
  writeRecovery(localStorage, second)
  expect(listRecoveries(localStorage, row.datasetId).records).toHaveLength(2)
  const newer = {
    ...row,
    recordId: crypto.randomUUID(),
    sequence: 2,
    savedAt: '2026-09-08T00:01:00.000Z',
  }
  writeRecovery(localStorage, newer)
  expect(removeRecovery(localStorage, row)).toBe(true)
  expect(listRecoveries(localStorage, row.datasetId).records).toContainEqual(newer)
  expect(removeRecovery(localStorage, newer)).toBe(true)
  expect(listRecoveries(localStorage, other.datasetId).records).toEqual([other])
})
it('retains an edit arriving between reading and deleting an older recovery entry', () => {
  const old = fixture()
  writeRecovery(localStorage, old)
  const newer = {
    ...old,
    recordId: crypto.randomUUID(),
    sequence: 2,
    savedAt: '2026-09-08T00:02:00.000Z',
  }
  const racing: Storage = {
    get length() {
      return localStorage.length
    },
    key: (index) => localStorage.key(index),
    clear: () => localStorage.clear(),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
    getItem: (key) => {
      const raw = localStorage.getItem(key)
      writeRecovery(localStorage, newer)
      return raw
    },
  }
  expect(removeRecovery(racing, old)).toBe(true)
  expect(listRecoveries(localStorage, old.datasetId).records).toEqual([newer])
})
