import { writable } from 'svelte/store';
import type { CartItem, Product } from '../api/types';
import { parsePriceToCents } from '../utils/money';

/**
 * Versioned localStorage cart. Persisted lines carry only product id,
 * quantity, and a last-known name/price snapshot — never image URLs
 * (product images may be short-lived SAS links). Loaded data is validated
 * line by line; an unknown version or malformed payload resets to empty.
 */

const STORAGE_KEY = 'kanto:cart';
const CART_VERSION = 1;
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 20;

interface PersistedCart {
	version: number;
	items: CartItem[];
}

function loadInitialItems(): CartItem[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed) || parsed.version !== CART_VERSION || !Array.isArray(parsed.items)) {
			return [];
		}
		return parsed.items.map(normalizeCartItem).filter((item): item is CartItem => item !== null);
	} catch {
		return [];
	}
}

function normalizeCartItem(value: unknown): CartItem | null {
	if (!isRecord(value)) return null;
	const item = value;
	if (
		typeof item.productId !== 'number' ||
		!Number.isSafeInteger(item.productId) ||
		item.productId <= 0 ||
		typeof item.quantity !== 'number' ||
		!Number.isSafeInteger(item.quantity) ||
		item.quantity < MIN_QUANTITY ||
		item.quantity > MAX_QUANTITY ||
		typeof item.name !== 'string' ||
		typeof item.price !== 'string'
	) {
		return null;
	}
	try {
		if (parsePriceToCents(item.price) < 0) return null;
	} catch {
		return null;
	}
	return {
		productId: item.productId,
		quantity: item.quantity,
		name: item.name,
		price: item.price
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function persist(items: CartItem[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const payload: PersistedCart = {
			version: CART_VERSION,
			items: items.map(({ productId, quantity, name, price }) => ({
				productId,
				quantity,
				name,
				price
			}))
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Storage unavailable (private mode, quota): keep the session cart.
	}
}

function clampQuantity(quantity: number): number {
	if (!Number.isInteger(quantity) || quantity < MIN_QUANTITY) return MIN_QUANTITY;
	if (quantity > MAX_QUANTITY) return MAX_QUANTITY;
	return quantity;
}

function createCartStore() {
	const { subscribe, set, update } = writable<CartItem[]>(loadInitialItems());

	subscribe((items) => persist(items));

	return {
		subscribe,

		/** Adds one unit of a product (or a given quantity for a new line). */
		addItem(product: Pick<Product, 'product_id' | 'name' | 'price'>, quantity = 1): void {
			update((items) => {
				const existing = items.find((item) => item.productId === product.product_id);
				if (existing) {
					return items.map((item) =>
						item.productId === product.product_id
							? { ...item, quantity: clampQuantity(item.quantity + 1) }
							: item
					);
				}
				return [
					...items,
					{
						productId: product.product_id,
						quantity: clampQuantity(quantity),
						name: product.name,
						price: product.price
					}
				];
			});
		},

		/** Sets a line quantity, clamped to 1–20; 0 or negative removes the line. */
		updateQuantity(productId: number, quantity: number): void {
			update((items) => {
				if (quantity <= 0) {
					return items.filter((item) => item.productId !== productId);
				}
				return items.map((item) =>
					item.productId === productId ? { ...item, quantity: clampQuantity(quantity) } : item
				);
			});
		},

		removeItem(productId: number): void {
			update((items) => items.filter((item) => item.productId !== productId));
		},

		clear(): void {
			set([]);
		},

		/**
		 * Reconciles persisted lines against the fresh catalog: name/price
		 * snapshots are refreshed and lines for missing products are removed.
		 * Returns the removed product ids.
		 */
		reconcile(products: Product[]): number[] {
			const byId = new Map(products.map((product) => [product.product_id, product]));
			let removed: number[] = [];
			update((items) => {
				removed = items.filter((item) => !byId.has(item.productId)).map((item) => item.productId);
				const reconciled: CartItem[] = [];
				for (const item of items) {
					const product = byId.get(item.productId);
					if (product) reconciled.push({ ...item, name: product.name, price: product.price });
				}
				return reconciled;
			});
			return removed;
		}
	};
}

export const cart = createCartStore();

export function cartItemCount(items: CartItem[]): number {
	return items.reduce((total, item) => total + item.quantity, 0);
}

export function cartTotalCents(items: CartItem[]): number {
	return items.reduce((total, item) => total + parsePriceToCents(item.price) * item.quantity, 0);
}
