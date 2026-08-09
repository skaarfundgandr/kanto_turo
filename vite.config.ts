import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// One locked origin for the whole local stack: the backend CORS
		// configuration and .env files reference exactly this address.
		host: '127.0.0.1',
		port: 5173,
		strictPort: true
	}
});
