/**
 * Transfer Condition Validator
 * 
 * Validates whether transfers should be executed based on:
 * - Balance thresholds
 * - Time-based rules
 * - Custom business logic
 */

import type { TransferCondition, TransferContext, TransferHook } from "./types.js";

export interface ValidationConfig {
  minBalanceThreshold: bigint;
  transferThreshold: bigint;
  transferAmount: bigint;
  enableTimeBasedRules?: boolean;
  allowedHoursStart?: number;
  allowedHoursEnd?: number;
  allowedDays?: number[];
  hooks?: TransferHook[];
}

export class TransferValidator {
  constructor(private config: ValidationConfig) {}

  /**
   * Validate if transfer should be executed
   */
  validate(balance: bigint): TransferCondition {
    // Check if balance is below minimum threshold (alert condition)
    if (balance < this.config.minBalanceThreshold) {
      return {
        shouldTransfer: false,
        shouldAlert: true,
        status: "⚠️  BELOW MINIMUM THRESHOLD!",
        reason: "Balance below minimum threshold",
      };
    }

    // Check if balance is above transfer threshold
    if (balance > this.config.transferThreshold) {
      // Additional time-based validation if enabled
      if (this.config.enableTimeBasedRules && !this.isWithinAllowedTime()) {
        return {
          shouldTransfer: false,
          shouldAlert: false,
          status: "⏰ Above threshold but outside allowed time",
          reason: "Outside allowed transfer hours",
        };
      }

      return {
        shouldTransfer: true,
        shouldAlert: false,
        status: "🚀 Above transfer threshold!",
        reason: "Balance exceeds transfer threshold",
      };
    }

    // Balance is within normal range
    return {
      shouldTransfer: false,
      shouldAlert: false,
      status: "✅ Above minimum threshold",
      reason: "Balance within normal range",
    };
  }

  /**
   * Check if current time is within allowed transfer hours
   */
  private isWithinAllowedTime(): boolean {
    if (!this.config.enableTimeBasedRules) {
      return true;
    }

    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // Check day of week
    if (this.config.allowedDays && !this.config.allowedDays.includes(day)) {
      return false;
    }

    // Check hour range
    if (
      this.config.allowedHoursStart !== undefined &&
      this.config.allowedHoursEnd !== undefined
    ) {
      if (hour < this.config.allowedHoursStart || hour >= this.config.allowedHoursEnd) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate that transfer amount doesn't exceed balance
   */
  validateTransferAmount(balance: bigint, amount: bigint): boolean {
    // Ensure enough balance for transfer + some buffer for gas
    const gasBuffer = BigInt(10 ** 15); // 0.001 ETH buffer
    return balance >= amount + gasBuffer;
  }

  /**
   * Calculate recommended transfer amount based on balance
   */
  calculateRecommendedAmount(balance: bigint): bigint {
    const excess = balance - this.config.transferThreshold;
    
    // Transfer the configured amount or the excess, whichever is smaller
    if (excess < this.config.transferAmount) {
      return excess;
    }
    
    return this.config.transferAmount;
  }

  /**
   * Get configured hooks
   */
  getHooks(): TransferHook[] {
    return this.config.hooks || [];
  }

  /**
   * Validate a transfer context and return validation result
   */
  validateContext(context: TransferContext): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!context.txHash) errors.push("Missing txHash");
    if (!context.amount) errors.push("Missing amount");
    if (!context.token) errors.push("Missing token");
    if (!context.recipient) errors.push("Missing recipient");
    
    return { valid: errors.length === 0, errors };
  }
}
