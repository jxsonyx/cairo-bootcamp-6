import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseConfig } from "../src/config.js";

describe("carry config parsing", () => {
  it("parses strict boolean fields", () => {
    const config = parseConfig({
      CARRY_HAS_OPEN_POSITION: "true",
      CARRY_VENUE_HEALTHY: "0",
      CARRY_MAX_UNHEDGED_NOTIONAL_USD: "1500",
      CARRY_NOTIONAL_USD: "1000",
    });

    assert.equal(config.CARRY_HAS_OPEN_POSITION, true);
    assert.equal(config.CARRY_VENUE_HEALTHY, false);
  });

  it("rejects malformed boolean env values", () => {
    assert.throws(
      () =>
        parseConfig({
          CARRY_HAS_OPEN_POSITION: "ture",
          CARRY_MAX_UNHEDGED_NOTIONAL_USD: "1500",
          CARRY_NOTIONAL_USD: "1000",
        }),
      /Invalid carry-agent environment/,
    );
  });

  it("rejects unknown carry env keys", () => {
    assert.throws(
      () =>
        parseConfig({
          CARRY_HAS_OPEN_POSTION: "1",
          CARRY_MAX_UNHEDGED_NOTIONAL_USD: "1500",
          CARRY_NOTIONAL_USD: "1000",
        }),
      /Invalid carry-agent environment/,
    );
  });

  it("rejects cap values below configured notional", () => {
    assert.throws(
      () =>
        parseConfig({
          CARRY_NOTIONAL_USD: "1000",
          CARRY_MAX_UNHEDGED_NOTIONAL_USD: "250",
        }),
      /must be >= CARRY_NOTIONAL_USD/,
    );
  });
});
