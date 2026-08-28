import { describe, expect, it } from 'vitest'
import {
  localProjectLabel,
  portableProjectKey,
  portableProjectLabel,
  portableProjectPath,
} from '../../src/adapters/identifiers.ts'

const SALT = 'portable-path-test-salt-1234'

describe('configured-source project paths', () => {
  it('normalizes Windows paths independently of the hub OS and case', () => {
    const backslash = 'C:\\Users\\Alice\\Repo'
    const forwardSlash = 'c:/users/alice/repo'

    expect(portableProjectPath(backslash)).toBe('windows:c:\\users\\alice\\repo')
    expect(portableProjectKey(backslash, SALT)).toBe(portableProjectKey(forwardSlash, SALT))
    expect(portableProjectLabel(backslash)).toBe('Repo')
  })

  it('preserves POSIX case and never resolves a relative value against the launch directory', () => {
    expect(portableProjectKey('/home/alice/App', SALT)).not.toBe(
      portableProjectKey('/home/alice/app', SALT),
    )
    expect(portableProjectLabel('/home/alice/App')).toBe('App')
    expect(portableProjectPath('relative/project')).toBe('posix:relative/project')
  })

  it('recognizes a forward-slash UNC spelling as Windows-like', () => {
    expect(portableProjectKey('//server/share/Repo', SALT)).toBe(
      portableProjectKey('\\\\server\\share\\repo', SALT),
    )
  })

  it('keeps a Windows history label private when read on a POSIX host', () => {
    expect(localProjectLabel('C:\\Users\\Alice\\Repo')).toBe('Repo')
  })
})
