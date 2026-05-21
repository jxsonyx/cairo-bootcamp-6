import { z } from "zod";

const strictBooleanInput = z.enum(["0", "1", "true", "false"]);

function booleanEnv(defaultValue: "0" | "1") {
  return z
    .string()
    .default(defaultValue)
    .transform((value) => value.trim().toLowerCase())
    .pipe(strictBooleanInput)
    .transform((value) => value === "1" || value === "true");
}

const envSchema = z
  .object({
    EXTENDED_BASE_URL: z.string().url().default("https://api.starknet.extended.exchange"),
    EXTENDED_API_PREFIX: z.string().default("/api/v1"),
    EXTENDED_API_KEY: z.string().optional(),
    EXTENDED_PUBLIC_KEY: z.string().optional(),
    EXTENDED_PRIVATE_KEY: z.string().optional(),
    EXTENDED_VAULT_NUMBER: z.coerce.number().int().positive().optional(),

    CARRY_MARKET: z
      .string()
      .regex(/^[A-Z0-9]+-[A-Z0-9]+$/)
      .default("ETH-USD"),
    CARRY_NOTIONAL_USD: z.coerce.number().positive().default(1000),
    CARRY_HOLD_HOURS: z.coerce.number().positive().default(8),
    CARRY_FUNDING_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
    CARRY_MIN_FUNDING_AVG_HOURLY: z.coerce.number().default(0.00005),
    CARRY_MIN_FUNDING_POSITIVE_SHARE: z.coerce.number().min(0).max(1).default(0.6),
    CARRY_ENTER_MIN_NET_EDGE_USD: z.coerce.number().default(0.1),
    CARRY_ENTER_MIN_NET_EDGE_BPS: z.coerce.number().default(1),
    CARRY_HOLD_MIN_NET_EDGE_USD: z.coerce.number().default(0),

    CARRY_SPOT_ENTRY_FEE_RATE: z.coerce.number().nonnegative().default(0.0001),
    CARRY_SPOT_EXIT_FEE_RATE: z.coerce.number().nonnegative().default(0.0001),
    CARRY_EXPECTED_SLIPPAGE_BPS: z.coerce.number().nonnegative().default(5),
    CARRY_DRIFT_RESERVE_BPS: z.coerce.number().nonnegative().default(5),
    CARRY_GAS_COST_USD_TOTAL: z.coerce.number().nonnegative().default(0.5),

    CARRY_HAS_OPEN_POSITION: booleanEnv("0"),
    CARRY_VENUE_HEALTHY: booleanEnv("1"),
    CARRY_MAX_DATA_AGE_MS: z.coerce.number().int().positive().default(5000),
    CARRY_OUTPUT_DIR: z.string().default("./artifacts"),
    CARRY_RUN_MODE: z.enum(["dry-run", "execute"]).default("dry-run"),
    CARRY_MAX_NOTIONAL_USD: z.coerce.number().positive().default(1000),
    CARRY_MAX_UNHEDGED_NOTIONAL_USD: z.coerce.number().positive().default(1000),
    CARRY_LEGGING_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    CARRY_PARTIAL_FILL_TIMEOUT_MS: z.coerce.number().int().positive().default(7000),
    CARRY_DEADMAN_SWITCH_ENABLED: booleanEnv("1"),
    CARRY_DEADMAN_SWITCH_SECONDS: z.coerce.number().int().positive().default(60),
    CARRY_EXECUTION_SCENARIO: z
      .enum(["success", "second_leg_failure", "second_leg_timeout", "partial_fill"])
      .default("success"),
    CARRY_MOCK_SECOND_LEG_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
    CARRY_MOCK_SECOND_LEG_FILL_RATIO: z.coerce.number().positive().max(1).default(1),
    CARRY_EXECUTION_SURFACE: z.enum(["mock", "mcp_spot"]).default("mock"),
    CARRY_MCP_ENTRY: z.string().default("../../packages/starknet-mcp-server/dist/index.js"),
    CARRY_MCP_LABEL: z.string().default("carry-agent"),
    CARRY_SPOT_SELL_TOKEN: z.string().default("USDC"),
    CARRY_SPOT_BUY_TOKEN: z.string().default("ETH"),
    CARRY_SWAP_SLIPPAGE: z.coerce.number().positive().max(1).default(0.02),
    CARRY_PERP_SLIPPAGE_BPS: z.coerce.number().nonnegative().default(20),
    CARRY_PERP_ORDER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(350),
    CARRY_PERP_ORDER_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
    CARRY_EXTENDED_PYTHON_BIN: z.string().default("python3"),
    CARRY_EXTENDED_PYTHON_SCRIPT: z.string().default("./scripts/extended_perp_adapter.py"),
    CARRY_EXTENDED_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.CARRY_MAX_UNHEDGED_NOTIONAL_USD < value.CARRY_NOTIONAL_USD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CARRY_MAX_UNHEDGED_NOTIONAL_USD"],
        message:
          "CARRY_MAX_UNHEDGED_NOTIONAL_USD must be >= CARRY_NOTIONAL_USD so execute mode can hedge before forced neutralization.",
      });
    }
  });

export type CarryAgentConfig = z.infer<typeof envSchema>;

function buildScopedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const scoped: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if ((key.startsWith("CARRY_") || key.startsWith("EXTENDED_")) && typeof value === "string") {
      scoped[key] = value;
    }
  }
  return scoped;
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env): CarryAgentConfig {
  const parsed = envSchema.safeParse(buildScopedEnv(env));
  if (!parsed.success) {
    throw new Error(`Invalid carry-agent environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
