// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  timeout: 120_000,       // 2 min per test — VSCode launch is slow
  retries: 0,
  workers: 1,             // Serial — only one VSCode instance at a time
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
