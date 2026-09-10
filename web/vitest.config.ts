import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Everything under src/ is measured. A new module is in the report the moment it
      // exists — there is no allowlist to remember. Only these are left out: tests and
      // test scaffolding, the entry point, type-only files, the locale dictionaries and
      // bundled demo data (executed at import, so they would only inflate the numbers),
      // the data seam every test replaces (data/index.ts), and the two Tauri-only shims
      // that need the desktop shell to run at all.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/types.ts',
        'src/i18n/**',
        'src/data/games.ts',
        'src/data/steamAppIds.ts',
        'src/data/index.ts',
        'src/data/update.ts',
        'src/lib/appWindow.ts',
      ],
      thresholds: {
        // Floor for the whole tree, React components included.
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
        // The data, domain, and state modules keep the stricter bar they always had.
        'src/{data,lib,state}/**/*.ts': {
          statements: 85,
          branches: 70,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
})
