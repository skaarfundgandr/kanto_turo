// Client-only rendering: no SSR, no server load functions. The app is a
// SPA served by SvelteKit's Cloudflare Worker; the browser performs all API calls.
export const ssr = false;
