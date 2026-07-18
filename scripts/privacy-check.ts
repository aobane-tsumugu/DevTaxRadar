import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, relative } from 'node:path'

const root = process.cwd()
const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'node_modules',
])
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const exactHome = homedir().replaceAll('\\', '/').toLowerCase()
const privateNames = (process.env.DEVTAX_PRIVATE_NAMES ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
const findings: string[] = []

function visit(path: string): void {
  const stats = statSync(path)
  if (stats.isDirectory()) {
    const name = path.split(/[\\/]/).at(-1)
    if (name && ignoredDirectories.has(name)) {
      return
    }
    for (const child of readdirSync(path)) {
      visit(join(path, child))
    }
    return
  }

  if (!textExtensions.has(extname(path).toLowerCase())) {
    return
  }

  const content = readFileSync(path, 'utf8')
    .replaceAll('\\', '/')
    .replaceAll(/\/+/g, '/')
    .toLowerCase()
  const file = relative(root, path).replaceAll('\\', '/')
  const releaseSurface =
    file.startsWith('dist/') ||
    file.startsWith('public/') ||
    file.startsWith('fixtures/')
  if (content.includes(exactHome)) {
    findings.push(`${file}: contains the current user's home path`)
  }

  for (const privateName of privateNames) {
    if (content.includes(privateName)) {
      findings.push(`${file}: contains a configured private project name`)
    }
  }

  if (releaseSurface &&
      /"(prompt|response|sourcecode|absolutePath)"\s*:/.test(content)) {
    findings.push(`${file}: contains a forbidden raw-content field`)
  }

  if (releaseSurface &&
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(content)) {
    findings.push(`${file}: contains a UUID-like identifier`)
  }

  if (releaseSurface &&
      /(?:[a-z]:\/users\/[^./\s]+|\/users\/[^./\s]+)\//i.test(content)) {
    findings.push(`${file}: contains an absolute user-home path`)
  }

}

visit(root)

function findForbiddenArtifacts(path: string): void {
  const stats = statSync(path)
  if (stats.isDirectory()) {
    for (const child of readdirSync(path)) {
      findForbiddenArtifacts(join(path, child))
    }
    return
  }
  const file = relative(root, path).replaceAll('\\', '/')
  if (
    file.startsWith('.local/') ||
    /\.(?:db|db-wal|db-shm|sqlite|sqlite3)$/i.test(file) ||
    /(?:^|\/)(?:local-usage|raw-usage|unsanitized-[^/]+)\.json$/i.test(file)
  ) {
    findings.push(`${file}: local/private artifact must not be packaged`)
  }
}

for (const surface of ['dist', 'public', 'fixtures']) {
  const path = join(root, surface)
  try {
    findForbiddenArtifacts(path)
  } catch {
    // An absent optional output directory is safe.
  }
}

if (findings.length > 0) {
  console.error(findings.join('\n'))
  process.exitCode = 1
} else {
  console.log('Privacy check passed.')
}
