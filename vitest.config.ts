import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const coreDir = fileURLToPath(new URL('./src/core', import.meta.url))
const simDir = fileURLToPath(new URL('./src/sim', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@core': coreDir,
      '@sim': simDir,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
