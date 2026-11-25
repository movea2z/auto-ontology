import { bindings, defineConfig, defineWorker } from 'cf/config';

const hyperdriveId = process.env.CLOUDFLARE_HYPERDRIVE_ID;
if (!hyperdriveId) throw new Error('CLOUDFLARE_HYPERDRIVE_ID is required to build the Worker');

export default defineConfig({
	worker: defineWorker({
		name: 'auto-ontology',
		entrypoint: 'vinext/server/fetch-handler',
		compatibilityDate: '2026-11-11',
		compatibilityFlags: ['nodejs_compat'],
		assets: {
			htmlHandling: 'none',
			notFoundHandling: 'none',
			runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
		},
		env: {
			ASSETS: bindings.assets(),
			IMAGES: bindings.images(),
			VINEXT_KV_CACHE: bindings.kv(),
			AUTH_SECRET: bindings.secret(),
			APP_URL: bindings.secret(),
			HYPERDRIVE: bindings.hyperdrive({ id: hyperdriveId }),
			AGENT_GATEWAY_URL: bindings.secret(),
			CLOUDFLARE_AGENT_SECRET: bindings.secret(),
		},
	}),
});
