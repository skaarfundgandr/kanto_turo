<script lang="ts">
	import { goto } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { createGuestOrder, listProducts } from '$lib/api/endpoints';
	import type { CartItem } from '$lib/api/types';
	import Button from '$lib/components/shared/Button.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import PaintedSign from '$lib/components/shared/PaintedSign.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import { cart, cartTotalCents } from '$lib/stores/cart';
	import { orderLinkToReceiptUrl, parseOrderLink } from '$lib/utils/order-link';
	import { formatPeso, parsePriceToCents } from '$lib/utils/money';

	type CheckoutState = 'loading' | 'ready' | 'error';

	let checkoutState: CheckoutState = 'loading';
	let catalogError = '';
	let submissionError = '';
	let removedNames: string[] = [];
	let submitting = false;
	let mounted = true;
	let reconcileRequest = 0;
	let recoveryReceiptUrl = '';

	$: items = $cart;
	$: totalCents = cartTotalCents(items);
	$: canSubmit = checkoutState === 'ready' && items.length > 0 && !submitting;

	onMount(() => {
		void reconcileCart();

		return () => {
			mounted = false;
			reconcileRequest += 1;
		};
	});

	async function reconcileCart(): Promise<void> {
		const currentRequest = ++reconcileRequest;
		checkoutState = 'loading';
		catalogError = '';
		submissionError = '';
		removedNames = [];

		try {
			const products = await listProducts();
			if (!mounted || currentRequest !== reconcileRequest) return;

			const before = get(cart);
			const removedIds = new Set(cart.reconcile(products));
			removedNames = Array.from(
				new Set(before.filter((item) => removedIds.has(item.productId)).map((item) => item.name))
			);
			checkoutState = 'ready';
		} catch (error) {
			if (!mounted || currentRequest !== reconcileRequest) return;
			checkoutState = 'error';
			catalogError = error instanceof Error ? error.message : 'Hindi ma-verify ang menu ngayon.';
		}
	}

	function validCart(itemsToValidate: CartItem[]): boolean {
		return (
			itemsToValidate.length > 0 &&
			itemsToValidate.every(
				(item) =>
					Number.isSafeInteger(item.productId) &&
					item.productId > 0 &&
					Number.isSafeInteger(item.quantity) &&
					item.quantity > 0
			)
		);
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : 'Hindi naipadala ang order. Subukan muli.';
	}

	async function submitOrder(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canSubmit) return;

		const currentItems = get(cart);
		if (!validCart(currentItems)) {
			submissionError = 'Walang valid na laman ang order slip. Bumalik sa menu at pumili muli.';
			return;
		}

		submitting = true;
		submissionError = '';
		recoveryReceiptUrl = '';

		try {
			const response = await createGuestOrder(
				currentItems.map(({ productId, quantity }) => ({
					product_id: productId,
					quantity
				}))
			);
			const parsed = parseOrderLink(response.order_url);
			if (!parsed.ok || parsed.link.orderId !== response.order.order_id) {
				submissionError = 'Hindi ma-verify ang signed receipt link. Nananatili ang order slip.';
				return;
			}

			const receiptUrl = orderLinkToReceiptUrl(parsed.link, `${window.location.origin}${base}`);
			// Clear only after the API response and its receipt link are confirmed.
			cart.clear();
			if (!mounted) return;

			const receiptLocation = new URL(receiptUrl);
			const resolvedReceiptPath = resolve('/order/[id]', { id: String(parsed.link.orderId) });
			// The pathname is base-aware; URL supplies the already-validated query string.
			try {
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				await goto(`${resolvedReceiptPath}${receiptLocation.search}`);
			} catch {
				// Keep the bearer-like URL only in this mounted component for recovery.
				recoveryReceiptUrl = receiptUrl;
				submissionError = 'Nagawa ang order, pero hindi nabuksan ang resibo.';
			}
		} catch (error) {
			if (mounted) submissionError = errorMessage(error);
		} finally {
			if (mounted) submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Kanto Turo-Turo - Checkout</title>
</svelte:head>

<section
	class="cart-stage checkout-stage"
	aria-labelledby="checkout-title"
	aria-busy={checkoutState === 'loading'}
>
	<div class="section-heading">
		<PaintedSign id="checkout-title" text="CHECKOUT" delay="0.05s" />
		<span class="section-sidenote">huling tingin bago ipadala sa kusina</span>
	</div>

	{#if checkoutState === 'loading'}
		<Skeleton lines={6} label="Inihahanda ang checkout" />
	{:else if checkoutState === 'error'}
		<PaperPanel>
			<InlineAlert tone="error" title="Hindi ma-verify ang menu">
				{catalogError || 'Hindi pa handa ang order slip para sa checkout.'}
			</InlineAlert>
			<div class="menu-state__action">
				<button class="btn btn--ghost" type="button" onclick={reconcileCart}>Subukan muli</button>
			</div>
		</PaperPanel>
	{:else}
		{#if removedNames.length > 0}
			<InlineAlert tone="warning" title="May inalis na putahe">
				{removedNames.join(', ')} ay wala na sa kasalukuyang menu at inalis sa slip.
			</InlineAlert>
		{/if}

		<PaperPanel variant="slip" className="checkout-slip-panel" ariaLabel="Checkout order slip">
			{#if submissionError}
				<InlineAlert
					tone={recoveryReceiptUrl ? 'warning' : 'error'}
					title={recoveryReceiptUrl ? 'Order naipadala' : 'Hindi naipadala ang order'}
				>
					{submissionError}
					{#if recoveryReceiptUrl}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a class="btn btn--quiet checkout-recovery-link" href={recoveryReceiptUrl}
							>Buksan ang resibo</a
						>
					{:else}
						Nananatili ang laman ng slip.
					{/if}
				</InlineAlert>
			{/if}

			{#if items.length === 0}
				<EmptyState
					title="Walang laman ang order slip"
					description="Pumili muna ng putahe mula sa menu para makapagsimula."
					titleId="checkout-empty-title"
				/>
				<div class="menu-state__action">
					<a class="btn btn--ghost" href={resolve('/')}>Bumalik sa menu</a>
				</div>
			{:else}
				<form class="checkout-form" onsubmit={submitOrder}>
					<p class="checkout-form__intro">
						Ito ang eksaktong mga putahe at dami na ipapadala. Ang presyo at total sa resibo ay
						itatalaga ng server.
					</p>

					<ul class="cart-lines" aria-label="Mga putahe para sa order">
						{#each items as item (item.productId)}
							<li class="cart-line" data-checkout-item={item.productId}>
								<div class="cart-line__copy">
									<h2 class="cart-line__name">{item.name}</h2>
									<span class="cart-line__unit"
										>{item.quantity} × {formatPeso(parsePriceToCents(item.price))}</span
									>
								</div>
								<strong class="cart-line__total"
									>{formatPeso(parsePriceToCents(item.price) * item.quantity)}</strong
								>
							</li>
						{/each}
					</ul>

					<div class="cart-total" data-checkout-total>
						<span>Tantyang total</span>
						<strong>{formatPeso(totalCents)}</strong>
					</div>

					<div class="cart-actions">
						<a class="btn btn--quiet" href={resolve('/cart')}>Balikan ang slip</a>
						<Button
							type="submit"
							disabled={!canSubmit}
							busy={submitting}
							ariaLabel={submitting ? 'Ipinapadala ang order' : 'Ipadala ang order'}
						>
							{submitting ? 'Ipinapadala...' : 'Ipadala ang order'}
						</Button>
					</div>
				</form>
			{/if}
		</PaperPanel>
	{/if}
</section>
