import { z } from "zod";

import type {
  ExtendedFundingPoint,
  ExtendedMarketSnapshot,
  ExtendedTradingConfig,
  ExtendedUserFees,
} from "./types.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const numericLikeSchema = z.union([z.string(), z.number()]);

const marketRecordSchema = z.object({
  market: z.string().optional(),
  name: z.string().optional(),
  marketStats: z.object({
    markPrice: numericLikeSchema,
    indexPrice: numericLikeSchema,
    fundingRate: numericLikeSchema,
    nextFundingRate: numericLikeSchema.optional(),
    openInterest: numericLikeSchema.optional(),
    dailyVolume: numericLikeSchema.optional(),
  }),
  tradingConfig: z.object({
    minOrderSize: numericLikeSchema,
    minOrderSizeChange: numericLikeSchema,
    minPriceChange: numericLikeSchema,
    maxNumOrders: numericLikeSchema.optional(),
    limitPriceCap: numericLikeSchema.optional(),
    limitPriceFloor: numericLikeSchema.optional(),
    maxMarketOrderValue: numericLikeSchema.optional(),
    maxLimitOrderValue: numericLikeSchema.optional(),
    maxPositionValue: numericLikeSchema.optional(),
    maxLeverage: numericLikeSchema.optional(),
  }),
});

const userFeesSchema = z.object({
  market: z.string().optional(),
  name: z.string().optional(),
  makerFeeRate: numericLikeSchema,
  takerFeeRate: numericLikeSchema,
  builderFeeRate: numericLikeSchema.optional(),
});

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function toRequiredNumber(value: string | number, fieldName: string): number {
  const parsed = toNumber(value);
  if (parsed === undefined) {
    throw new Error(`Invalid numeric field: ${fieldName}`);
  }
  return parsed;
}

function buildUrl(baseUrl: string, apiPrefix: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPrefix = apiPrefix.startsWith("/") ? apiPrefix : `/${apiPrefix}`;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPrefix}${normalizedPath}`;
}

function safePayloadPreview(payload: unknown): string {
  try {
    if (payload === null || typeof payload !== "object") {
      return String(payload);
    }
    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 8);
    return JSON.stringify({ keys, type: "object" });
  } catch {
    return typeof payload;
  }
}

function extractArrayRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload !== null && typeof payload === "object") {
    const asRecord = payload as Record<string, unknown>;
    const candidateKeys = ["markets", "funding", "fundingRates", "data", "items", "result"];
    for (const key of candidateKeys) {
      if (Array.isArray(asRecord[key])) {
        return asRecord[key] as unknown[];
      }
    }
    console.debug(
      `[carry-agent] extractArrayRows returned [] for unexpected payload shape: ${safePayloadPreview(payload)}`,
    );
  }
  return [];
}

function normalizeTradingConfig(raw: z.infer<typeof marketRecordSchema>["tradingConfig"]): ExtendedTradingConfig {
  return {
    minOrderSize: toRequiredNumber(raw.minOrderSize, "tradingConfig.minOrderSize"),
    minOrderSizeChange: toRequiredNumber(raw.minOrderSizeChange, "tradingConfig.minOrderSizeChange"),
    minPriceChange: toRequiredNumber(raw.minPriceChange, "tradingConfig.minPriceChange"),
    maxNumOrders: toNumber(raw.maxNumOrders),
    limitPriceCap: toNumber(raw.limitPriceCap),
    limitPriceFloor: toNumber(raw.limitPriceFloor),
    maxMarketOrderValue: toNumber(raw.maxMarketOrderValue),
    maxLimitOrderValue: toNumber(raw.maxLimitOrderValue),
    maxPositionValue: toNumber(raw.maxPositionValue),
    maxLeverage: toNumber(raw.maxLeverage),
  };
}

function resolveMarketName(record: z.infer<typeof marketRecordSchema>): string {
  const market = record.market ?? record.name;
  if (market === undefined || market.length === 0) {
    throw new Error("Extended market payload missing market name.");
  }
  return market;
}

function mapFundingRow(row: unknown): ExtendedFundingPoint | null {
  if (row === null || typeof row !== "object") {
    return null;
  }

  const asRecord = row as Record<string, unknown>;
  const timestampCandidate = asRecord.timestamp ?? asRecord.time ?? asRecord.ts ?? asRecord.T;
  const rateCandidate = asRecord.fundingRate ?? asRecord.rate ?? asRecord.value ?? asRecord.f;

  const timestamp = toNumber(timestampCandidate as string | number | undefined);
  const fundingRate = toNumber(rateCandidate as string | number | undefined);

  if (timestamp === undefined || fundingRate === undefined) {
    return null;
  }

  return { timestamp, fundingRate };
}

export type ExtendedClient = {
  getMarketSnapshot: (market: string) => Promise<ExtendedMarketSnapshot>;
  getFundingHistory: (market: string, startTimeMs: number, endTimeMs: number) => Promise<ExtendedFundingPoint[]>;
  getUserFees: (market: string) => Promise<ExtendedUserFees>;
};

export function createExtendedClient(options: {
  baseUrl: string;
  apiPrefix?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}): ExtendedClient {
  const apiPrefix = options.apiPrefix ?? "/api/v1";
  const fetchImpl = options.fetchImpl ?? fetch;

  async function requestJson(path: string, init: { headers?: Record<string, string> } = {}): Promise<unknown> {
    const url = buildUrl(options.baseUrl, apiPrefix, path);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: init.headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Extended request failed (${response.status} ${response.statusText}) ${url}: ${body.slice(0, 160)}`);
    }

    return response.json();
  }

  return {
    async getMarketSnapshot(market: string): Promise<ExtendedMarketSnapshot> {
      const payload = await requestJson(`/info/markets?market=${encodeURIComponent(market)}`);
      const rows = extractArrayRows(payload).map((row) => marketRecordSchema.parse(row));
      const match = rows.find((row) => resolveMarketName(row) === market) ?? rows[0];
      if (match === undefined) {
        throw new Error(`Market not found in Extended response: ${market}`);
      }

      return {
        market: resolveMarketName(match),
        markPrice: toRequiredNumber(match.marketStats.markPrice, "marketStats.markPrice"),
        indexPrice: toRequiredNumber(match.marketStats.indexPrice, "marketStats.indexPrice"),
        fundingRate: toRequiredNumber(match.marketStats.fundingRate, "marketStats.fundingRate"),
        nextFundingRateTimestampMs: toNumber(match.marketStats.nextFundingRate),
        openInterestUsd: toNumber(match.marketStats.openInterest),
        dailyVolumeUsd: toNumber(match.marketStats.dailyVolume),
        tradingConfig: normalizeTradingConfig(match.tradingConfig),
      };
    },

    async getFundingHistory(market: string, startTimeMs: number, endTimeMs: number): Promise<ExtendedFundingPoint[]> {
      const payload = await requestJson(
        `/info/${encodeURIComponent(market)}/funding?startTime=${startTimeMs}&endTime=${endTimeMs}`,
      );

      return extractArrayRows(payload)
        .map(mapFundingRow)
        .filter((point): point is ExtendedFundingPoint => point !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
    },

    async getUserFees(market: string): Promise<ExtendedUserFees> {
      if (!options.apiKey) {
        throw new Error("EXTENDED_API_KEY is required for getUserFees");
      }

      const payload = await requestJson(`/user/fees?market=${encodeURIComponent(market)}`, {
        headers: { "X-Api-Key": options.apiKey },
      });

      let topRecord: unknown = payload;
      if (payload !== null && typeof payload === "object") {
        const wrapped = payload as Record<string, unknown>;
        if (Array.isArray(wrapped.data) && wrapped.data.length > 0) {
          topRecord = wrapped.data[0];
        }
      }

      const parsed = userFeesSchema.parse(topRecord);
      const parsedMarket = parsed.market ?? parsed.name;
      if (!parsedMarket) {
        throw new Error("Extended user fees payload missing market");
      }

      return {
        market: parsedMarket,
        makerFeeRate: toRequiredNumber(parsed.makerFeeRate, "makerFeeRate"),
        takerFeeRate: toRequiredNumber(parsed.takerFeeRate, "takerFeeRate"),
        builderFeeRate: toNumber(parsed.builderFeeRate),
      };
    },
  };
}
