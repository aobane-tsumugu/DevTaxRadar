import { closeSync, fsyncSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { reviewExportJson, reviewExportMarkdown } from '../core/reviewExport.js'
import { listArchiveReviews, readArchiveReview } from './reviewArchive.js'

const usage =
  'Usage: data:read list <data-or-backup-directory> | ' +
  'export <data-or-backup-directory> <review-id> <json|markdown> <new-output-file>'

/** Exclusive creation: never overwrite a user's file, DB, or existing export. */
function writeNewExport(file: string, content: string): void {
  const descriptor = openSync(file, 'wx', 0o600)
  let complete = false
  try {
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
    complete = true
  } finally {
    try {
      closeSync(descriptor)
    } finally {
      if (!complete) rmSync(file, { force: true })
    }
  }
}

export function runReviewArchiveCli(args: string[]): string {
  const [operation, directory, id, format, destination, ...extra] = args
  if (operation === 'list' && args.length === 2 && directory)
    return JSON.stringify(listArchiveReviews(directory), null, 2) + '\n'
  if (
    operation !== 'export' ||
    !directory ||
    !id ||
    !destination ||
    extra.length ||
    !['json', 'markdown'].includes(format ?? '')
  )
    throw new Error(usage)
  const review = readArchiveReview(directory, id)
  const output = resolve(destination)
  const destinationParent = realpathSync(dirname(output))
  const withinSource = relative(realpathSync(directory), destinationParent)
  if (
    withinSource === '' ||
    (withinSource !== '..' && !withinSource.startsWith('..' + sep) && !isAbsolute(withinSource))
  )
    throw new Error('読取り元フォルダの外に、新しい出力先を指定してください。')
  const content = format === 'json' ? reviewExportJson(review) : reviewExportMarkdown(review)
  writeNewExport(output, content)
  return (
    JSON.stringify({ exported: true, reviewId: review.id, year: review.year, format, output }) +
    '\n'
  )
}
