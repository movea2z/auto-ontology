import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import vinext from 'vinext';
import svgr from 'vite-plugin-svgr';
import { cloudflare } from '@cloudflare/vite-plugin';
import { kvDataAdapter } from '@vinext/cloudflare/cache/kv-data-adapter';
import { imagesOptimizer } from '@vinext/cloudflare/images/images-optimizer';

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@\/lib\/prisma$/,
				replacement: fileURLToPath(new URL('./lib/prisma-worker.ts', import.meta.url)),
			},
		],
	},
	plugins: [
		svgr(),
		vinext({
			cache: { data: kvDataAdapter() },
			images: { optimizer: imagesOptimizer() },
		}),
		cloudflare({
			viteEnvironment: {
				name: 'rsc',
				childEnvironments: ['ssr'],
			},
		}),
	],
});
