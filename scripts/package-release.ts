import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { verifyReleaseLifecycle } from './release-smoke.js'

type PackageMetadata = {
  name: string
  version: string
  engines?: { node?: string }
}

const root = process.cwd()
const artifactsDirectory = resolve(root, 'artifacts')
const stagingDirectory = resolve(artifactsDirectory, '.release-staging')
const packageMetadata = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
) as PackageMetadata
const tagVersion = process.env.GITHUB_REF_NAME?.match(/^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)?.[1]
const version = tagVersion ?? packageMetadata.version
const releaseName = `${packageMetadata.name}-${version}`
const releaseRoot = join(stagingDirectory, releaseName)
const crc32Table = createCrc32Table()

assertChildPath(artifactsDirectory, stagingDirectory)
assertChildPath(stagingDirectory, releaseRoot)
rmSync(stagingDirectory, { recursive: true, force: true })
mkdirSync(join(releaseRoot, 'runtime', 'server'), { recursive: true })

if (!existsSync(join(root, 'dist', 'index.html'))) {
  throw new Error('dist/index.html is missing. Run `npm run build` before packaging.')
}

cpSync(join(root, 'dist'), join(releaseRoot, 'dist'), {
  recursive: true,
  // These files configure Cloudflare hosting; the local server owns routing and headers.
  filter: (source) => !['_headers', '_redirects'].includes(relative(join(root, 'dist'), source)),
})
copyRequiredFile('README.md')
copyRequiredFile('LICENSE')
copyRequiredFile(join('docs', 'READING-SAVED-REVIEWS.md'))
if (existsSync(join(root, 'docs', 'SECURITY.md'))) {
  copyRequiredFile(join('docs', 'SECURITY.md'))
}

await build({
  entryPoints: {
    'server/index': join(root, 'src', 'server', 'index.ts'),
    'tools/data-backup': join(root, 'scripts', 'data-backup.ts'),
    'tools/restore-sources': join(root, 'scripts', 'restore-sources.ts'),
    'tools/read-review': join(root, 'scripts', 'read-review.ts'),
  },
  outdir: join(releaseRoot, 'runtime'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  sourcemap: false,
  legalComments: 'linked',
})

writeFileSync(
  join(releaseRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: packageMetadata.name,
      private: true,
      version,
      description: 'Local-only DevTax runtime package',
      type: 'module',
      engines: packageMetadata.engines,
      scripts: {
        start: 'node runtime/server/index.mjs',
        'data:backup': 'node runtime/tools/data-backup.mjs',
        'data:reconnect': 'node runtime/tools/restore-sources.mjs',
        'data:read': 'node runtime/tools/read-review.mjs',
      },
    },
    null,
    2,
  )}\n`,
)

writeFileSync(
  join(releaseRoot, 'START-HERE.txt'),
  [
    'DevTax',
    '',
    '1. Install Node.js 24.14 or later.',
    '2. Open a terminal in this directory.',
    '3. Run: npm start',
    '4. Open: http://127.0.0.1:4317',
    '',
    'Your Claude Code and Codex histories remain on this computer.',
    'No npm install is required for this Release package.',
    '',
    'Backup: npm run data:backup -- create "DATA_DIRECTORY" "NEW_BACKUP_DIRECTORY"',
    'Verify: npm run data:backup -- verify "BACKUP_DIRECTORY"',
    'Restore: npm run data:backup -- restore "BACKUP_DIRECTORY" "NEW_DATA_DIRECTORY"',
    'Start with restored data (PowerShell):',
    '$env:DEVTAX_RADAR_DATA_DIR = "NEW_DATA_DIRECTORY"',
    'npm start',
    'Confirm the original history folders in the restore panel before resuming scans.',
    'Original history files and evidence originals must be stored separately.',
    'Backups contain private local settings and notes; do not publish them.',
    '',
    'Read saved reviews without starting the app or reconnecting original folders:',
    'npm run data:read -- list "DATA_OR_BACKUP_DIRECTORY"',
    'npm run data:read -- export "DATA_OR_BACKUP_DIRECTORY" "REVIEW_ID" json "NEW_OUTPUT_FILE"',
    'Use markdown instead of json for the readable report. Existing files are never overwritten.',
    'See docs/READING-SAVED-REVIEWS.md for verification limits and privacy precautions.',
    '',
  ].join('\n'),
)

inspectReleaseTree(releaseRoot)
smokeTestBundle(join(releaseRoot, 'runtime', 'server', 'index.mjs'))
smokeTestBundle(join(releaseRoot, 'runtime', 'tools', 'data-backup.mjs'))
smokeTestBundle(join(releaseRoot, 'runtime', 'tools', 'restore-sources.mjs'))
smokeTestBundle(join(releaseRoot, 'runtime', 'tools', 'read-review.mjs'))
await verifyReleaseLifecycle(releaseRoot)

mkdirSync(artifactsDirectory, { recursive: true })
const zipPath = join(artifactsDirectory, `${releaseName}.zip`)
rmSync(zipPath, { force: true })
writeZip(releaseRoot, zipPath, releaseName)
rmSync(stagingDirectory, { recursive: true, force: true })

console.log(`Release package created: ${relative(root, zipPath).replaceAll('\\', '/')}`)

function assertChildPath(parent: string, child: string): void {
  const prefix = `${resolve(parent)}${sep}`.toLowerCase()
  if (!resolve(child).toLowerCase().startsWith(prefix)) {
    throw new Error(`Refusing to operate outside ${parent}`)
  }
}

function copyRequiredFile(file: string): void {
  const source = join(root, file)
  const destination = join(releaseRoot, file)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

function listFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) {
      files.push(...listFiles(absolute))
    } else {
      files.push(absolute)
    }
  }
  return files
}

function inspectReleaseTree(directory: string): void {
  const allowedTopLevel = new Set([
    'dist',
    'docs',
    'LICENSE',
    'package.json',
    'README.md',
    'runtime',
    'START-HERE.txt',
  ])
  const home = homedir().replaceAll('\\', '/').toLowerCase()
  const forbiddenName =
    /(?:^|\/)(?:node_modules|fixtures|\.git|\.local|\.claude|\.codex|raw-data|private-data)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:db|db-wal|db-shm|sqlite|sqlite3)$/i
  const forbiddenRawField = /"(?:prompt|response|sourcecode|absolutePath)"\s*:/i
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
  const userHome = /(?:[a-z]:\/users\/[^./\s]+|\/(?:home|users)\/[^./\s]+)\//i
  const binaryAsset = /\.(?:gif|ico|jpe?g|png|webp|woff2?)$/i
  const findings: string[] = []

  for (const entry of readdirSync(directory)) {
    if (!allowedTopLevel.has(entry)) {
      findings.push(`${entry}: unexpected top-level release entry`)
    }
  }

  for (const file of listFiles(directory)) {
    const name = relative(directory, file).replaceAll('\\', '/')
    if (forbiddenName.test(name)) {
      findings.push(`${name}: forbidden private artifact`)
      continue
    }
    if (binaryAsset.test(name)) {
      continue
    }
    if (!/\.(?:css|html|js|json|md|mjs|txt)$/i.test(name) && basename(name) !== 'LICENSE') {
      findings.push(`${name}: file type is not allowlisted`)
      continue
    }
    const content = readFileSync(file, 'utf8')
      .replaceAll('\\', '/')
      .replaceAll(/\/+/g, '/')
      .toLowerCase()
    if (
      content.includes(home) ||
      forbiddenRawField.test(content) ||
      uuid.test(content) ||
      userHome.test(content)
    ) {
      findings.push(`${name}: privacy check failed`)
    }
  }

  if (findings.length > 0) {
    throw new Error(`Release privacy check failed:\n${findings.join('\n')}`)
  }
}

function smokeTestBundle(entryPoint: string): void {
  execFileSync(process.execPath, ['--check', entryPoint], { cwd: releaseRoot, stdio: 'inherit' })
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeZip(sourceDirectory: string, destination: string, rootName: string): void {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const files = listFiles(sourceDirectory)

  for (const file of files) {
    const data = readFileSync(file)
    const name = Buffer.from(
      `${rootName}/${relative(sourceDirectory, file).replaceAll('\\', '/')}`,
      'utf8',
    )
    const checksum = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt32LE(0, 10)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt32LE(0, 12)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)
    offset += localHeader.length + name.length + data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  writeFileSync(destination, Buffer.concat([...localParts, ...centralParts, end]))
}
