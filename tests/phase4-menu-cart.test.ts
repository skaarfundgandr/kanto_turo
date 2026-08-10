import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Product } from '../src/lib/api/types';
import ProductPlate from '../src/lib/components/public/ProductPlate.svelte';
import StickyCartBar from '../src/lib/components/public/StickyCartBar.svelte';
import { cart } from '../src/lib/stores/cart';
import MenuPage from '../src/routes/+page.svelte';
import CartPage from '../src/routes/cart/+page.svelte';
import { get } from 'svelte/store';

const endpointMocks = vi.hoisted(() => ({
	getProduct: vi.fn(),
	listCategories: vi.fn(),
	listCategoryProducts: vi.fn(),
	listProducts: vi.fn()
}));

const routerMocks = vi.hoisted(() => ({
	page: {
		url: new URL('http://localhost/'),
		state: { preserved: true }
	},
	replaceState: vi.fn(),
	resolve: vi.fn((path: string) => `/base${path}`)
}));

vi.mock('../src/lib/api/endpoints', () => endpointMocks);
vi.mock('$app/navigation', () => ({ replaceState: routerMocks.replaceState }));
vi.mock('$app/paths', () => ({ resolve: routerMocks.resolve }));
vi.mock('$app/state', () => ({ page: routerMocks.page }));

const categories: Category[] = [
	{
		category_id: 1,
		name: 'Ulam & Rice',
		description: null,
		created_at: null,
		updated_at: null
	}
];

const product: Product = {
	product_id: 1,
	name: 'Chicken adobo',
	description: 'Malinamnam at bagong luto.',
	price: '123.45',
	product_image_uri: null,
	categories
};

const secondProduct: Product = {
	...product,
	product_id: 2,
	name: 'Pancit',
	price: '50.00'
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

beforeEach(() => {
	vi.clearAllMocks();
	cart.clear();
	localStorage.clear();
	routerMocks.page.url = new URL('http://localhost/');
	endpointMocks.listCategories.mockResolvedValue(categories);
	endpointMocks.listProducts.mockResolvedValue([product]);
	endpointMocks.listCategoryProducts.mockResolvedValue([product]);
});

afterEach(() => {
	cleanup();
	window.history.replaceState({}, '', '/');
	vi.clearAllMocks();
	cart.clear();
	localStorage.clear();
	routerMocks.page.url = new URL('http://localhost/');
});

describe('Phase 4 public menu', () => {
	it('loads live products, adds duplicates to one cart line, and announces quantity', async () => {
		const view = render(MenuPage);

		expect(
			within(view.container).getByRole('status', { name: 'Naglo-load ang menu' })
		).not.toBeNull();
		const addButton = await view.findByRole('button', { name: 'Turo Chicken adobo' });

		await fireEvent.click(addButton);
		expect(get(cart)).toEqual([
			{ productId: 1, quantity: 1, name: 'Chicken adobo', price: '123.45' }
		]);
		expect(view.getByText('Napili · 1')).not.toBeNull();
		expect(view.getByText('Chicken adobo naidagdag sa slip. Dami: 1.')).not.toBeNull();

		await fireEvent.click(await view.findByRole('button', { name: 'Dagdagan ang Chicken adobo' }));

		expect(get(cart)).toEqual([
			{ productId: 1, quantity: 2, name: 'Chicken adobo', price: '123.45' }
		]);
		expect(view.getByText('Napili · 2')).not.toBeNull();
		expect(view.getByText('Chicken adobo naidagdag sa slip. Dami: 2.')).not.toBeNull();
		expect(endpointMocks.listCategories).toHaveBeenCalledTimes(1);
		expect(endpointMocks.listProducts).toHaveBeenCalledTimes(1);
	});

	it('encodes category selections, calls the category endpoint, and supports Lahat', async () => {
		const view = render(MenuPage);
		await view.findByRole('button', { name: 'Ulam & Rice' });
		await fireEvent.click(view.getByRole('button', { name: 'Turo Chicken adobo' }));
		expect(view.getByText('Chicken adobo naidagdag sa slip. Dami: 1.')).not.toBeNull();

		await fireEvent.click(view.getByRole('button', { name: 'Ulam & Rice' }));
		await waitFor(() =>
			expect(endpointMocks.listCategoryProducts).toHaveBeenCalledWith('Ulam & Rice')
		);
		expect(view.queryByText('Chicken adobo naidagdag sa slip. Dami: 1.')).toBeNull();
		expect(routerMocks.replaceState).toHaveBeenNthCalledWith(
			1,
			'/base/?category=Ulam+%26+Rice',
			routerMocks.page.state
		);

		await fireEvent.click(view.getByRole('button', { name: 'Lahat' }));
		await waitFor(() => expect(endpointMocks.listProducts).toHaveBeenCalledTimes(2));
		expect(routerMocks.replaceState).toHaveBeenNthCalledWith(2, '/base/', routerMocks.page.state);
	});

	it('follows browser category navigation and reloads the matching menu', async () => {
		const categoryProduct = { ...secondProduct, name: 'Category pancit' };
		endpointMocks.listCategoryProducts.mockResolvedValue([categoryProduct]);
		const view = render(MenuPage);
		await view.findByRole('button', { name: 'Turo Chicken adobo' });

		window.history.pushState({}, '', '/?category=Ulam+%26+Rice');
		window.dispatchEvent(new PopStateEvent('popstate'));

		await waitFor(() => {
			expect(endpointMocks.listCategoryProducts).toHaveBeenCalledWith('Ulam & Rice');
			expect(view.getByRole('button', { name: 'Ulam & Rice' }).getAttribute('aria-pressed')).toBe(
				'true'
			);
			expect(view.getByRole('button', { name: 'Turo Category pancit' })).not.toBeNull();
		});

		window.history.pushState({}, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));

		await waitFor(() => {
			expect(endpointMocks.listProducts).toHaveBeenCalledTimes(2);
			expect(view.getByRole('button', { name: 'Lahat' }).getAttribute('aria-pressed')).toBe('true');
			expect(view.getByRole('button', { name: 'Turo Chicken adobo' })).not.toBeNull();
		});
	});

	it('falls back to Lahat for an unknown deep-linked category without a 404 request', async () => {
		routerMocks.page.url = new URL('http://localhost/?category=Unknown');
		const view = render(MenuPage);

		expect(await view.findByRole('button', { name: 'Turo Chicken adobo' })).not.toBeNull();
		expect(endpointMocks.listCategoryProducts).not.toHaveBeenCalled();
		expect(endpointMocks.listProducts).toHaveBeenCalledTimes(1);
		expect(routerMocks.replaceState).toHaveBeenCalledWith('/base/', routerMocks.page.state);
	});

	it('renders a deterministic empty menu state from an empty API response', async () => {
		endpointMocks.listProducts.mockResolvedValue([]);
		const view = render(MenuPage);

		expect(await view.findByRole('heading', { name: 'Walang putahe sa menu' })).not.toBeNull();
		expect(view.queryByRole('button', { name: 'Turo Chicken adobo' })).toBeNull();
	});

	it('renders an empty-category state with a Lahat escape hatch', async () => {
		routerMocks.page.url = new URL('http://localhost/?category=Ulam+%26+Rice');
		endpointMocks.listCategoryProducts.mockResolvedValue([]);
		const view = render(MenuPage);

		expect(
			await view.findByRole('heading', { name: 'Walang putahe sa Ulam & Rice' })
		).not.toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Tingnan lahat' }));

		expect(await view.findByRole('button', { name: 'Turo Chicken adobo' })).not.toBeNull();
		expect(routerMocks.replaceState).toHaveBeenCalledWith('/base/', routerMocks.page.state);
	});

	it('renders a retryable category error and retries through the endpoint layer', async () => {
		routerMocks.page.url = new URL('http://localhost/?category=Ulam+%26+Rice');
		endpointMocks.listCategoryProducts.mockRejectedValueOnce(new Error('Category unavailable'));
		const view = render(MenuPage);

		expect(await view.findByText('Category unavailable')).not.toBeNull();
		endpointMocks.listCategoryProducts.mockResolvedValueOnce([product]);
		await fireEvent.click(view.getByRole('button', { name: 'Subukan muli' }));

		expect(await view.findByRole('button', { name: 'Turo Chicken adobo' })).not.toBeNull();
		expect(endpointMocks.listCategoryProducts).toHaveBeenCalledTimes(2);
	});
});

describe('Phase 4 product plate and sticky slip', () => {
	it('uses product alt text, shows a no-image slot, and refetches an image only once', async () => {
		const refreshedProduct = { ...product, product_image_uri: 'https://blob.test/refreshed-sas' };
		endpointMocks.getProduct.mockResolvedValue(refreshedProduct);
		const missingView = render(ProductPlate, { product });

		expect(
			missingView.getByRole('img', { name: 'Walang larawan para sa Chicken adobo' })
		).not.toBeNull();

		const firstImageProduct: Product = {
			...product,
			product_image_uri: 'https://blob.test/expired-sas'
		};
		cleanup();
		const view = render(ProductPlate, { product: firstImageProduct });
		const firstImage = view.getByRole('img', { name: 'Chicken adobo' });
		expect(firstImage.getAttribute('loading')).toBe('lazy');
		await fireEvent.error(firstImage);
		await waitFor(() => expect(endpointMocks.getProduct).toHaveBeenCalledWith(1));

		const refreshedImage = view.getByRole('img', { name: 'Chicken adobo' });
		expect(refreshedImage.getAttribute('src')).toBe('https://blob.test/refreshed-sas');
		await fireEvent.error(refreshedImage);
		expect(
			await view.findByRole('img', { name: 'Walang larawan para sa Chicken adobo' })
		).not.toBeNull();
		expect(endpointMocks.getProduct).toHaveBeenCalledTimes(1);
	});

	it('resets image state for a fresh same-ID URI and refetches once per source', async () => {
		endpointMocks.getProduct.mockResolvedValue({
			...product,
			product_image_uri: 'https://blob.test/refetched-sas'
		});
		const view = render(ProductPlate, {
			product: { ...product, product_image_uri: null }
		});

		await view.rerender({
			product: { ...product, product_image_uri: 'https://blob.test/fresh-sas' }
		});
		const freshImage = await view.findByRole('img', { name: 'Chicken adobo' });
		expect(freshImage.getAttribute('src')).toBe('https://blob.test/fresh-sas');

		await fireEvent.error(freshImage);
		await waitFor(() => expect(endpointMocks.getProduct).toHaveBeenCalledTimes(1));
		await fireEvent.error(view.getByRole('img', { name: 'Chicken adobo' }));
		expect(
			await view.findByRole('img', { name: 'Walang larawan para sa Chicken adobo' })
		).not.toBeNull();

		await view.rerender({
			product: { ...product, product_image_uri: 'https://blob.test/another-sas' }
		});
		await fireEvent.error(await view.findByRole('img', { name: 'Chicken adobo' }));
		await waitFor(() => expect(endpointMocks.getProduct).toHaveBeenCalledTimes(2));
	});

	it('ignores stale image responses after source replacement and unmount', async () => {
		const firstResponse = deferred<Product>();
		const secondResponse = deferred<Product>();
		endpointMocks.getProduct
			.mockReturnValueOnce(firstResponse.promise)
			.mockReturnValueOnce(secondResponse.promise);
		const view = render(ProductPlate, {
			product: { ...product, product_image_uri: 'https://blob.test/expired-sas' }
		});

		await fireEvent.error(view.getByRole('img', { name: 'Chicken adobo' }));
		await view.rerender({
			product: { ...product, product_image_uri: 'https://blob.test/fresh-sas' }
		});
		await waitFor(() =>
			expect(view.getByRole('img', { name: 'Chicken adobo' }).getAttribute('src')).toBe(
				'https://blob.test/fresh-sas'
			)
		);

		firstResponse.resolve({ ...product, product_image_uri: 'https://blob.test/stale-sas' });
		await Promise.resolve();
		expect(view.getByRole('img', { name: 'Chicken adobo' }).getAttribute('src')).toBe(
			'https://blob.test/fresh-sas'
		);

		await fireEvent.error(view.getByRole('img', { name: 'Chicken adobo' }));
		view.unmount();
		secondResponse.resolve({
			...product,
			product_image_uri: 'https://blob.test/stale-after-unmount'
		});
		await Promise.resolve();
		expect(view.container.querySelector('img')).toBeNull();
	});

	it('keeps the live sticky bar tied to cart count and peso total', async () => {
		const view = render(StickyCartBar);
		expect(view.container.querySelector('[data-cart-count]')?.textContent).toContain('0 items');
		expect(view.container.querySelector('[data-cart-total]')?.textContent).toContain('₱0.00');

		cart.addItem(product, 2);
		await waitFor(() =>
			expect(view.container.querySelector('[data-cart-count]')?.textContent).toContain('2 items')
		);
		expect(view.container.querySelector('[data-cart-total]')?.textContent).toContain('₱246.90');
		expect(view.getByRole('link', { name: 'Buksan ang order slip' }).getAttribute('href')).toBe(
			'/base/cart'
		);
	});
});

describe('Phase 4 cart page', () => {
	it('reconciles changed prices/names, explains missing lines, and enables checkout only after success', async () => {
		cart.addItem(product, 2);
		cart.addItem(secondProduct);
		endpointMocks.listProducts.mockResolvedValue([
			{ ...product, name: 'Updated chicken', price: '130.00' }
		]);

		const view = render(CartPage);
		const updatedName = await view.findByRole('heading', { name: 'Updated chicken' });
		expect(updatedName).not.toBeNull();
		expect(view.queryByRole('heading', { name: 'Chicken adobo' })).toBeNull();
		const reconciledLine = view.container.querySelector('[data-cart-item="1"]');
		expect(reconciledLine).not.toBeNull();
		expect(within(reconciledLine as HTMLElement).getByText('₱260.00')).not.toBeNull();
		expect(view.getByText(/Pancit ay wala na/)).not.toBeNull();

		const increment = view.getByRole('button', { name: 'Dami ng Updated chicken: dagdagan' });
		await fireEvent.click(increment);
		expect(view.getByRole('button', { name: 'Dami ng Updated chicken: bawasan' })).not.toBeNull();
		expect(within(reconciledLine as HTMLElement).getByText('₱390.00')).not.toBeNull();

		await fireEvent.click(view.getByRole('button', { name: 'Alisin ang Updated chicken' }));
		expect(view.getByRole('heading', { name: 'Walang laman ang order slip' })).not.toBeNull();
	});

	it('keeps checkout disabled when catalog reconciliation fails', async () => {
		cart.addItem(product);
		endpointMocks.listProducts.mockRejectedValue(new Error('Catalog offline'));
		const view = render(CartPage);

		expect(await view.findByText(/Catalog offline/)).not.toBeNull();
		expect(await view.findByText(/Snapshot lamang ang mga presyo/)).not.toBeNull();
		const checkout = view.getByRole('link', { name: 'Checkout ay hindi pa handa' });
		expect(checkout.getAttribute('aria-disabled')).toBe('true');
		expect(checkout.getAttribute('href')).toBe('/base/checkout');
	});

	it('clears the cart through the route UI', async () => {
		cart.addItem(product);
		const view = render(CartPage);

		await view.findByRole('heading', { name: 'Chicken adobo' });
		await fireEvent.click(view.getByRole('button', { name: 'I-clear ang slip' }));

		expect(get(cart)).toEqual([]);
		expect(view.getByRole('heading', { name: 'Walang laman ang order slip' })).not.toBeNull();
	});

	it('ignores a pending catalog result after the cart route unmounts', async () => {
		const pendingCatalog = deferred<Product[]>();
		endpointMocks.listProducts.mockReturnValueOnce(pendingCatalog.promise);
		cart.addItem(secondProduct);
		const view = render(CartPage);

		await waitFor(() => expect(endpointMocks.listProducts).toHaveBeenCalledTimes(1));
		view.unmount();
		pendingCatalog.resolve([product]);
		await pendingCatalog.promise;

		expect(get(cart)).toEqual([{ productId: 2, quantity: 1, name: 'Pancit', price: '50.00' }]);
	});
});
