import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'src/data/{cache,mockSource,tauriSource}.ts',
        'src/lib/{achievementView,achievements,library,styles,theme,version,virtual}.ts',
        'src/state/{applyLoadedGame,applyPartialSave,detailCache,gameListMerge,store}.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 85,
      },
    },
  },
})
