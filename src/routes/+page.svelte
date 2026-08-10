<script lang="ts">
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import PaintedSign from '$lib/components/shared/PaintedSign.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
</script>

<svelte:head>
	<title>Kanto Turo-Turo - Menu</title>
</svelte:head>

<section class="hero" aria-labelledby="hero-title">
	<p class="eyebrow">Mini QR ordering</p>
	<h1 class="hero__title" id="hero-title">
		<span class="hero__word" style="--word-index: 0">SCAN.</span>
		<span class="hero__word hero__word--hot" style="--word-index: 1">TURO.</span>
		<span class="hero__word" style="--word-index: 2">KAIN.</span>
	</h1>
	<p class="hero__note">
		Nakahanda ang bahay ng ulam. <span class="hand">Turo mo lang ang gusto mo.</span>
	</p>
</section>

<section class="menu-stage" aria-labelledby="menu-title">
	<div class="section-heading">
		<PaintedSign id="menu-title" text="MENU" delay="0.05s" />
		<span class="section-sidenote">ang menu ay naghihintay ng live na laman</span>
	</div>
	<PaperPanel>
		<EmptyState
			title="Walang menu na ipinapakita"
			description="Ang susunod na yugto ang maglalagay ng live na putahe mula sa API dito."
			titleId="menu-empty-title"
		/>
	</PaperPanel>
</section>
