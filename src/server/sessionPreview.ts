import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { UsageProvider } from '../adapters/types.ts'

const PREVIEW_LENGTH = 120

export type ResumeCommand = {
  command: string
  changeDirectory?: string
  resume: string
  workingDirectoryExists: boolean
  /** cdを省いた理由。省いていなければundefined */
  changeDirectoryOmittedReason?: 'not-found' | 'unquotable-path'
}

function firstText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function isCommandNoise(text: string): boolean {
  return text.includes('<command-name>') || text.includes('<local-command')
}

function claudeUserText(row: Record<string, unknown>): string | undefined {
  if (row.type !== 'user') return undefined
  const message = row.message
  if (typeof message !== 'object' || message === null) return undefined
  const record = message as { role?: unknown; content?: unknown }
  if (record.role !== 'user') return undefined
  return firstText(record.content)
}

function codexUserText(row: Record<string, unknown>): string | undefined {
  const payload = row.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as { type?: unknown; message?: unknown }
  if (record.type !== 'user_message') return undefined
  return typeof record.message === 'string' ? record.message : undefined
}

/**
 * Reads the first real user turn from a transcript so the assignment screen can
 * show what a session was about. Nothing read here is written to the database:
 * the prompt body stays in the provider's own file.
 */
export async function readSessionPreview(
  sourcePath: string,
  provider: UsageProvider,
): Promise<string | undefined> {
  if (!existsSync(sourcePath)) return undefined

  const stream = createReadStream(sourcePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    for await (const line of lines) {
      if (line.trim().length === 0) continue
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof row !== 'object' || row === null) continue

      const text =
        provider === 'claude'
          ? claudeUserText(row as Record<string, unknown>)
          : codexUserText(row as Record<string, unknown>)
      if (!text) continue
      const trimmed = text.trim()
      if (trimmed.length === 0 || isCommandNoise(trimmed)) continue

      const collapsed = trimmed.replace(/\s+/g, ' ')
      return collapsed.length > PREVIEW_LENGTH
        ? `${collapsed.slice(0, PREVIEW_LENGTH)}…`
        : collapsed
    }
  } catch {
    return undefined
  } finally {
    lines.close()
    stream.destroy()
  }
  return undefined
}

/**
 * Escaping quotes in a path is a shell-specific problem: PowerShell wants `` `" ``
 * or doubled `""`, cmd.exe wants yet another rule, and bash wants `\"`. We don't
 * know which shell the generated command will be pasted into, so no single
 * backslash-escaped string can satisfy all of them (a PowerShell user pasting
 * `cd "C:\wo\"rk"` gets a parser error: the backslash has no escaping meaning
 * inside a PowerShell double-quoted string, so the quote still terminates it).
 * Rather than emit a command that silently breaks in some shells, we omit `cd`
 * entirely for paths containing a quote and tell the caller why. Windows paths
 * can't contain `"` in the first place, so this only affects the rare
 * synthetic/edge case, not normal use.
 */
function containsUnquotablePath(workingDirectory: string): boolean {
  return workingDirectory.includes('"')
}

export function buildResumeCommand(
  provider: UsageProvider,
  nativeSessionId: string,
  workingDirectory: string,
  workingDirectoryExists: boolean,
): ResumeCommand {
  const resume =
    provider === 'claude' ? `claude --resume ${nativeSessionId}` : `codex resume ${nativeSessionId}`
  if (!workingDirectoryExists) {
    return {
      command: resume,
      resume,
      workingDirectoryExists: false,
      changeDirectoryOmittedReason: 'not-found',
    }
  }
  if (containsUnquotablePath(workingDirectory)) {
    return {
      command: resume,
      resume,
      workingDirectoryExists: true,
      changeDirectoryOmittedReason: 'unquotable-path',
    }
  }
  const changeDirectory = `cd "${workingDirectory}"`
  return {
    command: `${changeDirectory} && ${resume}`,
    changeDirectory,
    resume,
    workingDirectoryExists: true,
  }
}
