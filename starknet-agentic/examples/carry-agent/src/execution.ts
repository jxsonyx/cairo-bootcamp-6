import { createHash } from "node:crypto";

import type {
  ExecutionIncident,
  ExecutionOutcome,
  ExecutionOrderResult,
  ExtendedMarketSnapshot,
} from "./types.js";
import type { PerpExecutionClient } from "./extendedPerp.js";

export type ExecuteEntryInput = {
  market: string;
  notionalUsd: number;
  maxUnhedgedNotionalUsd: number;
  leggingTimeoutMs: number;
  partialFillTimeoutMs: number;
  deadmanSwitchEnabled: boolean;
  deadmanSwitchSeconds: number;
  marketSnapshot: ExtendedMarketSnapshot;
};

export type ExecutionVenue = {
  armDeadmanSwitch: (seconds: number) => Promise<void>;
  cancelAllOpenOrders: () => Promise<void>;
  placeSpotBuy: (input: { market: string; notionalUsd: number }) => Promise<ExecutionOrderResult>;
  placePerpShort: (input: { market: string; notionalUsd: number }) => Promise<ExecutionOrderResult>;
  neutralizeSpot: (input: {
    market: string;
    notionalUsd: number;
    baseAmount?: number;
  }) => Promise<ExecutionOrderResult>;
  refreshPerpOrder?: (order: ExecutionOrderResult) => Promise<ExecutionOrderResult>;
};

export type MockExecutionScenario =
  | "success"
  | "second_leg_failure"
  | "second_leg_timeout"
  | "partial_fill";

export type ToolCaller = {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deterministicHash(seed: string): string {
  return `0x${createHash("sha256").update(seed).digest("hex")}`;
}

function extractTxHash(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const asRecord = payload as Record<string, unknown>;
  for (const key of ["transactionHash", "txHash", "hash"]) {
    const value = asRecord[key];
    if (typeof value === "string" && value.startsWith("0x")) {
      return value;
    }
  }
  return undefined;
}

function extractNumeric(payload: unknown, keys: string[]): number | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const asRecord = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = asRecord[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function toDecimalAmount(value: number, decimals = 6): string {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutMessage(message: string): boolean {
  return message.toLowerCase().includes("timed out");
}

function computeResidualUnhedged(
  spotOrder: ExecutionOrderResult,
  perpOrder: ExecutionOrderResult,
): number {
  return Math.max(0, spotOrder.filledNotionalUsd - perpOrder.filledNotionalUsd);
}

function computeResidualBaseAmount(
  spotOrder: ExecutionOrderResult,
  residualNotionalUsd: number,
): number | undefined {
  if (spotOrder.filledBaseAmount === undefined || spotOrder.filledNotionalUsd <= 0) {
    return undefined;
  }

  const ratio = residualNotionalUsd / spotOrder.filledNotionalUsd;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return undefined;
  }

  return spotOrder.filledBaseAmount * ratio;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function cancelOpenOrders(
  venue: ExecutionVenue,
  incidents: ExecutionIncident[],
): Promise<void> {
  try {
    await venue.cancelAllOpenOrders();
  } catch (error) {
    incidents.push({
      type: "second_leg_failed",
      message: `Failed to cancel open orders: ${asErrorMessage(error)}`,
    });
  }
}

async function settlePerpOrderAfterCancel(
  venue: ExecutionVenue,
  order: ExecutionOrderResult,
  incidents: ExecutionIncident[],
): Promise<ExecutionOrderResult> {
  await cancelOpenOrders(venue, incidents);
  if (!venue.refreshPerpOrder) {
    return order;
  }

  try {
    return await venue.refreshPerpOrder(order);
  } catch (error) {
    incidents.push({
      type: "second_leg_failed",
      message: `Failed to refresh perp order after cancel: ${asErrorMessage(error)}`,
    });
    return order;
  }
}

export class McpSpotExecutionVenue implements ExecutionVenue {
  private sequence = 0;

  constructor(
    private readonly toolCaller: ToolCaller,
    private readonly settings: {
      spotSellToken: string;
      spotBuyToken: string;
      slippage: number;
      markPrice: number;
    },
    private readonly perpExecutionClient?: PerpExecutionClient,
  ) {}

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(6, "0")}`;
  }

  private nextHash(seed: string): string {
    this.sequence += 1;
    return deterministicHash(`${seed}:${this.sequence}`);
  }

  async armDeadmanSwitch(seconds: number): Promise<void> {
    if (!this.perpExecutionClient) {
      return;
    }
    await this.perpExecutionClient.armDeadmanSwitch(seconds);
  }

  async cancelAllOpenOrders(): Promise<void> {
    if (!this.perpExecutionClient) {
      return;
    }
    await this.perpExecutionClient.cancelAllOpenOrders();
  }

  async placeSpotBuy(input: { market: string; notionalUsd: number }): Promise<ExecutionOrderResult> {
    const estimatedBaseAmount = input.notionalUsd / this.settings.markPrice;
    const response = await this.toolCaller.callTool("starknet_swap", {
      sellToken: this.settings.spotSellToken,
      buyToken: this.settings.spotBuyToken,
      amount: toDecimalAmount(input.notionalUsd, 6),
      slippage: this.settings.slippage,
    });

    return {
      orderId: this.nextId("mcp-spot"),
      filledNotionalUsd: input.notionalUsd,
      filledBaseAmount:
        extractNumeric(response, [
          "filledBaseAmount",
          "filledBuyAmount",
          "buyAmount",
          "amountOut",
          "outputAmount",
          "receivedAmount",
          "toAmount",
        ]) ?? estimatedBaseAmount,
      txHash: extractTxHash(response) ?? this.nextHash(`spot:${input.market}`),
    };
  }

  async placePerpShort(input: { market: string; notionalUsd: number }): Promise<ExecutionOrderResult> {
    if (this.perpExecutionClient) {
      return this.perpExecutionClient.placePerpShort({
        market: input.market,
        notionalUsd: input.notionalUsd,
        markPrice: this.settings.markPrice,
      });
    }

    return {
      orderId: this.nextId("perp-mock"),
      filledNotionalUsd: input.notionalUsd,
      txHash: this.nextHash(`perp-mock:${input.market}`),
    };
  }

  async neutralizeSpot(input: {
    market: string;
    notionalUsd: number;
    baseAmount?: number;
  }): Promise<ExecutionOrderResult> {
    const baseAmount = input.baseAmount ?? input.notionalUsd / this.settings.markPrice;
    const response = await this.toolCaller.callTool("starknet_swap", {
      sellToken: this.settings.spotBuyToken,
      buyToken: this.settings.spotSellToken,
      amount: toDecimalAmount(baseAmount, 8),
      slippage: this.settings.slippage,
    });

    return {
      orderId: this.nextId("mcp-neutralize"),
      filledNotionalUsd: input.notionalUsd,
      filledBaseAmount: baseAmount,
      txHash: extractTxHash(response) ?? this.nextHash(`neutralize:${input.market}`),
    };
  }
}

export class MockExecutionVenue implements ExecutionVenue {
  private sequence = 0;
  private latestPerpOrder: ExecutionOrderResult | null = null;

  constructor(
    private readonly scenario: MockExecutionScenario,
    private readonly secondLegDelayMs: number,
    private readonly secondLegFillRatio: number,
  ) {}

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(6, "0")}`;
  }

  private nextHash(seed: string): string {
    this.sequence += 1;
    return deterministicHash(`${seed}:${this.sequence}`);
  }

  async armDeadmanSwitch(_seconds: number): Promise<void> {
    return;
  }

  async cancelAllOpenOrders(): Promise<void> {
    return;
  }

  async placeSpotBuy(input: { market: string; notionalUsd: number }): Promise<ExecutionOrderResult> {
    await sleep(100);
    return {
      orderId: this.nextId("spot"),
      filledNotionalUsd: input.notionalUsd,
      txHash: this.nextHash(`spot:${input.market}`),
    };
  }

  async placePerpShort(input: { market: string; notionalUsd: number }): Promise<ExecutionOrderResult> {
    await sleep(this.secondLegDelayMs);

    if (this.scenario === "second_leg_failure") {
      throw new Error("Perp leg rejected by venue in mock scenario.");
    }

    if (this.scenario === "second_leg_timeout") {
      throw new Error("Perp leg timed out in mock scenario.");
    }

    if (this.scenario === "partial_fill") {
      const order = {
        orderId: this.nextId("perp"),
        filledNotionalUsd: input.notionalUsd * this.secondLegFillRatio,
        txHash: this.nextHash(`perp_partial:${input.market}`),
      };
      this.latestPerpOrder = order;
      return order;
    }

    const order = {
      orderId: this.nextId("perp"),
      filledNotionalUsd: input.notionalUsd,
      txHash: this.nextHash(`perp:${input.market}`),
    };
    this.latestPerpOrder = order;
    return order;
  }

  async refreshPerpOrder(order: ExecutionOrderResult): Promise<ExecutionOrderResult> {
    if (this.latestPerpOrder?.orderId === order.orderId) {
      return this.latestPerpOrder;
    }
    return order;
  }

  async neutralizeSpot(input: {
    market: string;
    notionalUsd: number;
    baseAmount?: number;
  }): Promise<ExecutionOrderResult> {
    await sleep(100);
    return {
      orderId: this.nextId("neutralize"),
      filledNotionalUsd: input.notionalUsd,
      filledBaseAmount: input.baseAmount,
      txHash: this.nextHash(`neutralize:${input.market}`),
    };
  }
}

function buildNeutralizedOutcome(input: {
  reasonCode: string;
  message: string;
  incidents: ExecutionIncident[];
  deadmanArmed: boolean;
  spotOrder: ExecutionOrderResult;
  perpOrder?: ExecutionOrderResult;
  neutralizationOrder: ExecutionOrderResult;
}): ExecutionOutcome {
  return {
    status: "neutralized",
    reasonCode: input.reasonCode,
    message: input.message,
    incidents: input.incidents,
    deadmanArmed: input.deadmanArmed,
    spotOrder: input.spotOrder,
    perpOrder: input.perpOrder,
    neutralizationOrder: input.neutralizationOrder,
  };
}

export async function executeHedgedEntry(
  venue: ExecutionVenue,
  input: ExecuteEntryInput,
): Promise<ExecutionOutcome> {
  const minNotionalUsd =
    input.marketSnapshot.markPrice * input.marketSnapshot.tradingConfig.minOrderSize;
  if (input.notionalUsd < minNotionalUsd) {
    return {
      status: "blocked",
      reasonCode: "BLOCK_BELOW_MIN_ORDER_SIZE",
      message: `Notional ${input.notionalUsd} is below estimated venue minimum ${minNotionalUsd.toFixed(4)}.`,
      incidents: [],
      deadmanArmed: false,
    };
  }

  let deadmanArmed = false;
  const incidents: ExecutionIncident[] = [];
  let spotOrder: ExecutionOrderResult | undefined;

  try {
    if (input.deadmanSwitchEnabled) {
      await venue.armDeadmanSwitch(input.deadmanSwitchSeconds);
      deadmanArmed = true;
    }

    spotOrder = await venue.placeSpotBuy({
      market: input.market,
      notionalUsd: input.notionalUsd,
    });

    if (spotOrder.filledNotionalUsd > input.maxUnhedgedNotionalUsd) {
      await cancelOpenOrders(venue, incidents);
      const neutralizationOrder = await venue.neutralizeSpot({
        market: input.market,
        notionalUsd: spotOrder.filledNotionalUsd,
        baseAmount: spotOrder.filledBaseAmount,
      });

      incidents.push({
        type: "unhedged_exceeds_cap",
        message: "Spot leg exceeded unhedged cap before hedge completion.",
      });

      return buildNeutralizedOutcome({
        reasonCode: "NEUTRALIZED_UNHEDGED_CAP",
        message: "Spot leg exceeded unhedged cap; position neutralized.",
        incidents,
        deadmanArmed,
        spotOrder,
        neutralizationOrder,
      });
    }

    const perpOrder = await withTimeout(
      venue.placePerpShort({ market: input.market, notionalUsd: input.notionalUsd }),
      input.leggingTimeoutMs,
      `Perp hedge leg timed out after ${input.leggingTimeoutMs}ms.`,
    );

    let residualUnhedged = computeResidualUnhedged(spotOrder, perpOrder);
    if (residualUnhedged > input.maxUnhedgedNotionalUsd) {
      const settledPerpOrder = await settlePerpOrderAfterCancel(venue, perpOrder, incidents);
      residualUnhedged = computeResidualUnhedged(spotOrder, settledPerpOrder);

      const neutralizationOrder = await venue.neutralizeSpot({
        market: input.market,
        notionalUsd: residualUnhedged,
        baseAmount: computeResidualBaseAmount(spotOrder, residualUnhedged),
      });

      incidents.push({
        type: "unhedged_exceeds_cap",
        message: "Residual unhedged exposure after partial fill exceeded cap.",
      });

      return buildNeutralizedOutcome({
        reasonCode: "NEUTRALIZED_PARTIAL_FILL_UNHEDGED",
        message: "Partial fill left excessive unhedged exposure; neutralized.",
        incidents,
        deadmanArmed,
        spotOrder,
        perpOrder: settledPerpOrder,
        neutralizationOrder,
      });
    }

    if (residualUnhedged > 0) {
      await sleep(input.partialFillTimeoutMs);
      const settledPerpOrder = await settlePerpOrderAfterCancel(venue, perpOrder, incidents);
      residualUnhedged = computeResidualUnhedged(spotOrder, settledPerpOrder);

      if (residualUnhedged <= 0) {
        return {
          status: "executed",
          reasonCode: "EXECUTED_HEDGED_ENTRY",
          message: "Spot and perp legs completed within safety bounds.",
          incidents,
          deadmanArmed,
          spotOrder,
          perpOrder: settledPerpOrder,
        };
      }

      const neutralizationOrder = await venue.neutralizeSpot({
        market: input.market,
        notionalUsd: residualUnhedged,
        baseAmount: computeResidualBaseAmount(spotOrder, residualUnhedged),
      });

      incidents.push({
        type: "partial_fill_timeout",
        message: "Residual unhedged exposure after partial fill did not heal in time.",
      });

      return buildNeutralizedOutcome({
        reasonCode: "NEUTRALIZED_PARTIAL_FILL_TIMEOUT",
        message: "Partial fill remained unhedged beyond timeout; neutralized residual exposure.",
        incidents,
        deadmanArmed,
        spotOrder,
        perpOrder: settledPerpOrder,
        neutralizationOrder,
      });
    }

    return {
      status: "executed",
      reasonCode: "EXECUTED_HEDGED_ENTRY",
      message: "Spot and perp legs completed within safety bounds.",
      incidents,
      deadmanArmed,
      spotOrder,
      perpOrder,
    };
  } catch (error) {
    const reason = asErrorMessage(error);
    const isTimeout = isTimeoutMessage(reason);

    incidents.push({
      type: isTimeout ? "legging_timeout" : "second_leg_failed",
      message: reason,
    });

    await cancelOpenOrders(venue, incidents);

    if (!spotOrder) {
      return {
        status: "blocked",
        reasonCode: isTimeout ? "BLOCK_PRE_HEDGE_TIMEOUT" : "BLOCK_PRE_HEDGE_FAILURE",
        message: "Execution failed before spot leg placement.",
        incidents,
        deadmanArmed,
      };
    }

    try {
      const neutralizationOrder = await venue.neutralizeSpot({
        market: input.market,
        notionalUsd: spotOrder.filledNotionalUsd,
        baseAmount: spotOrder.filledBaseAmount,
      });

      return buildNeutralizedOutcome({
        reasonCode: isTimeout ? "NEUTRALIZED_LEGGING_TIMEOUT" : "NEUTRALIZED_SECOND_LEG_FAILURE",
        message: "Second leg failed safety requirements; spot leg neutralized.",
        incidents,
        deadmanArmed,
        spotOrder,
        neutralizationOrder,
      });
    } catch (neutralizeError) {
      incidents.push({
        type: "second_leg_failed",
        message: `Failed to neutralize spot leg: ${asErrorMessage(neutralizeError)}`,
      });
      return {
        status: "blocked",
        reasonCode: "BLOCK_NEUTRALIZATION_FAILED",
        message: "Spot leg placed but neutralization failed.",
        incidents,
        deadmanArmed,
        spotOrder,
      };
    }
  }
}
