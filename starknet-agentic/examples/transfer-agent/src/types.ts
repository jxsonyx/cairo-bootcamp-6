/**
 * Type definitions for the Transfer Agent
 */

export interface TransferCondition {
  shouldTransfer: boolean;
  shouldAlert: boolean;
  status: string;
  reason?: string;
}

export interface TransferHook {
  name: string;
  handler: (context: TransferContext) => Promise<unknown>;
}

export interface TransferContext {
  txHash: string;
  amount: bigint;
  timestamp: string;
  balanceBefore: string;
  balanceAfter: string;
  token: string;
  recipient: string;
  [key: string]: unknown;
}

export interface TransferResult {
  success: boolean;
  txHash?: string;
  error?: string;
  timestamp: string;
  amount: string;
  token: string;
}

export interface AlertData {
  type: "low_balance_alert";
  timestamp: string;
  address: string;
  token: string;
  currentBalance: string;
  threshold: string;
  deficit: string;
  alertNumber: number;
}

export interface ExecutionLog {
  type: "transfer" | "transfer_error" | "low_balance_alert" | "post_transfer_hook";
  timestamp: string;
  txHash?: string;
  amount?: string;
  token?: string;
  recipient?: string;
  balanceBefore?: string;
  balanceAfter?: string;
  error?: string;
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AgentStats {
  isRunning: boolean;
  transferCount: number;
  alertCount: number;
  address: string;
  recipient: string;
  token: string;
  uptime?: number;
  lastCheckTime?: string;
}

export interface WebhookPayload {
  event: "transfer" | "alert" | "error";
  data: Record<string, unknown>;
  timestamp: string;
  agentAddress: string;
}
