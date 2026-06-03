import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only this repo's own suite. Anchoring to the root `test/` dir keeps
    // vitest from discovering tests inside nested git worktrees
    // (`.sandcastle/worktrees/**`) or cloned reference repos (`references/**`).
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', '.sandcastle/**', 'references/**'],
  },
});
