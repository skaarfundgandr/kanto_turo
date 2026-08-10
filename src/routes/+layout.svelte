<script lang="ts">
	import '@fontsource/archivo/400.css';
	import '@fontsource/archivo/600.css';
	import '@fontsource/archivo/700.css';
	import '@fontsource/bungee/400.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/600.css';
	import '@fontsource/kalam/400.css';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import KusinaShell from '$lib/components/shell/KusinaShell.svelte';
	import PublicShell from '$lib/components/shell/PublicShell.svelte';
	import '$lib/design/global.css';

	function normalizePathname(pathname: string): string {
		const normalizedBase = base.replace(/\/+$/, '');
		if (!normalizedBase || normalizedBase === '/') return pathname || '/';
		if (pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`)) {
			return pathname.slice(normalizedBase.length) || '/';
		}
		return pathname || '/';
	}

	function isKusina(pathname: string): boolean {
		const normalizedPathname = normalizePathname(pathname);
		return normalizedPathname === '/admin' || normalizedPathname.startsWith('/admin/');
	}

	function isMenu(pathname: string): boolean {
		return normalizePathname(pathname) === '/';
	}
</script>

<svelte:head>
	<title>Kanto Turo-Turo</title>
</svelte:head>

{#if isKusina(page.url.pathname as string)}
	<KusinaShell>
		<slot />
	</KusinaShell>
{:else}
	<PublicShell showCartBar={isMenu(page.url.pathname as string)}>
		<slot />
	</PublicShell>
{/if}
