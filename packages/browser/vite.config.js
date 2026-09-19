import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dts from 'unplugin-dts/vite'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	clearScreen: false,
	plugins: [
		dts({
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts'],
			bundleTypes: true,
			compilerOptions: {
				composite: true,
				noEmit: false,
				emitDeclarationOnly: true,
				declaration: true,
			},
		}),
	],
	publicDir: false,
	build: {
		lib: {
			entry: resolve(__dirname, 'src/index.ts'),
			name: 'PageAgentBrowser',
			fileName: 'page-agent-browser',
			formats: ['es'],
		},
		outDir: resolve(__dirname, 'dist'),
		rollupOptions: {
			external: [/^@page-agent\//],
		},
		minify: false,
		sourcemap: true,
	},
})
