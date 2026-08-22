import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const textExtensions = new Set(['.css', '.html', '.json', '.md', '.ts', '.tsx', '.txt'])
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules'])

function textFiles(root: string, path = root): string[] {
  const stats = statSync(path)
  if (!stats.isDirectory()) return textExtensions.has(extname(path)) ? [path] : []
  const name = path.split(/[\\/]/).at(-1)
  if (name && ignoredDirectories.has(name)) return []
  return readdirSync(path).flatMap((child) => textFiles(root, join(path, child)))
}

describe('canonical product naming', () => {
  it('contains no whitespace-split legacy display name or legacy export filename', () => {
    const root = resolve('.')
    const displayPattern = new RegExp(['DevTax', 'Radar'].join('\\s+'), 'u')
    const findings = textFiles(root).flatMap((path) => {
      const content = readFileSync(path, 'utf8')
      return displayPattern.test(content) ? [relative(root, path)] : []
    })
    expect(findings).toEqual([])

    const appSource = readFileSync(resolve('src/App.tsx'), 'utf8')
    const legacySlug = ['devtax', 'radar'].join('-')
    expect(appSource).not.toContain(`anchor.download = \`${legacySlug}-`)
  })
})
