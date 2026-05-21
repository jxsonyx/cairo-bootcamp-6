import type { CarryCostEstimate, CarryCostInput, CarryDecision } from "./types.js";

export function estimateCarryEdge(input: CarryCostInput): CarryCostEstimate {
  if (!Number.isFinite(input.notionalUsd) || input.notionalUsd <= 0) {
    throw new Error("notionalUsd must be a positive finite number");
  }

  const feeRateTotal =
    input.spotEntryFeeRate +
    input.spotExitFeeRate +
    input.perpEntryFeeRate +
    input.perpExitFeeRate;

  const expectedFundingIncomeUsd =
    input.notionalUsd * input.expectedFundingRateHourly * input.holdHours;
  const feeCostUsd = input.notionalUsd * feeRateTotal;
  const slippageCostUsd = input.notionalUsd * (input.expectedSlippageBps / 10_000);
  const driftReserveUsd = input.notionalUsd * (input.driftReserveBps / 10_000);
  const gasCostUsd = input.gasCostUsdTotal;
  const totalCostUsd = feeCostUsd + slippageCostUsd + driftReserveUsd + gasCostUsd;
  const netEdgeUsd = expectedFundingIncomeUsd - totalCostUsd;

  return {
    expectedFundingIncomeUsd,
    feeCostUsd,
    slippageCostUsd,
    driftReserveUsd,
    gasCostUsd,
    totalCostUsd,
    netEdgeUsd,
    netEdgeBps: (netEdgeUsd / input.notionalUsd) * 10_000,
  };
}

export function fundingRegime(
  fundingHistoryHourly: number[],
  minFundingAverageHourly: number,
  minFundingPositiveShare: number,
): { averageFundingRateHourly: number; positiveShare: number; isStrong: boolean } {
  if (fundingHistoryHourly.length === 0) {
    return {
      averageFundingRateHourly: 0,
      positiveShare: 0,
      isStrong: false,
    };
  }

  const sum = fundingHistoryHourly.reduce((acc, value) => acc + value, 0);
  const averageFundingRateHourly = sum / fundingHistoryHourly.length;
  const positiveCount = fundingHistoryHourly.filter((x) => x > 0).length;
  const positiveShare = positiveCount / fundingHistoryHourly.length;

  const isStrong =
    averageFundingRateHourly >= minFundingAverageHourly &&
    positiveShare >= minFundingPositiveShare;

  return {
    averageFundingRateHourly,
    positiveShare,
    isStrong,
  };
}

export function evaluateCarryDecision(input: {
  market: string;
  hasOpenPosition: boolean;
  venueHealthy: boolean;
  spotQuoteAgeMs: number;
  perpSnapshotAgeMs: number;
  feesAgeMs: number;
  maxDataAgeMs: number;
  fundingHistoryHourly: number[];
  minFundingAverageHourly: number;
  minFundingPositiveShare: number;
  enterMinNetEdgeUsd: number;
  enterMinNetEdgeBps: number;
  holdMinNetEdgeUsd: number;
  edge: CarryCostEstimate;
}): CarryDecision {
  const regime = fundingRegime(
    input.fundingHistoryHourly,
    input.minFundingAverageHourly,
    input.minFundingPositiveShare,
  );

  if (!input.venueHealthy) {
    return {
      action: "PAUSE",
      reasonCode: "PAUSE_VENUE_UNHEALTHY",
      reason: "Venue is unhealthy.",
      regime,
      edge: input.edge,
    };
  }

  const maxAgeSeen = Math.max(input.spotQuoteAgeMs, input.perpSnapshotAgeMs, input.feesAgeMs);
  if (maxAgeSeen > input.maxDataAgeMs) {
    return {
      action: "PAUSE",
      reasonCode: "PAUSE_STALE_DATA",
      reason: "One or more inputs are stale.",
      regime,
      edge: input.edge,
    };
  }

  if (!input.hasOpenPosition) {
    if (!regime.isStrong) {
      return {
        action: "HOLD",
        reasonCode: "HOLD_REGIME_WEAK",
        reason: "Funding regime not strong enough to open a new position.",
        regime,
        edge: input.edge,
      };
    }

    if (
      input.edge.netEdgeUsd < input.enterMinNetEdgeUsd ||
      input.edge.netEdgeBps < input.enterMinNetEdgeBps
    ) {
      return {
        action: "HOLD",
        reasonCode: "HOLD_EDGE_TOO_LOW",
        reason: "Expected carry edge is below entry thresholds.",
        regime,
        edge: input.edge,
      };
    }

    return {
      action: "ENTER",
      reasonCode: "ENTER_EDGE_POSITIVE",
      reason: "Funding regime and net edge satisfy entry requirements.",
      regime,
      edge: input.edge,
    };
  }

  if (!regime.isStrong) {
    return {
      action: "EXIT",
      reasonCode: "EXIT_REGIME_WEAK",
      reason: "Funding regime deteriorated while position is open.",
      regime,
      edge: input.edge,
    };
  }

  if (input.edge.netEdgeUsd < input.holdMinNetEdgeUsd) {
    return {
      action: "EXIT",
      reasonCode: "EXIT_EDGE_NEGATIVE",
      reason: "Net edge fell below hold threshold.",
      regime,
      edge: input.edge,
    };
  }

  return {
    action: "HOLD",
    reasonCode: "HOLD_POSITION_OK",
    reason: "Position remains healthy under current funding and costs.",
    regime,
    edge: input.edge,
  };
}
