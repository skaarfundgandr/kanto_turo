<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError } from '$lib/api/errors';
	import {
		createCategory,
		createProduct,
		deleteProductImage,
		listCategories,
		listProducts,
		uploadProductImage
	} from '$lib/api/endpoints';
	import type { Category, Product } from '$lib/api/types';
	import Button from '$lib/components/shared/Button.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import { centsToDecimalString, formatPeso, parsePriceToCents } from '$lib/utils/money';

	export let active = false;
	/** Live ulam count for the binder tab note; null until the first successful load. */
	export let productCount: number | null = null;

	type LoadState = 'idle' | 'loading' | 'ready' | 'error';
	type ProductsLoadResult =
		{ status: 'success'; products: Product[] } | { status: 'error' } | { status: 'superseded' };

	let mounted = false;
	let activeStarted = false;
	let categories: Category[] = [];
	let categoriesState: LoadState = 'idle';
	let categoriesError = '';
	let categoriesRequest = 0;
	let products: Product[] = [];
	let productsState: LoadState = 'idle';
	let productsError = '';
	let productsBusy = false;
	let productsRequest = 0;
	let latestProductsLoad: Promise<ProductsLoadResult> | null = null;

	let name = '';
	let price = '';
	let selectedCategory = '';
	let description = '';
	let selectedFile: File | null = null;
	let previewUrl: string | null = null;
	let fileInput: HTMLInputElement | null = null;
	let dropActive = false;
	let formBusy = false;
	let formError = '';
	let formMessage = '';
	let busyProducts: Record<number, boolean> = {};
	let rowErrors: Record<number, string> = {};
	let rowMessages: Record<number, string> = {};

	let catAddOpen = false;
	let newCategoryName = '';
	let catAddBusy = false;
	let catAddError = '';
	let catAddStatus = '';

	$: pricePreview = previewPrice(price);
	$: if (mounted && active && !activeStarted) {
		activeStarted = true;
		void loadCategories(true);
		void loadProducts(true);
	}
	$: if (mounted && !active && activeStarted) {
		deactivateMenuLoads();
	}

	function deactivateMenuLoads(): void {
		activeStarted = false;
		categoriesRequest += 1;
		productsRequest += 1;
	}

	onMount(() => {
		mounted = true;
		return () => {
			mounted = false;
			categoriesRequest += 1;
			productsRequest += 1;
			revokePreview();
		};
	});

	function previewPrice(value: string): string {
		try {
			const cents = parsePriceToCents(value.trim());
			return cents >= 0 ? formatPeso(cents) : '₱0.00';
		} catch {
			return '₱0.00';
		}
	}

	function errorMessage(error: unknown, action: 'load' | 'create' | 'upload' | 'delete'): string {
		if (!(error instanceof ApiError)) {
			return action === 'load'
				? 'Hindi ma-load ang menu. Subukan muli.'
				: 'Hindi natuloy ang pagbabago. Subukan muli.';
		}

		switch (error.status) {
			case 0:
				return 'Walang koneksyon. Suriin ang internet at subukan muli.';
			case 400:
				return action === 'upload'
					? 'Hindi tinanggap ang larawan. Gumamit ng JPG, PNG, o WEBP na pasok sa server size limit.'
					: 'May hindi tanggap na detalye. Suriin ang mga field at subukan muli.';
			case 401:
				return 'Tapos na ang admin session. Mag-login muli bago magpatuloy.';
			case 403:
				return 'Walang pahintulot ang account para sa pagbabagong ito (403).';
			case 404:
				return 'Hindi na makita ang ulam sa server (404). I-refresh ang listahan.';
			case 409:
				return 'May ulam nang gumagamit ng pangalang ito (409). Gumamit ng ibang pangalan.';
			case 429:
				return 'Masyadong maraming request (429). Maghintay bago subukan muli.';
			case 503:
				return action === 'upload' || action === 'delete'
					? 'Hindi available ang object storage (503). Naka-save pa rin ang ibang detalye ng ulam.'
					: 'Hindi available ang menu service ngayon (503). Subukan muli mamaya.';
			default:
				return error.message || `Hindi natuloy ang request (${error.status}).`;
		}
	}

	async function loadCategories(showLoading = false): Promise<Category[] | null> {
		if (!active) return null;
		const request = ++categoriesRequest;
		if (showLoading || categories.length === 0) categoriesState = 'loading';
		categoriesError = '';

		try {
			const loaded = await listCategories();
			if (!mounted || !active || request !== categoriesRequest) return null;
			categories = loaded;
			categoriesState = 'ready';
			if (!selectedCategory && loaded[0]) selectedCategory = loaded[0].name;
			return loaded;
		} catch (error) {
			if (!mounted || request !== categoriesRequest) return null;
			categoriesState = 'error';
			categoriesError = errorMessage(error, 'load');
			return null;
		}
	}

	function loadProducts(showLoading = false): Promise<ProductsLoadResult> {
		if (!active) return Promise.resolve({ status: 'superseded' });
		const request = ++productsRequest;
		if (showLoading || products.length === 0) productsState = 'loading';
		productsBusy = true;
		productsError = '';

		const rawLoad = (async (): Promise<ProductsLoadResult> => {
			try {
				const loaded = await listProducts();
				if (!mounted || !active || request !== productsRequest) {
					return { status: 'superseded' };
				}
				products = loaded;
				productsState = 'ready';
				productCount = loaded.length;
				return { status: 'success', products: loaded };
			} catch (error) {
				if (!mounted || !active || request !== productsRequest) {
					return { status: 'superseded' };
				}
				productsState = products.length > 0 ? 'ready' : 'error';
				productsError = errorMessage(error, 'load');
				return { status: 'error' };
			} finally {
				if (request === productsRequest) productsBusy = false;
			}
		})();

		const followedLoad: Promise<ProductsLoadResult> = rawLoad.then(
			async (result): Promise<ProductsLoadResult> => {
				if (result.status !== 'superseded') return result;
				const latest = latestProductsLoad;
				return latest && latest !== followedLoad ? latest : result;
			}
		);
		latestProductsLoad = followedLoad;
		return followedLoad;
	}

	function categoryErrorMessage(error: unknown): string {
		if (!(error instanceof ApiError)) return 'Hindi naidagdag ang kategorya. Subukan muli.';
		switch (error.status) {
			case 0:
				return 'Walang koneksyon. Subukan muli kapag online na.';
			case 401:
				return 'Tapos na ang admin session. Mag-login muli bago magpatuloy.';
			case 403:
				return 'Walang pahintulot ang account para sa pagbabagong ito (403).';
			case 409:
				return 'May kategorya nang gumagamit ng pangalang ito (409).';
			case 429:
				return 'Masyadong maraming request (429). Maghintay bago subukan muli.';
			default:
				return error.message || `Hindi naidagdag ang kategorya (${error.status}).`;
		}
	}

	function toggleCatAdd(): void {
		catAddOpen = !catAddOpen;
		catAddError = '';
		if (catAddOpen) catAddStatus = '';
	}

	async function submitNewCategory(): Promise<void> {
		if (catAddBusy) return;
		const name = newCategoryName.trim();
		catAddError = '';
		catAddStatus = '';
		if (!name) {
			catAddError = 'Ilagay ang pangalan ng bagong kategorya.';
			return;
		}

		const existing = categories.find(
			(category) => category.name.toLowerCase() === name.toLowerCase()
		);
		if (existing) {
			selectedCategory = existing.name;
			newCategoryName = '';
			catAddOpen = false;
			catAddStatus = `Napili ang kategoryang ${existing.name}.`;
			return;
		}

		catAddBusy = true;
		try {
			await createCategory(name);
		} catch (error) {
			catAddError = categoryErrorMessage(error);
			return;
		} finally {
			catAddBusy = false;
		}

		const loaded = await loadCategories(false);
		const created = loaded?.find((category) => category.name === name);
		if (created) selectedCategory = created.name;
		newCategoryName = '';
		catAddOpen = false;
		catAddStatus = created
			? `Naidagdag ang kategoryang ${created.name}.`
			: loaded
				? `Naidagdag ang ${name}, pero hindi pa lumitaw sa listahan ng mga kategorya.`
				: `Naidagdag ang ${name}, pero hindi na-refresh ang mga kategorya.`;
	}

	function handleNewCategoryKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		// The input lives inside the dish form; Enter must not submit a half-filled ulam.
		event.preventDefault();
		void submitNewCategory();
	}

	function validateProduct(): { price: string; name: string } | null {
		const trimmedName = name.trim();
		if (!trimmedName) {
			formError = 'Ilagay ang pangalan ng ulam.';
			return null;
		}

		if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) {
			formError = 'Gumamit ng presyong tulad ng 95.00, hanggang dalawang decimal place.';
			return null;
		}

		try {
			const cents = parsePriceToCents(price.trim());
			if (cents <= 0) {
				formError = 'Dapat mas mataas sa ₱0.00 ang presyo.';
				return null;
			}
			return { name: trimmedName, price: centsToDecimalString(cents) };
		} catch {
			formError = 'Hindi valid ang presyo. Paikliin ang halaga at subukan muli.';
			return null;
		}
	}

	async function submitProduct(): Promise<void> {
		if (formBusy) return;
		formError = '';
		formMessage = '';
		const validated = validateProduct();
		if (!validated) return;

		const file = selectedFile;
		formBusy = true;
		try {
			await createProduct({
				name: validated.name,
				price: validated.price,
				description: description.trim() || undefined,
				categories: selectedCategory ? [selectedCategory] : undefined
			});

			const reloadResult = await loadProducts(false);
			if (reloadResult.status !== 'success') {
				resetForm();
				formMessage = file
					? `Naidagdag ang ${validated.name}, pero hindi na-refresh ang listahan kaya hindi naikabit ang larawan. I-refresh ang mga ulam at subukan mula sa row.`
					: `Naidagdag ang ${validated.name}, pero hindi na-refresh ang listahan. I-refresh para makita ang server state.`;
				return;
			}
			const reloaded = reloadResult.products;

			const matches = reloaded.filter((product) => product.name === validated.name);
			const created = matches.length === 1 ? matches[0] : null;
			if (file && !created) {
				resetForm();
				formMessage = `Naidagdag ang ${validated.name}, pero hindi matukoy ang bagong row para sa larawan. Subukan ang upload mula sa listahan.`;
				return;
			}

			if (file && created) {
				try {
					await uploadProductImage(created.product_id, file);
					const refreshResult = await loadProducts(false);
					resetForm();
					formMessage =
						refreshResult.status === 'success'
							? `Naidagdag ang ${validated.name} kasama ang larawan.`
							: `Naidagdag ang ${validated.name} at naikabit ang larawan, pero hindi na-refresh ang listahan.`;
					return;
				} catch (error) {
					rowErrors = {
						...rowErrors,
						[created.product_id]: errorMessage(error, 'upload')
					};
					resetForm();
					formMessage = `Naidagdag ang ${validated.name}, pero hindi naikabit ang larawan. Nasa listahan ang ulam; subukan muli mula sa row nito.`;
					return;
				}
			}

			resetForm();
			formMessage = `Naidagdag ang ${validated.name} sa menu.`;
		} catch (error) {
			formError = errorMessage(error, 'create');
		} finally {
			formBusy = false;
		}
	}

	function replaceSelectedFile(file: File | null): void {
		revokePreview();
		selectedFile = file;
		if (file && typeof URL.createObjectURL === 'function') previewUrl = URL.createObjectURL(file);
	}

	function handleFileInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		replaceSelectedFile(input.files?.[0] ?? null);
	}

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		dropActive = false;
		replaceSelectedFile(event.dataTransfer?.files?.[0] ?? null);
	}

	function clearSelectedFile(): void {
		replaceSelectedFile(null);
		if (fileInput) fileInput.value = '';
	}

	function revokePreview(): void {
		if (previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewUrl);
		previewUrl = null;
	}

	function resetForm(): void {
		name = '';
		price = '';
		description = '';
		selectedCategory = categories[0]?.name ?? '';
		clearSelectedFile();
	}

	function clearRowFeedback(productId: number): void {
		const nextErrors = { ...rowErrors };
		const nextMessages = { ...rowMessages };
		delete nextErrors[productId];
		delete nextMessages[productId];
		rowErrors = nextErrors;
		rowMessages = nextMessages;
	}

	function setProductBusy(productId: number, busy: boolean): void {
		const next = { ...busyProducts };
		if (busy) next[productId] = true;
		else delete next[productId];
		busyProducts = next;
	}

	async function uploadRowImage(product: Product, file: File): Promise<void> {
		if (busyProducts[product.product_id]) return;
		setProductBusy(product.product_id, true);
		clearRowFeedback(product.product_id);
		try {
			await uploadProductImage(product.product_id, file);
			const refreshResult = await loadProducts(false);
			if (refreshResult.status !== 'success') {
				rowErrors = {
					...rowErrors,
					[product.product_id]: 'Naikabit ang larawan, pero hindi na-refresh ang listahan.'
				};
			} else {
				rowMessages = {
					...rowMessages,
					[product.product_id]: product.product_image_uri
						? 'Napalitan ang larawan.'
						: 'Naikabit ang larawan.'
				};
			}
		} catch (error) {
			rowErrors = { ...rowErrors, [product.product_id]: errorMessage(error, 'upload') };
		} finally {
			setProductBusy(product.product_id, false);
		}
	}

	function handleRowFile(event: Event, product: Product): void {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) void uploadRowImage(product, file);
		input.value = '';
	}

	async function removeRowImage(product: Product): Promise<void> {
		if (busyProducts[product.product_id] || !product.product_image_uri) return;
		if (
			typeof window !== 'undefined' &&
			!window.confirm(`Alisin ang larawan ng ${product.name}? Hindi ito maibabalik.`)
		) {
			return;
		}

		setProductBusy(product.product_id, true);
		clearRowFeedback(product.product_id);
		try {
			await deleteProductImage(product.product_id);
			const refreshResult = await loadProducts(false);
			if (refreshResult.status !== 'success') {
				rowErrors = {
					...rowErrors,
					[product.product_id]: 'Naalis ang larawan, pero hindi na-refresh ang listahan.'
				};
			} else {
				rowMessages = { ...rowMessages, [product.product_id]: 'Naalis ang larawan.' };
			}
		} catch (error) {
			rowErrors = { ...rowErrors, [product.product_id]: errorMessage(error, 'delete') };
		} finally {
			setProductBusy(product.product_id, false);
		}
	}

	function productPrice(product: Product): string {
		return formatPeso(parsePriceToCents(product.price));
	}

	function productCategories(product: Product): string {
		return product.categories.map((category) => category.name).join(', ') || 'Walang kategorya';
	}
</script>

<div class="admin-menu-board" data-admin-menu-board>
	<p class="hand admin-menu-board__note">dagdag ulam, ikabit ang larawan</p>

	<div class="admin-menu-grid">
		<form
			class="paper-panel admin-menu-form"
			aria-labelledby="admin-new-product-title"
			onsubmit={(event) => {
				event.preventDefault();
				void submitProduct();
			}}
		>
			<h2 class="sign-type admin-menu-subtitle" id="admin-new-product-title">BAGONG ULAM</h2>

			<label class="admin-menu-field" for="admin-product-name">
				<span>Pangalan ng ulam</span>
				<input
					id="admin-product-name"
					name="name"
					type="text"
					required
					autocomplete="off"
					placeholder="Hal. Laing"
					bind:value={name}
					disabled={formBusy}
				/>
			</label>

			<label class="admin-menu-field" for="admin-product-price">
				<span>Presyo <em>decimal string (“95.00”)</em></span>
				<span class="admin-price-row">
					<input
						id="admin-product-price"
						name="price"
						type="text"
						inputmode="decimal"
						required
						pattern="[0-9]+([.][0-9][0-9]?)?"
						placeholder="0.00"
						bind:value={price}
						disabled={formBusy}
					/>
					<output class="tape-tag" for="admin-product-price" aria-label="Preview ng presyo">
						{pricePreview}
					</output>
				</span>
			</label>

			<div class="admin-menu-field">
				<label for="admin-product-category">Kategorya</label>
				<select
					id="admin-product-category"
					name="category"
					bind:value={selectedCategory}
					disabled={formBusy || categoriesState === 'loading'}
				>
					<option value="">Walang kategorya</option>
					{#each categories as category (category.name)}
						<option value={category.name}>{category.name}</option>
					{/each}
				</select>
				<button
					class="admin-menu-cat-toggle"
					type="button"
					aria-expanded={catAddOpen}
					aria-controls="admin-cat-add"
					disabled={formBusy}
					onclick={toggleCatAdd}
				>
					+ bagong kategorya
				</button>
				{#if catAddOpen}
					<div class="admin-menu-cat-add" id="admin-cat-add">
						<label class="sr-only" for="admin-new-category">Pangalan ng bagong kategorya</label>
						<input
							id="admin-new-category"
							type="text"
							autocomplete="off"
							placeholder="Hal. Meryenda"
							bind:value={newCategoryName}
							disabled={catAddBusy || formBusy}
							onkeydown={handleNewCategoryKeydown}
						/>
						<Button
							variant="ghost"
							size="small"
							busy={catAddBusy}
							disabled={catAddBusy || formBusy}
							onclick={submitNewCategory}
						>
							Idagdag
						</Button>
						<span class="admin-menu-cat-add__note"
							>Lilitaw agad sa select na ito at sa menu ng customer.</span
						>
					</div>
				{/if}
				{#if catAddError}
					<p class="admin-menu-row-error" role="alert">{catAddError}</p>
				{/if}
				<span class="sr-only" aria-live="polite">{catAddStatus}</span>
			</div>
			{#if categoriesError}
				<div class="admin-menu-inline-state">
					<InlineAlert tone="error" title="Hindi ma-load ang mga kategorya">
						{categoriesError}
					</InlineAlert>
					<Button variant="quiet" size="small" onclick={() => void loadCategories(true)}>
						Subukan muli ang mga kategorya
					</Button>
				</div>
			{/if}

			<label class="admin-menu-field" for="admin-product-description">
				<span>Paglalarawan <em>opsyonal</em></span>
				<textarea
					id="admin-product-description"
					name="description"
					placeholder="Ano ang lasa, ano ang kasama."
					bind:value={description}
					disabled={formBusy}></textarea>
			</label>

			<div class="admin-menu-field">
				<span id="admin-product-photo-label">Larawan <em>opsyonal, puwede ring mamaya</em></span>
				<label
					class="admin-image-dropzone"
					class:admin-image-dropzone--active={dropActive}
					ondragenter={(event) => {
						event.preventDefault();
						dropActive = true;
					}}
					ondragover={(event) => {
						event.preventDefault();
						dropActive = true;
					}}
					ondragleave={() => (dropActive = false)}
					ondrop={handleDrop}
				>
					<input
						class="sr-only"
						type="file"
						accept="image/jpeg,image/png,image/webp"
						aria-labelledby="admin-product-photo-label"
						bind:this={fileInput}
						disabled={formBusy}
						onchange={handleFileInput}
					/>
					{#if previewUrl && selectedFile}
						<img src={previewUrl} alt={`Preview ng ${selectedFile.name}`} />
					{:else}
						<span class="admin-image-dropzone__hint"
							>ihulog dito ang larawan, o pindutin para pumili</span
						>
						<span class="admin-image-dropzone__meta">JPG / PNG / WEBP</span>
					{/if}
				</label>
				{#if selectedFile}
					<button
						class="admin-menu-remove-link"
						type="button"
						disabled={formBusy}
						onclick={clearSelectedFile}
					>
						Alisin ang napiling larawan
					</button>
				{/if}
			</div>

			{#if formError}
				<InlineAlert tone="error" title="Hindi maidagdag ang ulam">{formError}</InlineAlert>
			{/if}
			{#if formMessage}
				<InlineAlert tone="info" title="Update sa menu">{formMessage}</InlineAlert>
			{/if}

			<Button type="submit" disabled={formBusy} busy={formBusy}>
				{formBusy ? 'Idinadagdag...' : 'Idagdag sa menu'}
			</Button>
			<p class="admin-menu-form__note">
				Unang sine-save ang ulam, saka ang opsyonal na larawan. Server ang sumusuri sa file at size.
			</p>
		</form>

		<section class="admin-product-list" aria-labelledby="admin-product-list-title">
			<header class="admin-product-list__header">
				<h2 class="sign-type admin-menu-subtitle" id="admin-product-list-title">
					MGA ULAM SA BAHAY
				</h2>
				{#if productsError && products.length > 0}
					<Button
						variant="quiet"
						size="small"
						disabled={productsBusy}
						onclick={() => void loadProducts(false)}
					>
						I-refresh ang mga ulam
					</Button>
				{/if}
			</header>

			{#if productsError && products.length > 0}
				<InlineAlert tone="error" title="Hindi na-refresh ang mga ulam">{productsError}</InlineAlert
				>
			{/if}

			{#if productsState === 'loading' && products.length === 0}
				<Skeleton lines={6} label="Naglo-load ang mga ulam" />
			{:else if productsState === 'error' && products.length === 0}
				<div class="paper-panel admin-menu-empty-state">
					<InlineAlert tone="error" title="Hindi ma-load ang mga ulam">{productsError}</InlineAlert>
					<Button variant="ghost" onclick={() => void loadProducts(true)}>
						Subukan muli ang mga ulam
					</Button>
				</div>
			{:else if products.length === 0}
				<div class="paper-panel">
					<EmptyState
						title="Wala pang ulam sa bahay"
						description="Idagdag ang unang ulam gamit ang form."
						titleId="admin-products-empty-title"
					/>
				</div>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal overflow) -->
				<div
					class="admin-menu-ledger-wrap"
					role="region"
					aria-label="Scrollable na listahan ng mga ulam"
					tabindex="0"
				>
					<table class="admin-menu-ledger">
						<caption class="sr-only">Mga ulam at pamamahala ng larawan</caption>
						<thead>
							<tr>
								<th scope="col">Larawan</th>
								<th scope="col">Ulam</th>
								<th scope="col">Presyo</th>
								<th scope="col">Kategorya</th>
								<th scope="col">Aksyon</th>
							</tr>
						</thead>
						<tbody>
							{#each products as product (product.product_id)}
								{@const rowBusy = busyProducts[product.product_id] === true}
								<tr data-admin-product-id={product.product_id}>
									<td>
										<span class="admin-dish-photo">
											{#if product.product_image_uri}
												<img
													src={product.product_image_uri}
													alt={`Larawan ng ${product.name}`}
													loading="lazy"
													decoding="async"
												/>
											{:else}
												<span>Wala pa</span>
											{/if}
										</span>
									</td>
									<th scope="row">
										<span class="admin-dish-name">{product.name}</span>
										{#if product.description}
											<span class="admin-dish-description">{product.description}</span>
										{/if}
									</th>
									<td class="admin-menu-ledger__price">{productPrice(product)}</td>
									<td class="admin-dish-category">{productCategories(product)}</td>
									<td class="admin-menu-ledger__actions">
										<div class="admin-menu-row-actions">
											<label
												class="admin-icon-button admin-menu-upload-button"
												class:admin-menu-upload-button--disabled={rowBusy}
												title={product.product_image_uri
													? 'Palitan ang larawan'
													: 'Ikabit ang larawan'}
											>
												<input
													class="sr-only"
													type="file"
													accept="image/jpeg,image/png,image/webp"
													disabled={rowBusy}
													aria-label={`${product.product_image_uri ? 'Palitan' : 'Ikabit'} ang larawan ng ${product.name}`}
													onchange={(event) => handleRowFile(event, product)}
												/>
												<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
													<path
														d="M4 8.5c4-.3 12-.1 16 .1.2 3.4 0 7.9-.2 10.4-5.8.3-10.8.2-15.6 0C4 15 3.9 11.5 4 8.5Z"
													/>
													<path d="M8.5 8.4c.2-1.4.5-2.2.8-3l5.3-.2c.4.8.7 1.7.9 3" />
													<circle cx="12" cy="13.4" r="3.1" />
												</svg>
											</label>
											<button
												class="admin-icon-button admin-icon-button--danger"
												type="button"
												disabled={rowBusy || !product.product_image_uri}
												aria-busy={rowBusy}
												aria-label={`Alisin ang larawan ng ${product.name}`}
												title="Alisin ang larawan"
												onclick={() => void removeRowImage(product)}
											>
												<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
													<path
														d="M6.5 6.8c3.5 3.2 7.5 7.4 11 10.5M17.3 6.5c-3.5 3.7-7 7.5-10.5 11"
													/>
												</svg>
											</button>
										</div>
										{#if rowErrors[product.product_id]}
											<p class="admin-menu-row-error" role="alert">
												{rowErrors[product.product_id]}
											</p>
										{/if}
										{#if rowMessages[product.product_id]}
											<p class="admin-menu-row-message" role="status">
												{rowMessages[product.product_id]}
											</p>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<p class="admin-product-list__note">
				Ang larawang ikinakabit dito ang lilitaw sa menu ng customer pagkarefresh.
			</p>
		</section>
	</div>
</div>
