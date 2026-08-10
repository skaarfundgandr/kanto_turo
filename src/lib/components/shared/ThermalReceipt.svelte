<script lang="ts">
	export let title = 'RESIBO';
	export let subtitle = '';
	export let ariaLabel = 'Thermal receipt';
</script>

<div class="receipt-wrap">
	<article class="thermal-receipt" aria-label={ariaLabel}>
		<header class="thermal-receipt__head">{title}</header>
		{#if subtitle}<p class="thermal-receipt__sub">{subtitle}</p>{/if}
		<hr />
		<slot />
	</article>
</div>
