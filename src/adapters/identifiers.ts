/// <reference types="node" />

import { createHmac } from 'node:crypto'
import { normalize, posix, resolve, win32 } from 'node:path'

function digestKey(
  kind: 'project' | 'session' | 'message',
  normalized: string,
  salt: string,
): string {
  if (salt.length < 16) {
    throw new Error('identifierSalt must be at least 16 characters')
  }
  const digest = createHmac('sha256', salt)
    .update(`${kind}\0${normalized}`)
    .digest('hex')
    .slice(0, 24)
  return `${kind}_${digest}`
}

export function privateKey(
  kind: 'project' | 'session' | 'message',
  rawValue: string,
  salt: string,
): string {
  const normalized =
    kind === 'project' ? normalize(resolve(rawValue)).toLocaleLowerCase('en-US') : rawValue
  return digestKey(kind, normalized, salt)
}

function safeProjectLabel(label: string): string {
  const safe = label
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
  return safe.slice(0, 120) || '名称未取得'
}

export function localProjectLabel(rawPath: string): string {
  // Histories can originate on a different OS from the machine doing the
  // scan.  Node's native `basename` would leave a Windows path intact on a
  // POSIX host, which could expose a complete local path in the local UI.
  return portableProjectLabel(rawPath)
}

function isWindowsLikePath(rawPath: string): boolean {
  return /^[a-z]:[\\/]/i.test(rawPath) || /^\\\\/.test(rawPath) || /^\/\/[^/]+\/[^/]+/.test(rawPath)
}

/**
 * Canonicalizes a cwd recorded by another machine without resolving it
 * against the hub's launch directory or applying the hub OS's case rules.
 */
export function portableProjectPath(rawPath: string): string {
  if (isWindowsLikePath(rawPath)) {
    const windowsPath = win32.normalize(rawPath.replaceAll('/', '\\')).toLocaleLowerCase('en-US')
    return `windows:${windowsPath}`
  }
  return `posix:${posix.normalize(rawPath)}`
}

export function portableProjectKey(rawPath: string, salt: string): string {
  return digestKey('project', portableProjectPath(rawPath), salt)
}

export function portableProjectLabel(rawPath: string): string {
  const label = isWindowsLikePath(rawPath)
    ? win32.basename(win32.normalize(rawPath.replaceAll('/', '\\')))
    : posix.basename(posix.normalize(rawPath))
  return safeProjectLabel(label)
}

/**
 * Namespaces configured filesystem sources without changing the legacy local
 * identifier bytes. The opaque source ID is not a credential.
 */
export function sourceIdentifierSalt(identifierSalt: string, sourceId: string): string {
  if (identifierSalt.length < 16) {
    throw new Error('identifierSalt must be at least 16 characters')
  }
  return createHmac('sha256', identifierSalt)
    .update(`history-source\0${sourceId}`)
    .digest('base64url')
}
