<script lang="ts">
	interface StatusStep {
		value: string;
		label: string;
	}

	export let steps: readonly StatusStep[] = [];
	export let current = '';
	export let label = 'Progress ng order';

	$: currentIndex = steps.findIndex((step) => step.value === current);
</script>

<ol class="status-steps" role="list" aria-label={label}>
	{#each steps as step, index (step.value)}
		<li
			class:status-step--complete={currentIndex >= 0 && index < currentIndex}
			class:status-step--current={step.value === current}
			aria-current={step.value === current ? 'step' : undefined}
		>
			<span class="status-step__marker" aria-hidden="true">{index + 1}</span>
			<span class="status-step__label">{step.label}</span>
		</li>
	{/each}
</ol>
