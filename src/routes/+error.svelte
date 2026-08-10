<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Button from '$lib/components/shared/Button.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
</script>

<svelte:head>
	<title>Kanto Turo-Turo - Error</title>
</svelte:head>

<section class="hero" aria-labelledby="error-title">
	<p class="eyebrow">Kanto Turo-Turo</p>
	<h1 class="hero__title" id="error-title">May problema.</h1>
</section>

<PaperPanel>
	<InlineAlert tone="error" title={`Error ${page.status}`}>
		{page.error?.message ?? 'Something went wrong.'}
	</InlineAlert>
	<div class="error-actions">
		<Button href={resolve('/')} ariaLabel="Bumalik sa menu">Bumalik sa menu</Button>
	</div>
</PaperPanel>
