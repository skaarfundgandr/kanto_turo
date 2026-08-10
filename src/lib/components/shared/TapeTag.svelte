<script lang="ts">
	export let value = '';
	export let label = '';
</script>

<span class="tape-price">
	{#if label}<span class="tape-price__label">{label}</span>{/if}
	<span>{value}</span>
</span>
