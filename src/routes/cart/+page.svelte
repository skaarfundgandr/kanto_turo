<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { resolve } from '$app/paths';
	import type { RouteId } from '$app/types';
	import { listProducts } from '$lib/api/endpoints';
	import type { CartItem } from '$lib/api/types';
	import Button from '$lib/components/shared/Button.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import PaintedSign from '$lib/components/shared/PaintedSign.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
	import QuantityStepper from '$lib/components/shared/QuantityStepper.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import { cart, cartTotalCents } from '$lib/stores/cart';
	import { formatPeso, parsePriceToCents } from '$lib/utils/money';

	type CatalogState = 'loading' | 'ready' | 'error';
	const checkoutHref = resolve('/checkout' as RouteId);

	let hydrated = false;
	let catalogState: CatalogState = 'loading';
	let catalogError = '';
	let removedNames: string[] = [];
	let mounted = true;
	let reconcileRequest = 0;

	$: items = $cart;
	$: totalCents = cartTotalCents(items);
	$: checkoutReady = hydrated && catalogState === 'ready' && items.length > 0;

	onMount(() => {
		hydrated = true;
		void reconcileCatalog();

		return () => {
			mounted = false;
			reconcileRequest += 1;
		};
	});

	async function reconcileCatalog(): Promise<void> {
		const currentRequest = ++reconcileRequest;
		catalogState = 'loading';
		catalogError = '';
		removedNames = [];

		try {
			const products = await listProducts();
			if (!mounted || currentRequest !== reconcileRequest) return;

			const before = get(cart);
			const removedIds = new Set(cart.reconcile(products));
			removedNames = Array.from(
				new Set(before.filter((item) => removedIds.has(item.productId)).map((item) => item.name))
			);
			catalogState = 'ready';
		} catch (error) {
			if (!mounted || currentRequest !== reconcileRequest) return;
			catalogState = 'error';
			catalogError = error instanceof Error ? error.message : 'Hindi ma-access ang catalog ngayon.';
		}
	}

	function updateItemQuantity(item: CartItem, quantity: number): void {
		cart.updateQuantity(item.productId, quantity);
	}

	function removeItem(item: CartItem): void {
		cart.removeItem(item.productId);
	}
</script>

<svelte:head>
	<title>Kanto Turo-Turo - Order Slip</title>
</svelte:head>

<section class="cart-stage" aria-labelledby="cart-title" aria-busy={catalogState === 'loading'}>
	<div class="section-heading">
		<PaintedSign id="cart-title" text="ORDER SLIP" delay="0.05s" />
		<span class="section-sidenote">suriin ang iyong mga turo</span>
	</div>

	{#if !hydrated || catalogState === 'loading'}
		<Skeleton lines={6} label="Inihahanda ang order slip" />
	{:else}
		{#if catalogState === 'error'}
			<InlineAlert tone="error" title="Hindi ma-verify ang menu">
				{catalogError || 'Hindi pa handa ang slip para sa checkout.'} Snapshot lamang ang mga presyo sa
				slip at maaaring luma; mananatiling naka-disable ang checkout hanggang ma-verify ang menu.
			</InlineAlert>
			<div class="cart-state__action">
				<button class="btn btn--ghost" type="button" onclick={reconcileCatalog}>Subukan muli</button
				>
			</div>
		{/if}

		{#if removedNames.length > 0}
			<InlineAlert tone="warning" title="May inalis na putahe">
				{removedNames.join(', ')} ay wala na sa kasalukuyang menu at inalis sa slip.
			</InlineAlert>
		{/if}

		<PaperPanel variant="slip" className="cart-slip-panel" ariaLabel="Order slip contents">
			{#if items.length === 0}
				<EmptyState
					title="Walang laman ang order slip"
					description="Pumili muna ng putahe mula sa menu para makapagsimula."
					titleId="cart-empty-title"
				/>
				<div class="menu-state__action">
					<a class="btn btn--ghost" href={resolve('/')}>Bumalik sa menu</a>
				</div>
			{:else}
				<ul class="cart-lines" aria-label="Mga laman ng order slip">
					{#each items as item (item.productId)}
						<li class="cart-line" data-cart-item={item.productId}>
							<div class="cart-line__copy">
								<h2 class="cart-line__name">{item.name}</h2>
								<span class="cart-line__unit"
									>{formatPeso(parsePriceToCents(item.price))} bawat isa</span
								>
							</div>
							<div class="cart-line__controls">
								<QuantityStepper
									quantity={item.quantity}
									label={`Dami ng ${item.name}`}
									onChange={(quantity) => updateItemQuantity(item, quantity)}
								/>
								<strong class="cart-line__total"
									>{formatPeso(parsePriceToCents(item.price) * item.quantity)}</strong
								>
							</div>
							<button
								class="cart-line__remove"
								type="button"
								aria-label={`Alisin ang ${item.name}`}
								onclick={() => removeItem(item)}
							>
								Alisin
							</button>
						</li>
					{/each}
				</ul>

				<div class="cart-total" data-cart-total>
					<span>Tantyang total</span>
					<strong>{formatPeso(totalCents)}</strong>
				</div>

				<div class="cart-actions">
					<a class="btn btn--quiet" href={resolve('/')}>Bumalik sa menu</a>
					<Button
						href={checkoutHref}
						disabled={!checkoutReady}
						ariaLabel={checkoutReady ? 'Magpatuloy sa checkout' : 'Checkout ay hindi pa handa'}
					>
						Checkout
					</Button>
				</div>
				<button class="cart-clear" type="button" onclick={() => cart.clear()}
					>I-clear ang slip</button
				>
			{/if}
		</PaperPanel>
	{/if}
</section>
