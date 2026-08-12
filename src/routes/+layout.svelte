<script lang="ts">
	import '@fontsource/archivo/400.css';
	import '@fontsource/archivo/600.css';
	import '@fontsource/archivo/700.css';
	import '@fontsource/bungee/400.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/600.css';
	import '@fontsource/kalam/400.css';
	import { goto } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import KusinaShell from '$lib/components/shell/KusinaShell.svelte';
	import PublicShell from '$lib/components/shell/PublicShell.svelte';
	import '$lib/design/global.css';
	import { authStore, logout, setAuthRedirectHandler } from '$lib/stores/auth';

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

	function isLogin(pathname: string): boolean {
		return normalizePathname(pathname) === '/login';
	}

	function isMenu(pathname: string): boolean {
		return normalizePathname(pathname) === '/';
	}

	let kusinaAuthenticated = false;

	onMount(() => {
		const redirectToLogin = (): void => {
			// A protected 401 must not interrupt guest menu or signed-receipt flows.
			if (!isKusina(page.url.pathname as string)) return;
			void goto(resolve('/login'));
		};

		const unsubscribe = authStore.subscribe((state) => {
			kusinaAuthenticated = state.status === 'authenticated';
		});
		setAuthRedirectHandler(redirectToLogin);
		return () => {
			unsubscribe();
			setAuthRedirectHandler(null);
		};
	});

	function logoutOfKusina(): void {
		logout();
		void goto(resolve('/login'));
	}
</script>

<svelte:head>
	<title>Kanto Turo-Turo</title>
</svelte:head>

{#if isKusina(page.url.pathname as string) || isLogin(page.url.pathname as string)}
	<KusinaShell
		login={isLogin(page.url.pathname as string)}
		action={kusinaAuthenticated ? { label: 'Mag-logout', onClick: logoutOfKusina } : null}
	>
		<slot />
	</KusinaShell>
{:else}
	<PublicShell showCartBar={isMenu(page.url.pathname as string)}>
		<slot />
	</PublicShell>
{/if}
