import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		name: 'decision-jev',
		include: ['src/**/*.test.ts'],
		silent: 'passed-only',
	},
})
