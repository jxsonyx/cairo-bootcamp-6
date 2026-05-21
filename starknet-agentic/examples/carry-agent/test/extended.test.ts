import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createExtendedClient } from "../src/extended.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("extended client parsing", () => {
  it("parses status/data market envelope", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        status: "OK",
        data: [
          {
            name: "ETH-USD",
            marketStats: {
              markPrice: "2000",
              indexPrice: "1999",
              fundingRate: "0.00001",
              nextFundingRate: "1777777000000",
            },
            tradingConfig: {
              minOrderSize: "0.01",
              minOrderSizeChange: "0.001",
              minPriceChange: "0.1",
            },
          },
        ],
      });

    const client = createExtendedClient({
      baseUrl: "https://api.starknet.extended.exchange",
      apiPrefix: "/api/v1",
      fetchImpl,
    });

    const snapshot = await client.getMarketSnapshot("ETH-USD");
    assert.equal(snapshot.market, "ETH-USD");
    assert.equal(snapshot.markPrice, 2000);
    assert.equal(snapshot.tradingConfig.minOrderSize, 0.01);
  });

  it("parses compact funding rows", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        status: "OK",
        data: [
          { m: "ETH-USD", f: "0.00001", T: 1777777000000 },
          { m: "ETH-USD", f: "0.00002", T: 1777777600000 },
        ],
      });

    const client = createExtendedClient({
      baseUrl: "https://api.starknet.extended.exchange",
      apiPrefix: "/api/v1",
      fetchImpl,
    });

    const history = await client.getFundingHistory("ETH-USD", 1777777000000, 1777777600000);
    assert.equal(history.length, 2);
    assert.equal(history[0].fundingRate, 0.00001);
    assert.equal(history[1].timestamp, 1777777600000);
  });

  it("parses wrapped user fees", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        status: "OK",
        data: [
          {
            market: "ETH-USD",
            makerFeeRate: "0",
            takerFeeRate: "0.00025",
            builderFeeRate: "0",
          },
        ],
      });

    const client = createExtendedClient({
      baseUrl: "https://api.starknet.extended.exchange",
      apiPrefix: "/api/v1",
      apiKey: "test-key",
      fetchImpl,
    });

    const fees = await client.getUserFees("ETH-USD");
    assert.equal(fees.market, "ETH-USD");
    assert.equal(fees.takerFeeRate, 0.00025);
  });

  it("throws on non-2xx responses", async () => {
    const fetchImpl = async () => jsonResponse({ error: "upstream unavailable" }, 503);
    const client = createExtendedClient({
      baseUrl: "https://api.starknet.extended.exchange",
      apiPrefix: "/api/v1",
      fetchImpl,
    });

    await assert.rejects(
      () => client.getMarketSnapshot("ETH-USD"),
      /Extended request failed \(503/,
    );
  });

  it("throws when market snapshot payload has no matching rows", async () => {
    const fetchImpl = async () => jsonResponse({ status: "OK", data: [] });
    const client = createExtendedClient({
      baseUrl: "https://api.starknet.extended.exchange",
      apiPrefix: "/api/v1",
      fetchImpl,
    });

    await assert.rejects(
      () => client.getMarketSnapshot("ETH-USD"),
      /Market not found in Extended response/,
    );
  });

  it("throws when funding history endpoint fails", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/funding")) {
        return jsonResponse({ error: "funding not available" }, 500);
      }
      return jsonResponse({
        status: "OK",
        data: [],
      });
    };

    const client = createExtendedClient({
      baseUrl: "https://api.starknet.extended.exchange",
      apiPrefix: "/api/v1",
      fetchImpl,
    });

    await assert.rejects(
      () => client.getFundingHistory("ETH-USD", 1777777000000, 1777777600000),
      /Extended request failed \(500/,
    );
  });

  it("throws when wrapped user fee payload misses required fields", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        status: "OK",
        data: [{ market: "ETH-USD", takerFeeRate: "0.0002" }],
      });

    const client = createExtendedClient({
      baseUrl: "https://api.starknet.extended.exchange",
      apiPrefix: "/api/v1",
      apiKey: "test-key",
      fetchImpl,
    });

    await assert.rejects(() => client.getUserFees("ETH-USD"), /makerFeeRate/);
  });
});
