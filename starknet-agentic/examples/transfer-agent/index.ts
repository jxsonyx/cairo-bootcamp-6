/**
 * Autonomous Transfer Agent
 *
 * A composable autonomous agent that:
 * 1. Fetches wallet balance
 * 2. Validates transfer conditions
 * 3. Transfers tokens if balance > threshold
 * 4. Calls another function/agent after transfer
 * 5. Logs execution results
 * 6. Triggers alerts when balance drops below threshold
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import { Account, RpcProvider, Contract, uint256 } from "starknet";

// Load .env from script's directory
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

// ============================================================================
// Configuration
// ============================================================================

interface AgentConfig {
  RPC_URL: string;
  ACCOUNT_ADDRESS: string;
  PRIVATE_KEY: string;
  RECIPIENT_ADDRESS: string;
  MIN_BALANCE_THRESHOLD: bigint;
  TRANSFER_THRESHOLD: bigint;
  DEFAULT_TRANSFER_AMOUNT: bigint;
  CHECK_INTERVAL_MS: number;
  MONITOR_TOKEN: string;
  AUTO_TRANSFER_ENABLED: boolean;
  MAX_TRANSFERS_PER_SESSION: number;
  ALERT_WEBHOOK_URL?: string;
  postTransferHooks?: TransferHook[];
}

interface TransferHook {
  name: string;
  handler: (context: TransferContext) => Promise<unknown>;
}

interface TransferContext {
  txHash: string;
  amount: bigint;
  timestamp: string;
  balanceBefore: string;
  balanceAfter: string;
  token: string;
  recipient: string;
  [key: string]: unknown;
}

type TransferHookHandler = (hook: TransferHook) => Promise<unknown>;

// Token addresses on Starknet
const TOKENS: Record<string, string> = {
  ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
};

// Cairo 1 ERC20 ABI for balance and transfer
const ERC20_ABI = [
  {
    type: "interface",
    name: "openzeppelin::token::erc20::interface::IERC20",
    items: [
      {
        type: "function",
        name: "balance_of",
        inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
        outputs: [{ type: "core::integer::u256" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "transfer",
        inputs: [
          { name: "recipient", type: "core::starknet::contract_address::ContractAddress" },
          { name: "amount", type: "core::integer::u256" },
        ],
        outputs: [{ type: "core::bool" }],
        state_mutability: "external",
      },
    ],
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseConfig(): AgentConfig {
  const ethDecimals = 18;
  const toWei = (amount: string): bigint => BigInt(Math.floor(parseFloat(amount) * 10 ** ethDecimals));

  // Default hooks that can be extended
  const defaultHooks: TransferHook[] = [
    {
      name: "logRegistry",
      handler: async (ctx) => {
        console.log("   [Hook] Recording transfer in registry...");
        return { logged: true, txHash: ctx.txHash };
      },
    },
  ];

  return {
    RPC_URL: process.env.STARKNET_RPC_URL?.trim() || "https://starknet-sepolia.public.blastapi.io",
    ACCOUNT_ADDRESS: requireEnv("STARKNET_ACCOUNT_ADDRESS"),
    PRIVATE_KEY: requireEnv("STARKNET_PRIVATE_KEY"),
    RECIPIENT_ADDRESS: requireEnv("RECIPIENT_ADDRESS"),
    MIN_BALANCE_THRESHOLD: toWei(process.env.MIN_BALANCE_THRESHOLD || "0.01"),
    TRANSFER_THRESHOLD: toWei(process.env.TRANSFER_THRESHOLD || "0.1"),
    DEFAULT_TRANSFER_AMOUNT: toWei(process.env.DEFAULT_TRANSFER_AMOUNT || "0.05"),
    CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS || "60000", 10),
    MONITOR_TOKEN: process.env.MONITOR_TOKEN || "ETH",
    AUTO_TRANSFER_ENABLED: process.env.AUTO_TRANSFER_ENABLED === "true",
    MAX_TRANSFERS_PER_SESSION: parseInt(process.env.MAX_TRANSFERS_PER_SESSION || "10", 10),
    ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
    postTransferHooks: defaultHooks,
  };
}

function formatBalance(balance: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals);
  const whole = balance / divisor;
  const fraction = balance % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, 6);
  return `${whole}.${fractionStr}`;
}

function log(level: "INFO" | "WARN" | "ERROR" | "SUCCESS", message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const emoji = {
    INFO: "ℹ️",
    WARN: "⚠️",
    ERROR: "❌",
    SUCCESS: "✅",
  }[level];

  console.log(`[${timestamp}] ${emoji} ${message}`);
  if (data) {
    console.log("   ", JSON.stringify(data, null, 2));
  }
}

// ============================================================================
// Transfer Agent Class
// ============================================================================

class TransferAgent {
  private config: AgentConfig;
  private provider: RpcProvider;
  private account: Account;
  private tokenContract: Contract;
  private isRunning: boolean = false;
  private transferCount: number = 0;
  private alertCount: number = 0;
  private lastAlertTime: number = 0;
  private tokenAddress: string;
  private tokenSymbol: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.provider = new RpcProvider({ nodeUrl: config.RPC_URL });
    this.account = new Account({
      provider: this.provider,
      address: config.ACCOUNT_ADDRESS,
      signer: config.PRIVATE_KEY,
    });

    // Resolve token address
    this.tokenAddress = TOKENS[config.MONITOR_TOKEN] || config.MONITOR_TOKEN;
    this.tokenSymbol = config.MONITOR_TOKEN;

    this.tokenContract = new Contract({
      abi: ERC20_ABI,
      address: this.tokenAddress,
      providerOrAccount: this.account,
    });
  }

  /**
   * Start the autonomous agent
   */
  async start(): Promise<void> {
    console.log("\n🤖 Autonomous Transfer Agent Starting...");
    console.log(`📍 Agent Address: ${this.config.ACCOUNT_ADDRESS}`);
    console.log(`🎯 Recipient: ${this.config.RECIPIENT_ADDRESS}`);
    console.log(`📊 Configuration:`);
    console.log(`   Monitor Token: ${this.tokenSymbol}`);
    console.log(`   Min Balance Threshold: ${formatBalance(this.config.MIN_BALANCE_THRESHOLD)} ${this.tokenSymbol}`);
    console.log(`   Transfer Threshold: ${formatBalance(this.config.TRANSFER_THRESHOLD)} ${this.tokenSymbol}`);
    console.log(`   Transfer Amount: ${formatBalance(this.config.DEFAULT_TRANSFER_AMOUNT)} ${this.tokenSymbol}`);
    console.log(`   Auto-Transfer: ${this.config.AUTO_TRANSFER_ENABLED ? "enabled" : "disabled"}`);
    console.log(`   Check Interval: ${this.config.CHECK_INTERVAL_MS / 1000}s`);
    console.log(`   Max Transfers/Session: ${this.config.MAX_TRANSFERS_PER_SESSION}`);

    if (!this.config.AUTO_TRANSFER_ENABLED) {
      console.log("\n⚠️  DRY-RUN MODE: Monitoring only, no transfers will execute\n");
    }

    this.isRunning = true;
    console.log("\n✅ Agent is now running\n");

    // Start monitoring loop
    await this.monitorLoop();
  }

  /**
   * Stop the agent
   */
  stop(): void {
    this.isRunning = false;
    log("INFO", "Agent stopped");
  }

  /**
   * Main monitoring loop
   */
  private async monitorLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkAndAct();
      } catch (error) {
        log("ERROR", "Error in monitoring loop", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Wait before next check
      await this.sleep(this.config.CHECK_INTERVAL_MS);
    }
  }

  /**
   * Check balance and take appropriate action
   */
  private async checkAndAct(): Promise<void> {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n[${timestamp}] 🔍 Checking balance...`);

    // Step 1: Fetch wallet balance
    const balance = await this.fetchBalance();
    console.log(`   Current Balance: ${formatBalance(balance)} ${this.tokenSymbol}`);

    // Step 2: Validate transfer conditions
    const validation = this.validateConditions(balance);
    console.log(`   Status: ${validation.status}`);

    // Step 3: Execute transfer if conditions met
    if (validation.shouldTransfer) {
      if (this.config.AUTO_TRANSFER_ENABLED) {
        if (this.transferCount >= this.config.MAX_TRANSFERS_PER_SESSION) {
          log("WARN", "Maximum transfers per session reached", {
            count: this.transferCount,
            limit: this.config.MAX_TRANSFERS_PER_SESSION,
          });
          console.log("   Action: Transfer limit reached, monitoring only");
        } else {
          await this.executeTransfer(balance);
        }
      } else {
        console.log(`   [DRY-RUN] Would transfer ${formatBalance(this.config.DEFAULT_TRANSFER_AMOUNT)} ${this.tokenSymbol} to ${this.config.RECIPIENT_ADDRESS}`);
      }
    } else if (validation.shouldAlert) {
      await this.triggerAlert(balance);
    } else {
      console.log("   Action: No action needed");
    }
  }

  /**
   * Step 1: Fetch wallet balance
   */
  private async fetchBalance(): Promise<bigint> {
    try {
      const balance = await this.tokenContract.balance_of(this.config.ACCOUNT_ADDRESS);
      // Handle u256 return type
      const balanceBigInt = typeof balance === "bigint" ? balance : BigInt(balance);
      return balanceBigInt;
    } catch (error) {
      log("ERROR", "Failed to fetch balance", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Step 2: Validate transfer conditions
   */
  private validateConditions(balance: bigint): {
    shouldTransfer: boolean;
    shouldAlert: boolean;
    status: string;
  } {
    // Check if balance is below minimum threshold (alert condition)
    if (balance < this.config.MIN_BALANCE_THRESHOLD) {
      return {
        shouldTransfer: false,
        shouldAlert: true,
        status: "⚠️  BELOW MINIMUM THRESHOLD!",
      };
    }

    // Check if balance is above transfer threshold
    if (balance > this.config.TRANSFER_THRESHOLD) {
      return {
        shouldTransfer: true,
        shouldAlert: false,
        status: "🚀 Above transfer threshold!",
      };
    }

    // Balance is within normal range
    return {
      shouldTransfer: false,
      shouldAlert: false,
      status: "✅ Above minimum threshold",
    };
  }

  /**
   * Step 3: Execute transfer
   */
  private async executeTransfer(currentBalance: bigint): Promise<void> {
    console.log("\n💸 TRANSFER TRIGGERED");
    console.log(`   Amount: ${formatBalance(this.config.DEFAULT_TRANSFER_AMOUNT)} ${this.tokenSymbol}`);
    console.log(`   Recipient: ${this.config.RECIPIENT_ADDRESS}`);
    console.log(`   Reason: Balance (${formatBalance(currentBalance)} ${this.tokenSymbol}) > Threshold (${formatBalance(this.config.TRANSFER_THRESHOLD)} ${this.tokenSymbol})`);

    try {
      console.log("\n📤 Executing transfer...");

      // Convert amount to u256 format for Cairo
      const amount = uint256.bnToUint256(this.config.DEFAULT_TRANSFER_AMOUNT);

      // Execute transfer
      const result = await this.tokenContract.transfer(this.config.RECIPIENT_ADDRESS, amount);

      // Wait for transaction confirmation
      await this.provider.waitForTransaction(result.transaction_hash);

      this.transferCount++;

      log("SUCCESS", "Transfer complete", {
        txHash: result.transaction_hash,
        amount: formatBalance(this.config.DEFAULT_TRANSFER_AMOUNT),
        token: this.tokenSymbol,
        transferNumber: this.transferCount,
      });

      // Step 4: Call post-transfer hook (another function/agent)
      await this.postTransferHook(result.transaction_hash, this.config.DEFAULT_TRANSFER_AMOUNT);

      // Step 5: Log execution results
      await this.logExecution({
        type: "transfer",
        timestamp: new Date().toISOString(),
        txHash: result.transaction_hash,
        amount: formatBalance(this.config.DEFAULT_TRANSFER_AMOUNT),
        token: this.tokenSymbol,
        recipient: this.config.RECIPIENT_ADDRESS,
        balanceBefore: formatBalance(currentBalance),
        balanceAfter: formatBalance(currentBalance - this.config.DEFAULT_TRANSFER_AMOUNT),
      });
    } catch (error) {
      log("ERROR", "Transfer failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      await this.logExecution({
        type: "transfer_error",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        amount: formatBalance(this.config.DEFAULT_TRANSFER_AMOUNT),
        token: this.tokenSymbol,
});
    }
  }

/**
   * Step 4: Post-transfer hook - call another function/agent
   */
  private async postTransferHook(txHash: string, amount: bigint): Promise<void> {
    console.log("\n🔗 Calling post-transfer hook...");

    const hookResults: Record<string, unknown> = {};

    // Execute all registered hooks
    for (const hook of this.config.postTransferHooks || []) {
      try {
        const result = await hook.handler({
          txHash,
          amount,
          timestamp: new Date().toISOString(),
          balanceBefore: formatBalance(
            (await this.fetchBalance()) + amount,
          ),
          balanceAfter: formatBalance(await this.fetchBalance()),
          token: this.tokenSymbol,
          recipient: this.config.RECIPIENT_ADDRESS,
        });
        hookResults[hook.name] = { success: true, result };
        log("SUCCESS", `Hook ${hook.name} executed`, { result });
      } catch (error) {
        hookResults[hook.name] = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
        log("WARN", `Hook ${hook.name} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Default placeholder hook if none configured
    if (this.config.postTransferHooks?.length === 0) {
      await this.sleep(1000);
    }

    // Log hook execution results
    await this.logExecution({
      type: "post_transfer_hook",
      timestamp: new Date().toISOString(),
      txHash,
      token: this.tokenSymbol,
      hooks: hookResults,
    });
  }

  /**
   * Execute a single post-transfer hook by name
   */
  async executeHook(
    hookName: string,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    const hook = this.config.postTransferHooks?.find((h) => h.name === hookName);
    if (!hook) {
      throw new Error(`Hook ${hookName} not found`);
    }
    return hook.handler(context);
  }

  /**
   * Step 4b: Call another agent in the workflow chain
   * Example: Notify a monitoring agent or trigger DeFi operations
   */
  private async callNextAgent(txHash: string, amount: bigint): Promise<void> {
    console.log("\n🔗 Calling next agent in workflow...");

    const nextAgentUrl = process.env.NEXT_AGENT_URL;
    if (!nextAgentUrl) {
      console.log("   [Info] No NEXT_AGENT_URL configured, skipping");
      return;
    }

    try {
      const response = await fetch(nextAgentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "transfer_complete",
          data: {
            txHash,
            amount: formatBalance(amount),
            token: this.tokenSymbol,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      if (response.ok) {
        log("SUCCESS", "Next agent notified", { url: nextAgentUrl });
      } else {
        log("WARN", "Next agent returned error", { status: response.status });
      }
    } catch (error) {
      log("WARN", "Failed to notify next agent", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Register a custom hook at runtime
   */
  addHook(hook: TransferHook): void {
    if (!this.config.postTransferHooks) {
      this.config.postTransferHooks = [];
    }
    this.config.postTransferHooks.push(hook);
    log("INFO", "Hook added", { name: hook.name });
  }

  /**
   * Remove a hook by name
   */
  removeHook(hookName: string): boolean {
    const idx = this.config.postTransferHooks?.findIndex((h) => h.name === hookName);
    if (idx !== undefined && idx >= 0) {
      this.config.postTransferHooks?.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Step 6: Trigger alert when balance drops below threshold
   */
  private async triggerAlert(balance: bigint): Promise<void> {
    // Rate limit alerts (max 1 per hour)
    const now = Date.now();
    if (now - this.lastAlertTime < 3600000) {
      console.log("   Action: Alert suppressed (rate limited)");
      return;
    }

    this.lastAlertTime = now;
    this.alertCount++;

    console.log("\n🚨 ALERT TRIGGERED");
    console.log(`   Current Balance: ${formatBalance(balance)} ${this.tokenSymbol}`);
    console.log(`   Minimum Threshold: ${formatBalance(this.config.MIN_BALANCE_THRESHOLD)} ${this.tokenSymbol}`);
    console.log(`   Deficit: ${formatBalance(this.config.MIN_BALANCE_THRESHOLD - balance)} ${this.tokenSymbol}`);
    console.log("   Action Required: Fund wallet");

    const alertData = {
      type: "low_balance_alert",
      timestamp: new Date().toISOString(),
      address: this.config.ACCOUNT_ADDRESS,
      token: this.tokenSymbol,
      currentBalance: formatBalance(balance),
      threshold: formatBalance(this.config.MIN_BALANCE_THRESHOLD),
      deficit: formatBalance(this.config.MIN_BALANCE_THRESHOLD - balance),
      alertNumber: this.alertCount,
    };

    // Send to webhook if configured
    if (this.config.ALERT_WEBHOOK_URL) {
      try {
        const response = await fetch(this.config.ALERT_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(alertData),
        });

        if (response.ok) {
          log("SUCCESS", "Alert sent to webhook", { url: this.config.ALERT_WEBHOOK_URL });
        } else {
          log("WARN", "Webhook returned error", { status: response.status });
        }
      } catch (error) {
        log("WARN", "Failed to send webhook alert", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Step 5: Log alert execution
    await this.logExecution(alertData);
  }

  /**
   * Step 5: Log execution results to file
   */
  private async logExecution(data: Record<string, unknown>): Promise<void> {
    try {
      const logsDir = join(__dirname, "logs");
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${data.type}-${timestamp}.json`;
      const filepath = join(logsDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");

      console.log(`\n📝 Execution logged to: logs/${filename}`);
    } catch (error) {
      log("WARN", "Failed to write log file", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get agent statistics
   */
  getStats(): {
    isRunning: boolean;
    transferCount: number;
    alertCount: number;
    address: string;
    recipient: string;
    token: string;
  } {
    return {
      isRunning: this.isRunning,
      transferCount: this.transferCount,
      alertCount: this.alertCount,
      address: this.config.ACCOUNT_ADDRESS,
      recipient: this.config.RECIPIENT_ADDRESS,
      token: this.tokenSymbol,
    };
  }

  /**
   * Helper: Sleep for ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  const config = parseConfig();
  const agent = new TransferAgent(config);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n📊 Final Statistics:");
    const stats = agent.getStats();
    console.log(`   Transfers Executed: ${stats.transferCount}`);
    console.log(`   Alerts Triggered: ${stats.alertCount}`);
    console.log(`   Agent Address: ${stats.address}`);
    console.log(`   Recipient: ${stats.recipient}`);
    console.log(`   Monitored Token: ${stats.token}`);
    console.log("\n👋 Shutting down gracefully...\n");
    agent.stop();
    process.exit(0);
  });

  // Start the agent
  await agent.start();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    if (error instanceof Error && error.message.startsWith("Missing required environment variable:")) {
      console.error(`❌ ${error.message}`);
      console.error("   Copy .env.example to .env and set STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY, and RECIPIENT_ADDRESS.");
    } else {
      console.error("❌ Fatal error:", error);
    }
    process.exit(1);
  });
}

export default TransferAgent;
