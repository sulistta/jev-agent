import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		name: 'browser',
		include: ['src/**/*.test.ts'],
		silent: 'passed-only',
	},
})
