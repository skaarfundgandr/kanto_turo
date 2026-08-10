<script lang="ts">
	interface TabOption {
		value: string;
		label: string;
		disabled?: boolean;
	}

	export let options: readonly TabOption[] = [];
	export let selected = '';
	export let label = 'Mga pagpipilian';
	export let onSelect: (value: string) => void = () => {};
</script>

<nav class="tabs-nav" aria-label={label}>
	<div class="tabs" role="group">
		{#each options as option (option.value)}
			<button
				class="tab"
				type="button"
				aria-pressed={selected === option.value}
				disabled={option.disabled ?? false}
				onclick={() => onSelect(option.value)}
			>
				{option.label}
			</button>
		{/each}
	</div>
</nav>
