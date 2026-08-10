<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getProduct } from '$lib/api/endpoints';
	import { turo } from '$lib/actions/turo';
	import type { Product } from '$lib/api/types';
	import ProductTray from '$lib/components/shared/ProductTray.svelte';
	import TapeTag from '$lib/components/shared/TapeTag.svelte';
	import { formatPeso, parsePriceToCents } from '$lib/utils/money';

	export let product: Product;
	export let selected = false;
	export let quantity = 0;
	export let onAdd: (product: Product) => void = () => {};

	let imageProductId: number | null = null;
	let imageSource: string | null = null;
	let displayedImage: string | null = null;
	let imageState: 'image' | 'refreshing' | 'missing' = 'missing';
	let imageRetryUsed = false;
	let imageAttempt = 0;
	let imageRequest = 0;
	let mounted = true;

	$: if (imageProductId !== product.product_id || imageSource !== product.product_image_uri) {
		imageProductId = product.product_id;
		imageSource = product.product_image_uri;
		displayedImage = product.product_image_uri;
		imageState = product.product_image_uri ? 'image' : 'missing';
		imageRetryUsed = false;
		imageAttempt = 0;
		imageRequest += 1;
	}

	onDestroy(() => {
		mounted = false;
		imageRequest += 1;
	});

	$: price = formatPeso(parsePriceToCents(product.price));
	$: imageLabel = `Walang larawan para sa ${product.name}`;
	$: addLabel = selected ? `Dagdagan ang ${product.name}` : `Turo ${product.name}`;

	function handleAdd(): void {
		onAdd(product);
	}

	function handleImageError(): void {
		if (imageRetryUsed || imageState === 'refreshing') {
			imageRequest += 1;
			imageState = 'missing';
			displayedImage = null;
			return;
		}

		imageRetryUsed = true;
		imageState = 'refreshing';
		displayedImage = null;
		const currentRequest = ++imageRequest;
		void refreshImage(currentRequest, product.product_id, imageSource);
	}

	async function refreshImage(
		currentRequest: number,
		productId: number,
		source: string | null
	): Promise<void> {
		try {
			const refreshed = await getProduct(productId);
			if (!isCurrentImageRequest(currentRequest, productId, source)) return;

			displayedImage = refreshed.product_image_uri;
			imageState = refreshed.product_image_uri ? 'image' : 'missing';
			imageAttempt += 1;
		} catch {
			if (!isCurrentImageRequest(currentRequest, productId, source)) return;

			displayedImage = null;
			imageState = 'missing';
		}
	}

	function isCurrentImageRequest(
		currentRequest: number,
		productId: number,
		source: string | null
	): boolean {
		return (
			mounted &&
			currentRequest === imageRequest &&
			product.product_id === productId &&
			product.product_image_uri === source
		);
	}
</script>

<ProductTray {selected} ariaLabel={product.name}>
	<article
		class="product-plate"
		data-product-id={imageProductId}
		aria-labelledby={`product-${product.product_id}`}
	>
		<div
			class="product-tray__photo product-plate__photo"
			class:product-plate__photo--refreshing={imageState === 'refreshing'}
		>
			{#if imageState === 'image' && displayedImage}
				{#key imageAttempt}
					<img
						src={displayedImage}
						alt={product.name}
						loading="lazy"
						decoding="async"
						onerror={handleImageError}
					/>
				{/key}
			{:else if imageState === 'refreshing'}
				<span role="status" aria-live="polite">Sinusubukan ang larawan...</span>
			{:else}
				<span role="img" aria-label={imageLabel}>Walang larawan</span>
			{/if}
		</div>

		<div class="product-plate__body">
			<div class="product-plate__heading">
				<h3 class="product-plate__name" id={`product-${product.product_id}`}>{product.name}</h3>
				{#if selected}
					<span class="product-plate__selected" aria-label={`Napili, dami ${quantity}`}>
						Napili · {quantity}
					</span>
				{/if}
			</div>
			{#if product.description}
				<p class="product-plate__description">{product.description}</p>
			{/if}
			<div class="product-plate__footer">
				<TapeTag value={price} label="presyo" />
				<button
					class="btn btn--enamel product-plate__action"
					type="button"
					aria-label={addLabel}
					use:turo={{ selected, onPick: handleAdd }}
				>
					{selected ? 'Dagdag pa' : 'Turo'}
				</button>
			</div>
		</div>
	</article>
</ProductTray>
