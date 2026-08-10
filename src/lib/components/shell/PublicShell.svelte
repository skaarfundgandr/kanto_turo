<script lang="ts">
	import { motion } from '$lib/actions/turo';
	import StorefrontBand from '$lib/components/shared/StorefrontBand.svelte';
	import StickyCartBar from '$lib/components/public/StickyCartBar.svelte';

	export let showCartBar = false;

	const navItems = [
		{ href: '/', label: 'Menu' },
		{ href: '/cart', label: 'Slip' }
	];
</script>

<div class="app-shell public-shell" class:public-shell--menu={showCartBar} use:motion>
	<StorefrontBand
		subtitle="Turo-Turo · Karinderya"
		note="turo ka lang!"
		{navItems}
		navLabel="Pangunahing nabigasyon"
	/>
	<main class="page-frame page page--public">
		<slot />
	</main>
	{#if showCartBar}
		<StickyCartBar />
	{/if}
</div>
