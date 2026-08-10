/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), svelteTesting()],
	server: {
		// One locked origin for the whole local stack: the backend CORS
		// configuration and .env files reference exactly this address.
		host: '127.0.0.1',
		port: 5173,
		strictPort: true
	},
	test: {
		// happy-dom provides localStorage/document for store tests; no network
		// or database is ever touched (fetch is stubbed in API tests).
		environment: 'happy-dom',
		include: ['tests/**/*.test.ts']
	}
});
