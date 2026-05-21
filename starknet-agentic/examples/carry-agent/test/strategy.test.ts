import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateCarryEdge, evaluateCarryDecision, fundingRegime } from "../src/strategy.js";

describe("carry strategy", () => {
  it("throws on invalid notional in edge estimation", () => {
    assert.throws(
      () =>
        estimateCarryEdge({
          notionalUsd: 0,
          holdHours: 8,
          expectedFundingRateHourly: 0.0008,
          spotEntryFeeRate: 0.0001,
          spotExitFeeRate: 0.0001,
          perpEntryFeeRate: 0.00025,
          perpExitFeeRate: 0.00025,
          expectedSlippageBps: 4,
          driftReserveBps: 4,
          gasCostUsdTotal: 0.5,
        }),
      /notionalUsd must be a positive finite number/,
    );
  });

  it("computes positive edge when funding dominates cost", () => {
    const edge = estimateCarryEdge({
      notionalUsd: 1000,
      holdHours: 8,
      expectedFundingRateHourly: 0.0008,
      spotEntryFeeRate: 0.0001,
      spotExitFeeRate: 0.0001,
      perpEntryFeeRate: 0.00025,
      perpExitFeeRate: 0.00025,
      expectedSlippageBps: 4,
      driftReserveBps: 4,
      gasCostUsdTotal: 0.5,
    });

    assert.ok(edge.netEdgeUsd > 0);
    assert.ok(edge.netEdgeBps > 0);
  });

  it("returns ENTER on strong regime and positive edge", () => {
    const edge = estimateCarryEdge({
      notionalUsd: 1000,
      holdHours: 8,
      expectedFundingRateHourly: 0.0008,
      spotEntryFeeRate: 0.0001,
      spotExitFeeRate: 0.0001,
      perpEntryFeeRate: 0.00025,
      perpExitFeeRate: 0.00025,
      expectedSlippageBps: 4,
      driftReserveBps: 4,
      gasCostUsdTotal: 0.5,
    });

    const decision = evaluateCarryDecision({
      market: "ETH-USD",
      hasOpenPosition: false,
      venueHealthy: true,
      spotQuoteAgeMs: 100,
      perpSnapshotAgeMs: 100,
      feesAgeMs: 100,
      maxDataAgeMs: 3000,
      fundingHistoryHourly: [0.0007, 0.0008, 0.00075, 0.00078, 0.00081],
      minFundingAverageHourly: 0.0002,
      minFundingPositiveShare: 0.6,
      enterMinNetEdgeUsd: 0.1,
      enterMinNetEdgeBps: 1,
      holdMinNetEdgeUsd: 0,
      edge,
    });

    assert.equal(decision.action, "ENTER");
    assert.equal(decision.reasonCode, "ENTER_EDGE_POSITIVE");
  });

  it("returns PAUSE on stale data", () => {
    const edge = estimateCarryEdge({
      notionalUsd: 1000,
      holdHours: 8,
      expectedFundingRateHourly: 0.0008,
      spotEntryFeeRate: 0.0001,
      spotExitFeeRate: 0.0001,
      perpEntryFeeRate: 0.00025,
      perpExitFeeRate: 0.00025,
      expectedSlippageBps: 4,
      driftReserveBps: 4,
      gasCostUsdTotal: 0.5,
    });

    const decision = evaluateCarryDecision({
      market: "ETH-USD",
      hasOpenPosition: false,
      venueHealthy: true,
      spotQuoteAgeMs: 10_000,
      perpSnapshotAgeMs: 100,
      feesAgeMs: 100,
      maxDataAgeMs: 3000,
      fundingHistoryHourly: [0.0007, 0.0008, 0.00075],
      minFundingAverageHourly: 0.0002,
      minFundingPositiveShare: 0.6,
      enterMinNetEdgeUsd: 0.1,
      enterMinNetEdgeBps: 1,
      holdMinNetEdgeUsd: 0,
      edge,
    });

    assert.equal(decision.action, "PAUSE");
    assert.equal(decision.reasonCode, "PAUSE_STALE_DATA");
  });

  it("returns EXIT when regime weakens with open position", () => {
    const edge = estimateCarryEdge({
      notionalUsd: 1000,
      holdHours: 8,
      expectedFundingRateHourly: 0.0008,
      spotEntryFeeRate: 0.0001,
      spotExitFeeRate: 0.0001,
      perpEntryFeeRate: 0.00025,
      perpExitFeeRate: 0.00025,
      expectedSlippageBps: 4,
      driftReserveBps: 4,
      gasCostUsdTotal: 0.5,
    });

    const decision = evaluateCarryDecision({
      market: "ETH-USD",
      hasOpenPosition: true,
      venueHealthy: true,
      spotQuoteAgeMs: 100,
      perpSnapshotAgeMs: 100,
      feesAgeMs: 100,
      maxDataAgeMs: 3000,
      fundingHistoryHourly: [0.0001, -0.0001, 0.00005],
      minFundingAverageHourly: 0.0002,
      minFundingPositiveShare: 0.8,
      enterMinNetEdgeUsd: 0.1,
      enterMinNetEdgeBps: 1,
      holdMinNetEdgeUsd: 0,
      edge,
    });

    assert.equal(decision.action, "EXIT");
    assert.equal(decision.reasonCode, "EXIT_REGIME_WEAK");
  });

  it("returns EXIT when edge turns negative with open position", () => {
    const edge = estimateCarryEdge({
      notionalUsd: 1000,
      holdHours: 8,
      expectedFundingRateHourly: 0.00001,
      spotEntryFeeRate: 0.0008,
      spotExitFeeRate: 0.0008,
      perpEntryFeeRate: 0.0008,
      perpExitFeeRate: 0.0008,
      expectedSlippageBps: 10,
      driftReserveBps: 10,
      gasCostUsdTotal: 5,
    });

    const decision = evaluateCarryDecision({
      market: "ETH-USD",
      hasOpenPosition: true,
      venueHealthy: true,
      spotQuoteAgeMs: 100,
      perpSnapshotAgeMs: 100,
      feesAgeMs: 100,
      maxDataAgeMs: 3000,
      fundingHistoryHourly: [0.0007, 0.0008, 0.00075],
      minFundingAverageHourly: 0.0002,
      minFundingPositiveShare: 0.6,
      enterMinNetEdgeUsd: 0.1,
      enterMinNetEdgeBps: 1,
      holdMinNetEdgeUsd: 0,
      edge,
    });

    assert.equal(decision.action, "EXIT");
    assert.equal(decision.reasonCode, "EXIT_EDGE_NEGATIVE");
  });

  it("returns HOLD when open position remains healthy", () => {
    const edge = estimateCarryEdge({
      notionalUsd: 1000,
      holdHours: 8,
      expectedFundingRateHourly: 0.0008,
      spotEntryFeeRate: 0.0001,
      spotExitFeeRate: 0.0001,
      perpEntryFeeRate: 0.00025,
      perpExitFeeRate: 0.00025,
      expectedSlippageBps: 4,
      driftReserveBps: 4,
      gasCostUsdTotal: 0.5,
    });

    const decision = evaluateCarryDecision({
      market: "ETH-USD",
      hasOpenPosition: true,
      venueHealthy: true,
      spotQuoteAgeMs: 100,
      perpSnapshotAgeMs: 100,
      feesAgeMs: 100,
      maxDataAgeMs: 3000,
      fundingHistoryHourly: [0.0007, 0.0008, 0.00075],
      minFundingAverageHourly: 0.0002,
      minFundingPositiveShare: 0.6,
      enterMinNetEdgeUsd: 0.1,
      enterMinNetEdgeBps: 1,
      holdMinNetEdgeUsd: 0,
      edge,
    });

    assert.equal(decision.action, "HOLD");
    assert.equal(decision.reasonCode, "HOLD_POSITION_OK");
  });

  it("returns PAUSE when venue is unhealthy", () => {
    const edge = estimateCarryEdge({
      notionalUsd: 1000,
      holdHours: 8,
      expectedFundingRateHourly: 0.0008,
      spotEntryFeeRate: 0.0001,
      spotExitFeeRate: 0.0001,
      perpEntryFeeRate: 0.00025,
      perpExitFeeRate: 0.00025,
      expectedSlippageBps: 4,
      driftReserveBps: 4,
      gasCostUsdTotal: 0.5,
    });

    const decision = evaluateCarryDecision({
      market: "ETH-USD",
      hasOpenPosition: true,
      venueHealthy: false,
      spotQuoteAgeMs: 100,
      perpSnapshotAgeMs: 100,
      feesAgeMs: 100,
      maxDataAgeMs: 3000,
      fundingHistoryHourly: [0.0007, 0.0008, 0.00075],
      minFundingAverageHourly: 0.0002,
      minFundingPositiveShare: 0.6,
      enterMinNetEdgeUsd: 0.1,
      enterMinNetEdgeBps: 1,
      holdMinNetEdgeUsd: 0,
      edge,
    });

    assert.equal(decision.action, "PAUSE");
    assert.equal(decision.reasonCode, "PAUSE_VENUE_UNHEALTHY");
  });

  it("computes weak regime correctly", () => {
    const regime = fundingRegime([0.0001, -0.0001, 0.00005, -0.00002], 0.0001, 0.8);
    assert.equal(regime.isStrong, false);
    assert.ok(regime.positiveShare < 0.8);
  });
});
