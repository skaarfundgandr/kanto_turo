<script lang="ts">
	export let label = '';
	export let value = '';
	export let detail = '';
</script>

<article class="kpi-card">
	<strong class="kpi-card__value">{value}</strong>
	<span class="kpi-card__label">{label}</span>
	{#if detail}<span class="kpi-card__detail">{detail}</span>{/if}
</article>
