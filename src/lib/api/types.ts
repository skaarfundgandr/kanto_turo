import { parsePriceToCents } from '../utils/money';
import type { components } from './generated';

/**
 * Stable application DTOs. The generated OpenAPI types describe the backend's
 * serde output and therefore mark many fields optional. Endpoint normalizers
 * below turn that wire shape into the required shape used by the application.
 * No caller outside the API layer needs to import `generated.ts`.
 */

type Schemas = components['schemas'];
type GeneratedCategory = Schemas['CategoryResponse'];
type GeneratedCreateOrder = Schemas['CreateOrderResponse'];
type GeneratedLogin = Schemas['LoginResponse'];
type GeneratedOrder = Schemas['OrderResponse'];
type GeneratedOrderItem = Schemas['OrderItemResponse'];
type GeneratedOrderItemRequest = Schemas['OrderItemRequest'];
type GeneratedPayOrder = Schemas['PayOrderResponse'];
type GeneratedProduct = Schemas['ProductResponse'];
type GeneratedRole = Schemas['RoleDTO'];
type GeneratedUser = Schemas['UserDTO'];

type RequiredField<Schema, Key extends keyof Schema> = NonNullable<Schema[Key]>;
type NullableField<Schema, Key extends keyof Schema> = Exclude<Schema[Key], undefined> | null;

/** Exact backend order status values; send only these values to the backend. */
export type OrderStatus = RequiredField<GeneratedOrder, 'status'>;

/** Exact backend payment status values. */
export type PaymentStatus = RequiredField<GeneratedOrder, 'payment_status'>;

export type Permission = RequiredField<GeneratedRole, 'permissions'>[number];

export interface Category {
	category_id: NullableField<GeneratedCategory, 'category_id'>;
	name: RequiredField<GeneratedCategory, 'name'>;
	description: NullableField<GeneratedCategory, 'description'>;
	created_at: NullableField<GeneratedCategory, 'created_at'>;
	updated_at: NullableField<GeneratedCategory, 'updated_at'>;
}

export interface Product {
	product_id: RequiredField<GeneratedProduct, 'product_id'>;
	name: RequiredField<GeneratedProduct, 'name'>;
	description: NullableField<GeneratedProduct, 'description'>;
	price: RequiredField<GeneratedProduct, 'price'>;
	product_image_uri: NullableField<GeneratedProduct, 'product_image_uri'>;
	categories: Category[];
}

export interface OrderItem {
	product: Product | null;
	quantity: RequiredField<GeneratedOrderItem, 'quantity'>;
	unit_price: RequiredField<GeneratedOrderItem, 'unit_price'>;
	line_total: RequiredField<GeneratedOrderItem, 'line_total'>;
}

export interface Order {
	order_id: RequiredField<GeneratedOrder, 'order_id'>;
	user_id: NullableField<GeneratedOrder, 'user_id'>;
	products: OrderItem[];
	total_amount: RequiredField<GeneratedOrder, 'total_amount'>;
	status: NullableField<GeneratedOrder, 'status'>;
	payment_status: RequiredField<GeneratedOrder, 'payment_status'>;
	created_at: NullableField<GeneratedOrder, 'created_at'>;
	updated_at: NullableField<GeneratedOrder, 'updated_at'>;
}

export interface CreateOrderResponse {
	order: Order;
	order_url: RequiredField<GeneratedCreateOrder, 'order_url'>;
}

export interface PayOrderResponse {
	order_id: RequiredField<GeneratedPayOrder, 'order_id'>;
	payment_status: RequiredField<GeneratedPayOrder, 'payment_status'>;
	message: NullableField<GeneratedPayOrder, 'message'>;
}

export interface LoginResponse {
	/** The backend may omit this when an upstream response is malformed. */
	token: NullableField<GeneratedLogin, 'token'>;
	message: NullableField<GeneratedLogin, 'message'>;
}

export interface Role {
	role_id: NullableField<GeneratedRole, 'role_id'>;
	name: NullableField<GeneratedRole, 'name'>;
	description: NullableField<GeneratedRole, 'description'>;
	permissions: Permission[];
}

export interface User {
	user_id: NullableField<GeneratedUser, 'user_id'>;
	username: NullableField<GeneratedUser, 'username'>;
	role: Role | null;
	created_at: NullableField<GeneratedUser, 'created_at'>;
	updated_at: NullableField<GeneratedUser, 'updated_at'>;
}

export interface OrderCreateItem {
	product_id: RequiredField<GeneratedOrderItemRequest, 'product_id'>;
	quantity: RequiredField<GeneratedOrderItemRequest, 'quantity'>;
}

export interface OrderCreateRequest {
	products: OrderCreateItem[];
}

/** A persisted cart line: product snapshot plus quantity. */
export interface CartItem {
	productId: number;
	quantity: number;
	name: string;
	/** Decimal price string snapshot at add/reconcile time (never an image URL). */
	price: string;
}

/** Numeric JWT claims decoded client-side for lookup/scheduling only. */
export interface JwtClaims {
	sub: number;
	exp: number;
}

/** A validated signed receipt link: order id plus string `exp`/`sig` query values. */
export interface SignedOrderLink {
	orderId: number;
	exp: string;
	sig: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function requiredString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function validPrice(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		return parsePriceToCents(value) >= 0;
	} catch {
		return false;
	}
}

function isPermission(value: unknown): value is Permission {
	return value === 'READ' || value === 'WRITE' || value === 'DELETE' || value === 'ADMIN';
}

function isOrderStatusValue(value: unknown): value is OrderStatus {
	return (
		value === 'Pending' ||
		value === 'Accepted' ||
		value === 'Ready' ||
		value === 'Completed' ||
		value === 'Cancelled'
	);
}

function isPaymentStatusValue(value: unknown): value is PaymentStatus {
	return value === 'unpaid' || value === 'paid' || value === 'failed';
}

/** Converts one generated category response into the stable category DTO. */
export function normalizeCategory(value: unknown): Category | null {
	if (!isRecord(value)) return null;
	const name = requiredString(value.name);
	if (name === null) return null;
	return {
		category_id: positiveInteger(value.category_id),
		name,
		description: nullableString(value.description),
		created_at: nullableString(value.created_at),
		updated_at: nullableString(value.updated_at)
	};
}

/** Converts one generated product response into the stable product DTO. */
export function normalizeProduct(value: unknown): Product | null {
	if (!isRecord(value)) return null;
	const productId = positiveInteger(value.product_id);
	const name = requiredString(value.name);
	if (productId === null || name === null || !validPrice(value.price)) return null;

	let categories: Category[] = [];
	if (value.categories !== undefined && value.categories !== null) {
		if (!Array.isArray(value.categories)) return null;
		const normalizedCategories: Category[] = [];
		for (const category of value.categories) {
			const normalized = normalizeCategory(category);
			if (normalized === null) return null;
			normalizedCategories.push(normalized);
		}
		categories = normalizedCategories;
	}

	return {
		product_id: productId,
		name,
		description: nullableString(value.description),
		price: value.price,
		product_image_uri: nullableString(value.product_image_uri),
		categories
	};
}

/** Converts a generated role response, defaulting omitted permissions safely. */
export function normalizeRole(value: unknown): Role | null {
	if (!isRecord(value)) return null;
	const permissions = Array.isArray(value.permissions)
		? value.permissions.filter(isPermission)
		: [];
	return {
		role_id: positiveInteger(value.role_id),
		name: nullableString(value.name),
		description: nullableString(value.description),
		permissions
	};
}

/** Converts a generated user response without trusting JWT role claims. */
export function normalizeUser(value: unknown): User | null {
	if (!isRecord(value)) return null;
	const role = value.role === undefined || value.role === null ? null : normalizeRole(value.role);
	return {
		user_id: positiveInteger(value.user_id),
		username: nullableString(value.username),
		role,
		created_at: nullableString(value.created_at),
		updated_at: nullableString(value.updated_at)
	};
}

/** Converts one generated order line and validates its monetary fields. */
export function normalizeOrderItem(value: unknown): OrderItem | null {
	if (!isRecord(value)) return null;
	const quantity = value.quantity;
	if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
	if (!validPrice(value.unit_price) || !validPrice(value.line_total)) return null;

	let product: Product | null = null;
	if (value.product !== undefined && value.product !== null) {
		product = normalizeProduct(value.product);
		if (product === null) return null;
	}

	return {
		product,
		quantity,
		unit_price: value.unit_price,
		line_total: value.line_total
	};
}

/** Converts one generated order response into the stable order DTO. */
export function normalizeOrder(value: unknown): Order | null {
	if (!isRecord(value)) return null;
	const orderId = positiveInteger(value.order_id);
	if (orderId === null || !Array.isArray(value.products) || !validPrice(value.total_amount)) {
		return null;
	}

	const products: OrderItem[] = [];
	for (const item of value.products) {
		const normalized = normalizeOrderItem(item);
		if (normalized === null) return null;
		products.push(normalized);
	}

	const status = value.status === undefined || value.status === null ? null : value.status;
	if (status !== null && !isOrderStatusValue(status)) return null;
	if (!isPaymentStatusValue(value.payment_status)) return null;

	return {
		order_id: orderId,
		user_id:
			value.user_id === undefined || value.user_id === null ? null : positiveInteger(value.user_id),
		products,
		total_amount: value.total_amount,
		status,
		payment_status: value.payment_status,
		created_at: nullableString(value.created_at),
		updated_at: nullableString(value.updated_at)
	};
}

/** Converts the login/refresh response while keeping a missing token explicit. */
export function normalizeLoginResponse(value: unknown): LoginResponse | null {
	if (!isRecord(value)) return null;
	const token = typeof value.token === 'string' && value.token.length > 0 ? value.token : null;
	return { token, message: nullableString(value.message) };
}

/** Converts the payment response used by both signed and admin payment calls. */
export function normalizePayOrderResponse(value: unknown): PayOrderResponse | null {
	if (!isRecord(value)) return null;
	const orderId = positiveInteger(value.order_id);
	if (orderId === null || (value.payment_status !== 'paid' && value.payment_status !== 'failed')) {
		return null;
	}
	return {
		order_id: orderId,
		payment_status: value.payment_status,
		message: nullableString(value.message)
	};
}

/** Converts the guest creation response and requires its signed URL. */
export function normalizeCreateOrderResponse(value: unknown): CreateOrderResponse | null {
	if (!isRecord(value) || typeof value.order_url !== 'string' || value.order_url.length === 0) {
		return null;
	}
	const order = normalizeOrder(value.order);
	return order === null ? null : { order, order_url: value.order_url };
}
