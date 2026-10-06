import { defineConfig } from 'vitest/config'

// Tests cover the logic modules (plan, ranking, schedule, standup, ticks). They
// run in Node; a test that needs localStorage or the DOM opts in to jsdom with
// a `// @vitest-environment jsdom` comment at the top of the file. The app's own
// vite.config.ts is left out because it loads the Figma Make plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
