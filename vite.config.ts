import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4317',
    },
  },
  test: {
    // Hosted Windows filesystem/SQLite lifecycle tests can exceed Vitest's 5s
    // default under parallel load. Keep a finite budget without changing assertions.
    testTimeout: process.platform === 'win32' ? 15_000 : 5_000,
    // Agent worktrees and local tooling checkouts live under .claude/; they are not this tree.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Node 25+ exposes its own localStorage global, which hides jsdom's in client tests.
    execArgv:
      Number(process.versions.node.split('.')[0]) >= 25 ? ['--no-experimental-webstorage'] : [],
  },
})
