import { apiRequest } from './client';
import { ApiError } from './errors';
import type { paths } from './generated';
import type {
	Category,
	CreateOrderResponse,
	LoginResponse,
	Order,
	OrderCreateRequest,
	OrderStatus,
	PayOrderResponse,
	Product,
	User
} from './types';
import {
	normalizeCategory,
	normalizeCreateOrderResponse,
	normalizeLoginResponse,
	normalizeOrder,
	normalizePayOrderResponse,
	normalizeProduct,
	normalizeUser
} from './types';

/**
 * Typed endpoint layer — the only module allowed to use the API client.
 * Every call declares its auth policy explicitly:
 * - Guest order creation and signed receipt GET/pay FORCE `auth: "none"`,
 *   so they never send Authorization even when a stale or valid admin token
 *   exists (guest receipt links must stay usable without a session).
 * - Admin/user/QR calls require Bearer auth.
 * Routes and stores never call `fetch` directly; they use these functions.
 */

const INVALID_RESPONSE = 'Unexpected response format.';

type Operation<Path extends keyof paths, Method extends keyof paths[Path]> = NonNullable<
	paths[Path][Method]
>;

type JsonResponse<OperationType, Status extends number> = OperationType extends {
	responses: infer Responses;
}
	? Status extends keyof Responses
		? Responses[Status] extends { content: infer Content }
			? 'application/json' extends keyof Content
				? Content['application/json']
				: never
			: never
		: never
	: never;

type RequestBody<OperationType> = OperationType extends {
	requestBody?: { content: { 'application/json': infer Body } };
}
	? Body
	: never;

type MultipartRequestBody<OperationType> = OperationType extends {
	requestBody?: { content: { 'multipart/form-data': infer Body } };
}
	? Body
	: never;

type PathParameters<OperationType> = OperationType extends {
	parameters: { path: infer Path };
}
	? Path
	: never;

type QueryParameters<OperationType> = OperationType extends {
	parameters: { query?: infer Query };
}
	? Query extends object
		? Query
		: never
	: never;

type ProductListWire = JsonResponse<Operation<'/products', 'get'>, 200>;
type ProductWire = JsonResponse<Operation<'/products/{id}', 'get'>, 200>;
type CategoryListWire = JsonResponse<Operation<'/categories', 'get'>, 200>;
type CategoryProductListWire = JsonResponse<
	Operation<'/categories/{category_name}/products', 'get'>,
	200
>;
type CreateOrderWire = JsonResponse<Operation<'/orders', 'post'>, 201>;
type OrderWire = JsonResponse<Operation<'/orders/{id}', 'get'>, 200>;
type OrderListWire = JsonResponse<Operation<'/orders', 'get'>, 200>;
type PayOrderWire = JsonResponse<Operation<'/orders/{id}/pay', 'post'>, 200>;
type LoginWire = JsonResponse<Operation<'/auth/login', 'post'>, 200>;
type RefreshWire = JsonResponse<Operation<'/auth/refresh', 'get'>, 200>;
type UserWire = JsonResponse<Operation<'/users/{id}', 'get'>, 200>;
type OrdersQuery = QueryParameters<Operation<'/orders', 'get'>>;
type LoginRequestBody = RequestBody<Operation<'/auth/login', 'post'>>;
type CreateOrderRequestBody = RequestBody<Operation<'/orders', 'post'>>;
type UpdateOrderRequestBody = RequestBody<Operation<'/orders/{id}', 'post'>>;
type CreateProductRequestBody = RequestBody<Operation<'/products', 'post'>>;
type ProductImageRequestBody = MultipartRequestBody<Operation<'/products/{id}/image', 'post'>>;
type ProductImagePath = PathParameters<Operation<'/products/{id}/image', 'post'>>;

export type CreateProductInput = Pick<CreateProductRequestBody, 'name' | 'price'> &
	Partial<Pick<CreateProductRequestBody, 'description' | 'categories'>>;

type ListItem<Wire> = Wire extends readonly (infer Item)[] ? Item : never;
/** Pairs each unknown runtime payload with its generated success-body type. */
type WireNormalizer<Wire, T> = {
	(value: Wire): T | null;
	(value: unknown): T | null;
};

function invalidResponse(): never {
	throw new ApiError(502, INVALID_RESPONSE);
}

function expectValue<Wire, T>(value: unknown, normalize: WireNormalizer<Wire, T>): T {
	const normalized = normalize(value);
	return normalized === null ? invalidResponse() : normalized;
}

function expectList<Wire, T>(value: unknown, normalize: WireNormalizer<Wire, T>): T[] {
	if (!Array.isArray(value)) return invalidResponse();
	const normalized: T[] = [];
	for (const item of value) normalized.push(expectValue<Wire, T>(item, normalize));
	return normalized;
}

function expectText(value: unknown): string {
	return typeof value === 'string' ? value : value === undefined ? '' : invalidResponse();
}

function expectBlob(value: unknown): Blob {
	return typeof Blob !== 'undefined' && value instanceof Blob ? value : invalidResponse();
}

export async function listProducts(): Promise<Product[]> {
	return expectList<ListItem<ProductListWire>, Product>(
		await apiRequest('/products', { auth: 'none' }),
		normalizeProduct
	);
}

export async function getProduct(productId: number): Promise<Product> {
	return expectValue<ProductWire, Product>(
		await apiRequest(`/products/${productId}`, { auth: 'none' }),
		normalizeProduct
	);
}

export async function createProduct(product: CreateProductInput): Promise<void> {
	const body: CreateProductRequestBody = product;
	await apiRequest('/products', {
		method: 'POST',
		body,
		auth: 'required'
	});
}

export async function uploadProductImage(
	productId: ProductImagePath['id'],
	file: Blob
): Promise<void> {
	const formData = new FormData();
	const fieldName: keyof ProductImageRequestBody = 'file';
	formData.append(fieldName, file);
	await apiRequest(`/products/${productId}/image`, {
		method: 'POST',
		body: formData,
		auth: 'required'
	});
}

export async function deleteProductImage(productId: ProductImagePath['id']): Promise<void> {
	await apiRequest(`/products/${productId}/image`, {
		method: 'DELETE',
		auth: 'required'
	});
}

export async function listCategories(): Promise<Category[]> {
	return expectList<ListItem<CategoryListWire>, Category>(
		await apiRequest('/categories', { auth: 'none' }),
		normalizeCategory
	);
}

export async function listCategoryProducts(categoryName: string): Promise<Product[]> {
	return expectList<ListItem<CategoryProductListWire>, Product>(
		await apiRequest(`/categories/${encodeURIComponent(categoryName)}/products`, { auth: 'none' }),
		normalizeProduct
	);
}

export async function createGuestOrder(
	products: CreateOrderRequestBody['products'] & OrderCreateRequest['products']
): Promise<CreateOrderResponse> {
	return expectValue<CreateOrderWire, CreateOrderResponse>(
		await apiRequest('/orders', {
			method: 'POST',
			body: { products },
			auth: 'none'
		}),
		normalizeCreateOrderResponse
	);
}

export async function getSignedOrder(orderId: number, exp: string, sig: string): Promise<Order> {
	return expectValue<OrderWire, Order>(
		await apiRequest(`/orders/${orderId}`, { query: { exp, sig }, auth: 'none' }),
		normalizeOrder
	);
}

export async function paySignedOrder(
	orderId: number,
	exp: string,
	sig: string
): Promise<PayOrderResponse> {
	return expectValue<PayOrderWire, PayOrderResponse>(
		await apiRequest(`/orders/${orderId}/pay`, {
			method: 'POST',
			query: { exp, sig },
			auth: 'none'
		}),
		normalizePayOrderResponse
	);
}

export async function login(
	username: LoginRequestBody['username'],
	password: LoginRequestBody['password']
): Promise<LoginResponse> {
	return expectValue<LoginWire, LoginResponse>(
		await apiRequest('/auth/login', {
			method: 'POST',
			body: { username, password },
			auth: 'none'
		}),
		normalizeLoginResponse
	);
}

export async function refreshToken(): Promise<LoginResponse> {
	return expectValue<RefreshWire, LoginResponse>(
		await apiRequest('/auth/refresh', { auth: 'required' }),
		normalizeLoginResponse
	);
}

export async function getUser(userId: number): Promise<User> {
	return expectValue<UserWire, User>(
		await apiRequest(`/users/${userId}`, { auth: 'required' }),
		normalizeUser
	);
}

export async function listOrders(status?: OrdersQuery['status']): Promise<Order[]> {
	return expectList<ListItem<OrderListWire>, Order>(
		await apiRequest('/orders', {
			query: status ? { status } : undefined,
			auth: 'required'
		}),
		normalizeOrder
	);
}

export async function updateOrderStatus(orderId: number, status: OrderStatus): Promise<string> {
	const body: UpdateOrderRequestBody = { status };
	return expectText(
		await apiRequest(`/orders/${orderId}`, {
			method: 'POST',
			body,
			as: 'text',
			auth: 'required'
		})
	);
}

export async function payOrder(orderId: number): Promise<PayOrderResponse> {
	return expectValue<PayOrderWire, PayOrderResponse>(
		await apiRequest(`/orders/${orderId}/pay`, {
			method: 'POST',
			auth: 'required'
		}),
		normalizePayOrderResponse
	);
}

export async function cancelOrder(orderId: number): Promise<string> {
	return expectText(
		await apiRequest(`/orders/${orderId}/cancel`, {
			method: 'POST',
			as: 'text',
			auth: 'required'
		})
	);
}

export async function deleteOrder(orderId: number): Promise<string> {
	return expectText(
		await apiRequest(`/orders/${orderId}`, {
			method: 'DELETE',
			as: 'text',
			auth: 'required'
		})
	);
}

export async function getOrderingQr(): Promise<Blob> {
	return expectBlob(await apiRequest('/qr/ordering', { as: 'blob', auth: 'required' }));
}
