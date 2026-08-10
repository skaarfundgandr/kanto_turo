<script lang="ts">
	export let quantity = 1;
	export let min = 1;
	export let max = 20;
	export let label = 'Dami';
	export let disabled = false;
	export let onChange: (quantity: number) => void = () => {};

	$: safeMin = Math.min(min, max);
	$: safeMax = Math.max(min, max);
	$: canDecrease = quantity > safeMin;
	$: canIncrease = quantity < safeMax;
</script>

<div class="quantity-stepper" role="group" aria-label={label}>
	<button
		type="button"
		aria-label={`${label}: bawasan`}
		disabled={disabled || !canDecrease}
		onclick={() => onChange(Math.max(safeMin, quantity - 1))}
	>
		<span aria-hidden="true">-</span>
	</button>
	<output aria-live="polite">{quantity}</output>
	<button
		type="button"
		aria-label={`${label}: dagdagan`}
		disabled={disabled || !canIncrease}
		onclick={() => onChange(Math.min(safeMax, quantity + 1))}
	>
		<span aria-hidden="true">+</span>
	</button>
</div>
