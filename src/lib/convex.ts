import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ApiError } from "./api/errors";
import { getEnv } from "./api/env";

export type BackendActor =
    | { kind: "session"; userId: string }
    | { kind: "api_key"; projectLegacyId?: number; apiKeyId?: string };

export interface SaleItemInput {
    productId: number;
    units: number;
    unitPrice: number;
    vatRate: number;
}

export interface PurchaseItemInput extends SaleItemInput {}

export interface BackendConfig {
    convexUrl: string;
    bridgeSecret: string;
}

type ConvexReference = unknown;

/**
 * Server-side gateway to Convex.
 *
 * The Astro app is deliberately the only caller of this class. The bridge
 * secret never reaches the browser; the actor is attached to every operation
 * so Convex can apply the same project boundary for UI sessions and API keys.
 */
export class BackendClient {
    private readonly client: ConvexHttpClient;

    constructor(
        private readonly config: BackendConfig,
        private readonly actor: BackendActor,
    ) {
        this.client = new ConvexHttpClient(config.convexUrl, { logger: false });
    }

    private args(values: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            bridgeSecret: this.config.bridgeSecret,
            actor: this.actor,
            ...values,
        };
    }

    private query<T>(reference: ConvexReference, values: Record<string, unknown>): Promise<T> {
        return this.client.query(reference as never, values as never) as Promise<T>;
    }

    private mutation<T>(reference: ConvexReference, values: Record<string, unknown>): Promise<T> {
        return this.client.mutation(reference as never, values as never) as Promise<T>;
    }

    listProjects(): Promise<Array<{ id: number; nombre: string; activo: boolean }>> {
        return this.query(api.domain.listProjects, this.args());
    }

    listProducts(values: {
        projectId: number;
        page?: number;
        pageSize?: number;
        search?: string;
    }): Promise<{ data: Array<Record<string, unknown>>; count: number }> {
        return this.query(
            api.domain.listProducts,
            this.args({
                projectLegacyId: values.projectId,
                page: values.page ?? 1,
                pageSize: values.pageSize ?? 100,
                ...(values.search ? { search: values.search } : {}),
            }),
        );
    }

    createProduct(projectId: number, name: string) {
        return this.mutation<{ id: number; proyecto_id: number; nombre: string }>(
            api.domain.createProduct,
            this.args({ projectLegacyId: projectId, name }),
        );
    }

    getProduct(projectId: number, productId: number) {
        return this.query<{ id: number; proyecto_id: number; nombre: string }>(
            api.domain.getProduct,
            this.args({ projectLegacyId: projectId, productLegacyId: productId }),
        );
    }

    getProductGlobal(productId: number) {
        return this.query<{ id: number; proyecto_id: number; nombre: string } | null>(
            api.domain.getProductGlobal,
            this.args({ productLegacyId: productId }),
        );
    }

    listSales(values: {
        projectId: number;
        page?: number;
        pageSize?: number;
        fromDate?: string;
        toDate?: string;
        status?: string;
        channel?: string;
    }): Promise<{ data: Array<Record<string, unknown>>; count: number }> {
        return this.query(
            api.domain.listSales,
            this.args({
                projectLegacyId: values.projectId,
                page: values.page ?? 1,
                pageSize: values.pageSize ?? 20,
                ...(values.fromDate ? { fromDate: values.fromDate } : {}),
                ...(values.toDate ? { toDate: values.toDate } : {}),
                ...(values.status ? { status: values.status } : {}),
                ...(values.channel ? { channel: values.channel } : {}),
            }),
        );
    }

    getSale(id: number): Promise<Record<string, unknown> | null> {
        return this.query(api.domain.getSale, this.args({ legacyId: id }));
    }

    createSale(values: {
        projectId: number;
        date: string;
        channel: string;
        status: string;
        items: SaleItemInput[];
    }): Promise<number> {
        return this.mutation(
            api.domain.createSale,
            this.args({
                projectLegacyId: values.projectId,
                date: values.date,
                channel: values.channel,
                status: values.status,
                items: values.items,
            }),
        );
    }

    updateSale(
        id: number,
        values: {
            date?: string;
            channel?: string;
            status?: string;
            items?: SaleItemInput[];
        },
    ): Promise<number> {
        return this.mutation(
            api.domain.updateSale,
            this.args({ legacyId: id, ...values }),
        );
    }

    deleteSale(id: number): Promise<boolean> {
        return this.mutation(api.domain.deleteSale, this.args({ legacyId: id }));
    }

    listPurchases(values: {
        projectId: number;
        page?: number;
        pageSize?: number;
        fromDate?: string;
        toDate?: string;
        status?: string;
    }): Promise<{ data: Array<Record<string, unknown>>; count: number }> {
        return this.query(
            api.domain.listPurchases,
            this.args({
                projectLegacyId: values.projectId,
                page: values.page ?? 1,
                pageSize: values.pageSize ?? 20,
                ...(values.fromDate ? { fromDate: values.fromDate } : {}),
                ...(values.toDate ? { toDate: values.toDate } : {}),
                ...(values.status ? { status: values.status } : {}),
            }),
        );
    }

    getPurchase(id: number): Promise<Record<string, unknown> | null> {
        return this.query(api.domain.getPurchase, this.args({ legacyId: id }));
    }

    createPurchase(values: {
        projectId: number;
        date: string;
        status: string;
        items: PurchaseItemInput[];
    }): Promise<number> {
        return this.mutation(
            api.domain.createPurchase,
            this.args({
                projectLegacyId: values.projectId,
                date: values.date,
                status: values.status,
                items: values.items,
            }),
        );
    }

    updatePurchase(
        id: number,
        values: { date?: string; status?: string; items?: PurchaseItemInput[] },
    ): Promise<number> {
        return this.mutation(
            api.domain.updatePurchase,
            this.args({ legacyId: id, ...values }),
        );
    }

    deletePurchase(id: number): Promise<boolean> {
        return this.mutation(api.domain.deletePurchase, this.args({ legacyId: id }));
    }

    listTransactions(values: {
        projectId: number;
        page?: number;
        pageSize?: number;
        fromDate?: string;
        toDate?: string;
        type?: string;
    }): Promise<{ data: Array<Record<string, unknown>>; count: number }> {
        return this.query(
            api.domain.listOtherTransactions,
            this.args({
                projectLegacyId: values.projectId,
                page: values.page ?? 1,
                pageSize: values.pageSize ?? 20,
                ...(values.fromDate ? { fromDate: values.fromDate } : {}),
                ...(values.toDate ? { toDate: values.toDate } : {}),
                ...(values.type ? { type: values.type } : {}),
            }),
        );
    }

    getTransaction(id: number): Promise<Record<string, unknown> | null> {
        return this.query(api.domain.getOtherTransaction, this.args({ legacyId: id }));
    }

    createTransaction(values: {
        projectId: number;
        type: string;
        concept: string;
        description?: string;
        amount: number;
        vatRate: number;
        date: string;
    }): Promise<number> {
        return this.mutation(
            api.domain.createOtherTransaction,
            this.args({
                projectLegacyId: values.projectId,
                type: values.type,
                concept: values.concept,
                ...(values.description !== undefined ? { description: values.description } : {}),
                amount: values.amount,
                vatRate: values.vatRate,
                date: values.date,
            }),
        );
    }

    updateTransaction(
        id: number,
        values: {
            type?: string;
            concept?: string;
            description?: string;
            amount?: number;
            vatRate?: number;
            date?: string;
        },
    ): Promise<number> {
        return this.mutation(
            api.domain.updateOtherTransaction,
            this.args({ legacyId: id, ...values }),
        );
    }

    deleteTransaction(id: number): Promise<boolean> {
        return this.mutation(api.domain.deleteOtherTransaction, this.args({ legacyId: id }));
    }

    listStock(values: {
        projectId: number;
        page?: number;
        pageSize?: number;
        maxDays?: number;
        maxUnits?: number;
    }): Promise<{ data: Array<Record<string, unknown>>; count: number }> {
        return this.query(
            api.domain.listStock,
            this.args({
                projectLegacyId: values.projectId,
                page: values.page ?? 1,
                pageSize: values.pageSize ?? 20,
                ...(values.maxDays !== undefined ? { maxDays: values.maxDays } : {}),
                ...(values.maxUnits !== undefined ? { maxUnits: values.maxUnits } : {}),
            }),
        );
    }

    getStockForProduct(projectId: number, productId: number) {
        return this.query<Record<string, unknown> | null>(
            api.domain.getStockForProduct,
            this.args({ projectLegacyId: projectId, productLegacyId: productId }),
        );
    }

    listStockMovements(projectId: number, productId: number) {
        return this.query<Array<Record<string, unknown>>>(
            api.domain.listStockMovements,
            this.args({ projectLegacyId: projectId, productLegacyId: productId }),
        );
    }

    adjustStock(values: {
        projectId: number;
        productId: number;
        units: number;
        date: string;
    }): Promise<{
        id: number;
        producto_id: number;
        unidades: number;
        tipo_movimiento: "ajuste manual";
        fecha: string;
    }> {
        return this.mutation(
            api.domain.adjustStock,
            this.args({
                projectLegacyId: values.projectId,
                productLegacyId: values.productId,
                units: values.units,
                date: values.date,
            }),
        );
    }

    listDailyFinances(values: {
        projectId: number;
        fromDate?: string;
        toDate?: string;
    }): Promise<Array<Record<string, unknown>>> {
        return this.query(
            api.domain.listDailyFinances,
            this.args({
                projectLegacyId: values.projectId,
                ...(values.fromDate ? { fromDate: values.fromDate } : {}),
                ...(values.toDate ? { toDate: values.toDate } : {}),
            }),
        );
    }

    financeEvolution(projectId: number, fromDate: string) {
        return this.query<Array<Record<string, unknown>>>(
            api.domain.financeEvolution,
            this.args({ projectLegacyId: projectId, fromDate }),
        );
    }

    salesInitData(projectId?: number) {
        return this.query<{
            products: Array<Record<string, unknown>>;
            channels: string[];
        }>(
            api.domain.salesInitData,
            this.args(projectId !== undefined ? { projectLegacyId: projectId } : {}),
        );
    }

    transactionSources(values: { projectId: number; fromDate?: string; toDate?: string }) {
        return this.query<{
            sales: Array<Record<string, unknown>>;
            purchases: Array<Record<string, unknown>>;
            others: Array<Record<string, unknown>>;
        }>(
            api.domain.transactionSources,
            this.args({
                projectLegacyId: values.projectId,
                ...(values.fromDate ? { fromDate: values.fromDate } : {}),
                ...(values.toDate ? { toDate: values.toDate } : {}),
            }),
        );
    }

    apiKeyByHash(keyHash: string) {
        return this.query<{
            id: string;
            proyecto_id: number | null;
            scopes: Array<"read" | "write">;
            activa: boolean;
            expira_en: string | null;
            ultimo_uso_en: string | null;
        } | null>(api.domain.apiKeyByHash, {
            bridgeSecret: this.config.bridgeSecret,
            keyHash,
        });
    }

    touchApiKey(keyId: string, lastUsedAt: string) {
        return this.mutation(api.domain.touchApiKey, {
            bridgeSecret: this.config.bridgeSecret,
            keyId,
            lastUsedAt,
        });
    }

    createApiKey(values: {
        name: string;
        projectId?: number;
        keyHash: string;
        keyPrefix: string;
        scopes: Array<"read" | "write">;
        expiresAt?: string;
    }) {
        return this.mutation(api.domain.createApiKey, {
            bridgeSecret: this.config.bridgeSecret,
            name: values.name,
            ...(values.projectId !== undefined ? { projectLegacyId: values.projectId } : {}),
            keyHash: values.keyHash,
            keyPrefix: values.keyPrefix,
            scopes: values.scopes,
            ...(values.expiresAt ? { expiresAt: values.expiresAt } : {}),
        });
    }

    reserveIdempotency(key: string, endpoint: string, requestHash: string) {
        return this.mutation<
            | { status: "reserved" }
            | { status: "mismatch" }
            | { status: "in_flight" }
            | { status: "replay"; responseStatus: number; responseBody: unknown }
        >(api.domain.reserveIdempotency, this.args({ key, endpoint, requestHash }));
    }

    completeIdempotency(
        key: string,
        endpoint: string,
        responseStatus: number,
        responseBody: unknown,
    ) {
        return this.mutation(
            api.domain.completeIdempotency,
            this.args({ key, endpoint, responseStatus, responseBody }),
        );
    }

    releaseIdempotency(key: string, endpoint: string) {
        return this.mutation(api.domain.releaseIdempotency, this.args({ key, endpoint }));
    }
}

export function convexConfig(locals?: App.Locals): BackendConfig {
    // `convex dev` may keep a local URL in CONVEX_URL. The Astro app uses the
    // migrated production dataset unless an explicit app URL is provided.
    const convexUrl = getEnv(
        locals,
        "CONVEX_APP_URL",
        "CONVEX_PRODUCTION_URL",
        "CONVEX_URL",
        "PUBLIC_CONVEX_URL",
    );
    const bridgeSecret = getEnv(locals, "CONVEX_BRIDGE_SECRET");

    if (!convexUrl || !bridgeSecret) {
        throw new ApiError(
            "not_configured",
            "Convex no esta configurado en este despliegue.",
            {
                hint: "Define CONVEX_URL y CONVEX_BRIDGE_SECRET como variables del servidor.",
            },
        );
    }

    return { convexUrl, bridgeSecret };
}

export function createBackend(locals: App.Locals | undefined, actor: BackendActor): BackendClient {
    return new BackendClient(convexConfig(locals), actor);
}
