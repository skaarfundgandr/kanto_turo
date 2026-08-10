<script lang="ts">
	import { motion } from '$lib/actions/turo';
	import StorefrontBand from '$lib/components/shared/StorefrontBand.svelte';

	export let login = false;

	const navItems = [
		{ href: '/', label: 'Menu' },
		{ href: '/admin', label: 'Kusina' }
	];
</script>

<div class="app-shell theme-kusina kusina-shell" class:kusina-shell--login={login} use:motion>
	<StorefrontBand
		variant="kusina"
		href="/"
		subtitle="Kusina · Admin Board"
		note={login ? '“para sa counter lang”' : 'para sa counter'}
		navItems={login ? [] : navItems}
		navLabel="Kusina navigation"
	/>
	<main class="page-frame page" class:page--admin={!login} class:page--login={login}>
		<slot />
	</main>
</div>
