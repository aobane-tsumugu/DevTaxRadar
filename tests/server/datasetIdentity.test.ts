import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { datasetIdentity, initializeDatasetIdentity } from '../../src/server/datasetIdentity.js'
it('keeps one identity per dataset and never replaces an invalid existing identity', () => {
  const first = new DatabaseSync(':memory:'),
    second = new DatabaseSync(':memory:')
  try {
    for (const db of [first, second]) {
      db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
      initializeDatasetIdentity(db)
    }
    const id = datasetIdentity(first)
    initializeDatasetIdentity(first)
    expect(datasetIdentity(first)).toBe(id)
    expect(datasetIdentity(second)).not.toBe(id)
    first.prepare("UPDATE app_settings SET value='damaged' WHERE key='dataset_identity'").run()
    expect(() => initializeDatasetIdentity(first)).toThrow('自動置換しません')
    expect(
      first.prepare("SELECT value FROM app_settings WHERE key='dataset_identity'").get()?.value,
    ).toBe('damaged')
  } finally {
    first.close()
    second.close()
  }
})
