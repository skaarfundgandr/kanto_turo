<script lang="ts">
	type SignLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'div';

	export let text = '';
	export let tone: 'ink' | 'red' = 'ink';
	export let level: SignLevel = 'h2';
	export let id: string | undefined = undefined;
	export let delay = '0s';
</script>

<svelte:element
	this={level}
	{id}
	class="painted-sign"
	class:painted-sign--red={tone === 'red'}
	style={`--motion-delay: ${delay}`}
>
	{#if text}{text}{:else}<slot />{/if}
</svelte:element>
