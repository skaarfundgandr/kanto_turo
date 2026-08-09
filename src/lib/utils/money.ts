/**
 * Exact money conversions. Backend prices are decimal strings; the app never
 * does float arithmetic on money. Cents are integers only.
 */

const PRICE_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/** Converts a decimal price string with at most two decimal places to cents. */
export function parsePriceToCents(price: string): number {
	if (typeof price !== 'string' || !PRICE_PATTERN.test(price)) {
		throw new Error(`Invalid price string: ${JSON.stringify(price)}`);
	}

	const sign = price.startsWith('-') ? -1n : 1n;
	const unsigned = price.replace(/^[+-]/, '');
	const [whole, fraction = ''] = unsigned.split('.');
	if (fraction.length > 2) {
		throw new Error(`Price has more than two decimal places: ${JSON.stringify(price)}`);
	}
	let cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
	cents *= sign;

	const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
	if (cents > maxSafe || cents < -maxSafe) {
		throw new Error(`Price out of range: ${JSON.stringify(price)}`);
	}
	return Number(cents);
}

/** Formats integer cents as peso copy, e.g. 12345 -> "₱123.45". */
export function formatPeso(cents: number): string {
	if (!Number.isSafeInteger(cents)) {
		throw new Error(`Invalid cents value: ${JSON.stringify(cents)}`);
	}
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(cents);
	const whole = Math.floor(abs / 100)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	const fraction = String(abs % 100).padStart(2, '0');
	return `${sign}₱${whole}.${fraction}`;
}

/** Round-trips integer cents back to a decimal string, e.g. 12345 -> "123.45". */
export function centsToDecimalString(cents: number): string {
	if (!Number.isSafeInteger(cents)) {
		throw new Error(`Invalid cents value: ${JSON.stringify(cents)}`);
	}
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(cents);
	return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
