<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { listCategories, listCategoryProducts, listProducts } from '$lib/api/endpoints';
	import type { Category, Product } from '$lib/api/types';
	import ProductPlate from '$lib/components/public/ProductPlate.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import PaintedSign from '$lib/components/shared/PaintedSign.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import Tabs from '$lib/components/shared/Tabs.svelte';
	import { cart } from '$lib/stores/cart';

	const ALL_CATEGORY = 'all';
	type MenuState = 'loading' | 'ready' | 'error';

	let categories: Category[] = [];
	let categoriesLoaded = false;
	let products: Product[] = [];
	let selectedCategory = ALL_CATEGORY;
	let menuState: MenuState = 'loading';
	let errorMessage = '';
	let confirmation = '';
	let requestNumber = 0;
	let mounted = true;

	$: cartItems = $cart;
	$: categoryOptions = [
		{ value: ALL_CATEGORY, label: 'Lahat' },
		...categories.map((category) => ({ value: category.name, label: category.name }))
	];

	onMount(() => {
		const handlePopState = (): void => {
			const nextCategory = categoryFromLocation();
			if (nextCategory === selectedCategory && menuState !== 'error') return;

			selectedCategory = nextCategory;
			confirmation = '';
			void loadMenu(nextCategory);
		};

		window.addEventListener('popstate', handlePopState);
		selectedCategory = categoryFromUrl(page.url);
		void loadMenu(selectedCategory);

		return () => {
			window.removeEventListener('popstate', handlePopState);
			mounted = false;
			requestNumber += 1;
		};
	});

	function categoryFromUrl(url: URL): string {
		return url.searchParams.get('category') || ALL_CATEGORY;
	}

	function categoryFromLocation(): string {
		return categoryFromUrl(new URL(window.location.href));
	}

	function writeCategoryToUrl(category: string): void {
		const url = new URL(page.url);
		if (category === ALL_CATEGORY) url.searchParams.delete('category');
		else url.searchParams.set('category', category);
		const searchAndHash = `${url.search}${url.hash}`;
		replaceState(
			searchAndHash ? resolve(`/${searchAndHash}` as `/?${string}`) : resolve('/'),
			page.state
		);
	}

	function productsFor(category: string): Promise<Product[]> {
		return category === ALL_CATEGORY ? listProducts() : listCategoryProducts(category);
	}

	async function loadMenu(category: string): Promise<void> {
		const currentRequest = ++requestNumber;
		menuState = 'loading';
		errorMessage = '';
		confirmation = '';

		try {
			const loadedCategories = categoriesLoaded ? categories : await listCategories();
			if (!mounted || currentRequest !== requestNumber) return;

			categories = loadedCategories;
			categoriesLoaded = true;

			if (
				category !== ALL_CATEGORY &&
				!loadedCategories.some((availableCategory) => availableCategory.name === category)
			) {
				selectedCategory = ALL_CATEGORY;
				writeCategoryToUrl(ALL_CATEGORY);
				await loadMenu(ALL_CATEGORY);
				return;
			}

			const loadedProducts = await productsFor(category);
			if (!mounted || currentRequest !== requestNumber) return;

			products = loadedProducts;
			menuState = 'ready';
		} catch (error) {
			if (!mounted || currentRequest !== requestNumber) return;
			menuState = 'error';
			errorMessage = messageFor(error);
		}
	}

	function messageFor(error: unknown): string {
		return error instanceof Error ? error.message : 'Hindi ma-access ang menu ngayon.';
	}

	function selectCategory(category: string): void {
		if (category === selectedCategory && menuState !== 'error') return;
		selectedCategory = category;
		confirmation = '';
		writeCategoryToUrl(category);
		void loadMenu(category);
	}

	function addProduct(product: Product): void {
		cart.addItem(product);
		const quantity = get(cart).find((item) => item.productId === product.product_id)?.quantity ?? 1;
		confirmation = `${product.name} naidagdag sa slip. Dami: ${quantity}.`;
	}
</script>

<svelte:head>
	<title>Kanto Turo-Turo - Menu</title>
</svelte:head>

<section class="hero" aria-labelledby="hero-title">
	<p class="eyebrow">Mini QR ordering</p>
	<h1 class="hero__title" id="hero-title">
		<span class="hero__word" style="--word-index: 0">SCAN.</span>
		<span class="hero__word hero__word--hot" style="--word-index: 1">TURO.</span>
		<span class="hero__word" style="--word-index: 2">KAIN.</span>
	</h1>
	<p class="hero__note">
		Nakahanda ang bahay ng ulam. <span class="hand">Turo mo lang ang gusto mo.</span>
	</p>
</section>

<section class="menu-stage" aria-labelledby="menu-title" aria-busy={menuState === 'loading'}>
	<div class="section-heading">
		<PaintedSign id="menu-title" text="MENU" delay="0.05s" />
		<span class="section-sidenote">mga putahe mula sa kusina</span>
	</div>

	{#if menuState === 'loading' && categories.length === 0}
		<Skeleton lines={5} label="Naglo-load ang menu" />
	{:else}
		<Tabs
			label="Mga kategorya"
			options={categoryOptions.map((option) => ({ ...option, disabled: menuState === 'loading' }))}
			selected={selectedCategory}
			onSelect={selectCategory}
		/>

		{#if menuState === 'loading'}
			<Skeleton lines={5} label="Naglo-load ang mga putahe" />
		{:else if menuState === 'error'}
			<PaperPanel>
				<InlineAlert tone="error" title="Hindi ma-load ang menu">
					{errorMessage || 'May problema sa pagkuha ng mga putahe.'}
				</InlineAlert>
				<div class="menu-state__action">
					<button class="btn btn--ghost" type="button" onclick={() => loadMenu(selectedCategory)}>
						Subukan muli
					</button>
				</div>
			</PaperPanel>
		{:else if products.length === 0}
			<PaperPanel>
				<EmptyState
					title={selectedCategory === ALL_CATEGORY
						? 'Walang putahe sa menu'
						: `Walang putahe sa ${selectedCategory}`}
					description={selectedCategory === ALL_CATEGORY
						? 'Wala pang inilalabas na putahe mula sa kusina.'
						: 'Subukan ang ibang kategorya para makakita ng ibang putahe.'}
					titleId="menu-empty-title"
				/>
				{#if selectedCategory !== ALL_CATEGORY}
					<div class="menu-state__action">
						<button
							class="btn btn--ghost"
							type="button"
							onclick={() => selectCategory(ALL_CATEGORY)}
						>
							Tingnan lahat
						</button>
					</div>
				{/if}
			</PaperPanel>
		{:else}
			<ul class="menu-grid" aria-label="Mga putahe">
				{#each products as product (product.product_id)}
					{@const selectedItem = cartItems.find((item) => item.productId === product.product_id)}
					<li>
						<ProductPlate
							{product}
							selected={selectedItem !== undefined}
							quantity={selectedItem?.quantity ?? 0}
							onAdd={addProduct}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<p class="menu-feedback" aria-live="polite" aria-atomic="true">{confirmation}</p>
</section>
