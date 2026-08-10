<script lang="ts">
	import { motion } from '$lib/actions/turo';
	import StorefrontBand from '$lib/components/shared/StorefrontBand.svelte';

	const navItems = [
		{ href: '/', label: 'Menu' },
		{ href: '/admin', label: 'Kusina' }
	];
</script>

<div class="app-shell theme-kusina kusina-shell" use:motion>
	<StorefrontBand
		variant="kusina"
		href="/"
		subtitle="Kusina · Admin Board"
		note="para sa counter"
		{navItems}
		navLabel="Kusina navigation"
	/>
	<main class="page-frame page page--admin">
		<slot />
	</main>
</div>
