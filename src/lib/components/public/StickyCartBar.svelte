<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/shared/Button.svelte';
	import { cart, cartItemCount, cartTotalCents } from '$lib/stores/cart';
	import { formatPeso } from '$lib/utils/money';

	$: itemCount = cartItemCount($cart);
	$: estimatedTotal = formatPeso(cartTotalCents($cart));
	$: itemLabel = itemCount === 1 ? 'item' : 'items';
</script>

<aside class="cart-bar" data-cart-bar aria-label={`Order slip: ${itemCount} ${itemLabel}`}>
	<div class="page-frame cart-bar__inner">
		<div class="cart-bar__copy">
			<span class="cart-bar__label">order slip</span>
			<span class="cart-bar__note" data-cart-count aria-live="polite" aria-atomic="true"
				>{itemCount} {itemLabel}</span
			>
			<span class="cart-bar__total" data-cart-total>Tantyang total: {estimatedTotal}</span>
		</div>
		<Button href={resolve('/cart')} size="small" ariaLabel="Buksan ang order slip"
			>Buksan ang slip</Button
		>
	</div>
</aside>
