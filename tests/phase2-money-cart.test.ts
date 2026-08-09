import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../src/lib/api/types';
import { centsToDecimalString, formatPeso, parsePriceToCents } from '../src/lib/utils/money';
import { cart, cartItemCount, cartTotalCents } from '../src/lib/stores/cart';

const product = {
	product_id: 1,
	name: 'Chicken adobo',
	description: null,
	price: '123.45',
	product_image_uri: 'https://blob.example/sas-image',
	categories: []
} satisfies Product;

const secondProduct = {
	...product,
	product_id: 2,
	name: 'Pancit',
	price: '50.00'
} satisfies Product;

describe('money utilities', () => {
	it('converts only exact cent values and enforces safe integer boundaries', () => {
		expect(parsePriceToCents('12')).toBe(1200);
		expect(parsePriceToCents('12.3')).toBe(1230);
		expect(parsePriceToCents('-0.01')).toBe(-1);
		expect(parsePriceToCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
		expect(() => parsePriceToCents('12.345')).toThrow('more than two decimal places');
		expect(() => parsePriceToCents('90071992547409.92')).toThrow('Price out of range');
		expect(() => parsePriceToCents('12 pesos')).toThrow('Invalid price string');
	});

	it('formats pesos and serializes cents without floating point math', () => {
		expect(formatPeso(123456)).toBe('₱1,234.56');
		expect(formatPeso(-5)).toBe('-₱0.05');
		expect(centsToDecimalString(123456)).toBe('1234.56');
		expect(centsToDecimalString(-5)).toBe('-0.05');
	});
});

describe('cart persistence and reconciliation', () => {
	beforeEach(() => {
		cart.clear();
		localStorage.clear();
	});

	it('clamps quantities, merges additions, and calculates integer totals', () => {
		cart.addItem(product, 25);
		cart.addItem(product);
		const items = get(cart);

		expect(items).toHaveLength(1);
		expect(items[0].quantity).toBe(20);
		expect(cartItemCount(items)).toBe(20);
		expect(cartTotalCents(items)).toBe(246900);

		cart.updateQuantity(product.product_id, 0);
		expect(get(cart)).toEqual([]);
	});

	it('adds exactly one unit when a product is already in the cart', () => {
		cart.addItem(product, 2);
		cart.addItem(product, 9);

		expect(get(cart)).toEqual([
			{ productId: 1, quantity: 3, name: 'Chicken adobo', price: '123.45' }
		]);
	});

	it('drops malformed persisted quantities and clamps mutation inputs', async () => {
		localStorage.setItem(
			'kanto:cart',
			JSON.stringify({
				version: 1,
				items: [
					{ productId: 1, quantity: 1.5, name: 'Fractional', price: '1.00' },
					{ productId: 2, quantity: 21, name: 'Too many', price: '2.00' },
					{ productId: 3, quantity: 2, name: 'Valid', price: '3.00' }
				]
			})
		);

		vi.resetModules();
		const reloaded = await import('../src/lib/stores/cart');
		expect(get(reloaded.cart)).toEqual([
			{ productId: 3, quantity: 2, name: 'Valid', price: '3.00' }
		]);

		reloaded.cart.updateQuantity(3, 99);
		expect(get(reloaded.cart)[0].quantity).toBe(20);
		reloaded.cart.updateQuantity(3, 2.5);
		expect(get(reloaded.cart)[0].quantity).toBe(1);
		reloaded.cart.removeItem(3);
		expect(get(reloaded.cart)).toEqual([]);
	});

	it('persists only the cart DTO fields and never image URLs', () => {
		cart.addItem(product, 2);
		const persisted = JSON.parse(localStorage.getItem('kanto:cart') ?? '{}');

		expect(persisted.items[0]).toEqual({
			productId: 1,
			quantity: 2,
			name: 'Chicken adobo',
			price: '123.45'
		});
		expect(JSON.stringify(persisted)).not.toContain('sas-image');
	});

	it('persists quantity, removal, and reconciliation mutations', () => {
		cart.addItem(product, 2);
		cart.updateQuantity(product.product_id, 4);
		expect(JSON.parse(localStorage.getItem('kanto:cart') ?? '{}').items[0].quantity).toBe(4);

		cart.removeItem(product.product_id);
		expect(JSON.parse(localStorage.getItem('kanto:cart') ?? '{}').items).toEqual([]);

		cart.addItem(secondProduct);
		cart.reconcile([{ ...secondProduct, name: 'Updated pancit', price: '55.00' }]);
		expect(JSON.parse(localStorage.getItem('kanto:cart') ?? '{}').items).toEqual([
			{ productId: 2, quantity: 1, name: 'Updated pancit', price: '55.00' }
		]);
	});

	it('sanitizes extra persisted fields during reload', async () => {
		localStorage.setItem(
			'kanto:cart',
			JSON.stringify({
				version: 1,
				items: [
					{
						productId: 1,
						quantity: 2,
						name: 'Chicken adobo',
						price: '123.45',
						product_image_uri: 'must-not-survive'
					}
				]
			})
		);

		vi.resetModules();
		const reloaded = await import('../src/lib/stores/cart');
		expect(get(reloaded.cart)).toEqual([
			{ productId: 1, quantity: 2, name: 'Chicken adobo', price: '123.45' }
		]);
		expect(JSON.stringify(localStorage.getItem('kanto:cart'))).not.toContain('must-not-survive');
		reloaded.cart.clear();
	});

	it('refreshes snapshots and removes missing catalog products', () => {
		cart.addItem(product);
		cart.addItem(secondProduct);

		const removed = cart.reconcile([{ ...product, name: 'Updated chicken', price: '130.00' }]);

		expect(removed).toEqual([2]);
		expect(get(cart)).toEqual([
			{ productId: 1, quantity: 1, name: 'Updated chicken', price: '130.00' }
		]);
	});
});
