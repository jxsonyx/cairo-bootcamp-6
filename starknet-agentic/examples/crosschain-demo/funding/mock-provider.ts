import type { FundingConfig, FundingProvider } from "./types.js";

export const mockFundingProvider: FundingProvider = {
  name: "mock",
  async preflight(_config: FundingConfig): Promise<void> {
    // PR1 uses a mock provider only; no external dependencies yet.
  },
  async fund(params) {
    return {
      provider: "mock",
      status: "mock",
      source_chain: "none",
      confirmed_at: new Date().toISOString(),
      amount_wei: params.amountWei.toString(),
      token: params.token,
    };
  },
};

