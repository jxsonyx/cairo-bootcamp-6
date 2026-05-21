# Autonomous Transfer Agent

A composable autonomous agent that monitors wallet balances, validates transfer conditions, executes transfers, and triggers alerts based on configurable thresholds.

## Features

✅ **Balance Monitoring**: Continuously checks wallet balance for specified tokens  
✅ **Conditional Transfers**: Automatically transfers tokens when balance exceeds threshold  
✅ **Alert System**: Triggers alerts when balance drops below minimum threshold  
✅ **Multi-Step Workflows**: Chains multiple operations (check → validate → transfer → log)  
✅ **Composable Architecture**: Easy to extend with additional agents or functions  
✅ **Comprehensive Logging**: Detailed execution logs with timestamps and transaction hashes  
✅ **Safety Limits**: Configurable maximum transfers per session  
✅ **Flexible Token Support**: Works with ETH, STRK, USDC, or any ERC20 token  

## What This Agent Does

The agent autonomously:

1. **Fetches wallet balance** for configured token
2. **Validates transfer conditions** against thresholds
3. **Transfers tokens** if balance > threshold
4. **Calls another function/agent** after successful transfer
5. **Logs execution results** to console and file
6. **Triggers alerts** when balance drops below minimum

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Transfer Agent                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Monitor    │  │  Validator   │  │  Transfer        │  │
│  │   Loop       │─▶│  (threshold) │─▶│  Executor        │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│         │                                      │             │
│         ▼                                      ▼             │
│  ┌──────────────┐                    ┌──────────────────┐  │
│  │   Alert      │                    │  Post-Transfer   │  │
│  │   System     │                    │  Hook (agent)    │  │
│  └──────────────┘                    └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Starknet Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Balance     │  │  Transfer    │  │  Transaction     │  │
│  │  Query       │  │  Execution   │  │  Confirmation    │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install Dependencies

```bash
cd examples/transfer-agent
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```env
# Required
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
RECIPIENT_ADDRESS=0x...

# Thresholds
MIN_BALANCE_THRESHOLD=0.01    # Alert below this
TRANSFER_THRESHOLD=0.1        # Transfer above this
DEFAULT_TRANSFER_AMOUNT=0.05  # Amount to transfer

# Behavior
AUTO_TRANSFER_ENABLED=true
CHECK_INTERVAL_MS=60000       # Check every minute
MAX_TRANSFERS_PER_SESSION=10
```

### 3. Run the Agent

**Development mode (with hot reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

**Dry-run mode (monitoring only, no transfers):**
```bash
AUTO_TRANSFER_ENABLED=false npm start
```

## Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `MIN_BALANCE_THRESHOLD` | Alert triggers below this balance | `0.01` ETH |
| `TRANSFER_THRESHOLD` | Transfer executes above this balance | `0.1` ETH |
| `DEFAULT_TRANSFER_AMOUNT` | Amount to transfer each time | `0.05` ETH |
| `RECIPIENT_ADDRESS` | Destination for transfers | Required |
| `CHECK_INTERVAL_MS` | Time between balance checks | `60000` (1 min) |
| `MONITOR_TOKEN` | Token to monitor (ETH/STRK/USDC/address) | `ETH` |
| `AUTO_TRANSFER_ENABLED` | Enable automatic transfers | `false` |
| `MAX_TRANSFERS_PER_SESSION` | Safety limit on transfers | `10` |
| `ALERT_WEBHOOK_URL` | External webhook for alerts | Optional |

## Expected Output

### Normal Operation

```
🤖 Autonomous Transfer Agent Starting...
📍 Agent Address: 0x1234...5678
🎯 Recipient: 0xabcd...ef01
📊 Configuration:
   Monitor Token: ETH
   Min Balance Threshold: 0.01 ETH
   Transfer Threshold: 0.1 ETH
   Transfer Amount: 0.05 ETH
   Auto-Transfer: enabled
   Check Interval: 60s

✅ Agent is now running

[10:30:00] 🔍 Checking balance...
   Current Balance: 0.0523 ETH
   Status: ✅ Above minimum threshold
   Action: No transfer needed

[10:31:00] 🔍 Checking balance...
   Current Balance: 0.1234 ETH
   Status: 🚀 Above transfer threshold!

💸 TRANSFER TRIGGERED
   Amount: 0.05 ETH
   Recipient: 0xabcd...ef01
   Reason: Balance (0.1234 ETH) > Threshold (0.1 ETH)

📤 Executing transfer...
   ✅ Transfer complete: 0xdef...789
   New Balance: 0.0734 ETH

🔗 Calling post-transfer hook...
   ✅ Hook executed successfully

📝 Execution logged to: logs/transfer-2026-05-20T10-31-00.json

[10:32:00] 🔍 Checking balance...
   Current Balance: 0.0089 ETH
   Status: ⚠️  BELOW MINIMUM THRESHOLD!

🚨 ALERT TRIGGERED
   Current Balance: 0.0089 ETH
   Minimum Threshold: 0.01 ETH
   Deficit: 0.0011 ETH
   Action Required: Fund wallet

📧 Alert sent to webhook
```

### Dry-Run Mode

```
🤖 Autonomous Transfer Agent Starting...
📍 Agent Address: 0x1234...5678
⚠️  DRY-RUN MODE: Monitoring only, no transfers will execute

[10:30:00] 🔍 Checking balance...
   Current Balance: 0.1234 ETH
   Status: 🚀 Above transfer threshold!
   [DRY-RUN] Would transfer 0.05 ETH to 0xabcd...ef01
```

## Use Cases

### 1. Automated Treasury Management

Monitor a treasury wallet and automatically distribute funds when balance exceeds threshold:

```env
TRANSFER_THRESHOLD=100
DEFAULT_TRANSFER_AMOUNT=50
RECIPIENT_ADDRESS=0x...  # Distribution wallet
```

### 2. Low Balance Alerts

Get notified when operational wallets need funding:

```env
MIN_BALANCE_THRESHOLD=0.1
AUTO_TRANSFER_ENABLED=false
ALERT_WEBHOOK_URL=https://hooks.slack.com/...
```

### 3. Automated Savings

Automatically transfer excess funds to a savings wallet:

```env
TRANSFER_THRESHOLD=1.0
DEFAULT_TRANSFER_AMOUNT=0.5
RECIPIENT_ADDRESS=0x...  # Cold storage
```

### 4. Multi-Agent Workflow

Chain multiple agents together via post-transfer hooks:

```typescript
// After transfer, trigger another agent
async postTransferHook(txHash: string, amount: string) {
  // Call DeFi agent to invest transferred funds
  await defiAgent.invest(amount);
  
  // Update on-chain registry
  await registryAgent.recordTransfer(txHash);
  
  // Notify monitoring system
  await monitoringAgent.logEvent('transfer_complete', { txHash, amount });
}
```

## Extending the Agent

### Add Custom Validation Logic

```typescript
// In src/validator.ts
validateCustomCondition(balance: bigint): boolean {
  // Only transfer on weekdays
  const day = new Date().getDay();
  if (day === 0 || day === 6) return false;
  
  // Only transfer during business hours
  const hour = new Date().getHours();
  if (hour < 9 || hour > 17) return false;
  
  return balance > this.transferThreshold;
}
```

### Add Multiple Recipients

```typescript
// Round-robin distribution
const recipients = [
  '0x...recipient1',
  '0x...recipient2',
  '0x...recipient3',
];

let currentIndex = 0;

async function distributeToNext() {
  const recipient = recipients[currentIndex];
  await transfer(recipient, amount);
  currentIndex = (currentIndex + 1) % recipients.length;
}
```

### Integrate with MCP Server

```typescript
// Make agent controllable via MCP
import { createMcpServer } from '@starknetfoundation/starknet-agentic-mcp-server';

const server = createMcpServer({
  tools: [
    {
      name: 'transfer_agent_start',
      description: 'Start the autonomous transfer agent',
      handler: () => agent.start(),
    },
    {
      name: 'transfer_agent_stop',
      description: 'Stop the transfer agent',
      handler: () => agent.stop(),
    },
    {
      name: 'transfer_agent_status',
      description: 'Get agent status and statistics',
      handler: () => agent.getStats(),
    },
  ],
});
```

### Add ERC-8004 Identity

```typescript
import { registerIdentity } from '@starknetfoundation/starknet-agentic-agent-passport';

// Register agent identity on-chain
await registerIdentity(account, {
  name: 'Autonomous Transfer Agent',
  description: 'Monitors balances and executes conditional transfers',
  capabilities: ['balance_monitoring', 'automated_transfer', 'alert_system'],
  version: '1.0.0',
});
```

## Safety Features

### Transfer Limits

- **Per-session limit**: Prevents runaway transfers
- **Minimum balance check**: Ensures gas funds remain
- **Confirmation wait**: Waits for transaction confirmation

### Error Handling

- **Network failures**: Retries with exponential backoff
- **Insufficient balance**: Skips transfer, logs warning
- **Transaction revert**: Logs error, continues monitoring

### Monitoring

- **Execution logs**: JSON logs for each operation
- **Statistics tracking**: Transfers, alerts, errors
- **Health checks**: Agent uptime and status

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
# Test on Sepolia testnet
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io npm test
```

### Manual Testing

1. **Test balance monitoring**: Run in dry-run mode
2. **Test transfer execution**: Use small amounts on testnet
3. **Test alert system**: Set high threshold to trigger alerts
4. **Test safety limits**: Set `MAX_TRANSFERS_PER_SESSION=1`

## Troubleshooting

### "Insufficient balance for transfer"

- **Cause**: Balance below transfer amount + gas
- **Solution**: Lower `DEFAULT_TRANSFER_AMOUNT` or fund wallet

### "Transfer not executing"

- **Check**: `AUTO_TRANSFER_ENABLED=true`
- **Check**: Balance > `TRANSFER_THRESHOLD`
- **Check**: Not at `MAX_TRANSFERS_PER_SESSION` limit

### "Alert not triggering"

- **Check**: Balance < `MIN_BALANCE_THRESHOLD`
- **Check**: `ALERT_WEBHOOK_URL` is configured correctly
- **Check**: Network connectivity to webhook endpoint

### "Agent stops unexpectedly"

- **Check**: RPC endpoint is responsive
- **Check**: Account has gas for balance queries
- **Check**: No unhandled errors in logs

## Production Deployment

### Recommended Setup

1. **Use proxy signer mode** (not direct private key)
2. **Set conservative thresholds** to avoid excessive transfers
3. **Enable webhook alerts** for monitoring
4. **Run as systemd service** for auto-restart
5. **Monitor logs** for errors and anomalies

### Systemd Service Example

```ini
[Unit]
Description=Starknet Transfer Agent
After=network.target

[Service]
Type=simple
User=starknet
WorkingDirectory=/opt/starknet-agentic/examples/transfer-agent
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
```

## Resources

- [Starknet.js Documentation](https://www.starknetjs.com/)
- [Agent Account Contracts](../../contracts/agent-account/)
- [MCP Server Integration](../../packages/starknet-mcp-server/)
- [A2A Protocol](../../packages/starknet-a2a/)

## Security Considerations

⚠️ **Important Security Notes:**

1. **Never commit `.env` files** with real credentials
2. **Use testnet first** before mainnet deployment
3. **Start with small amounts** to test behavior
4. **Monitor agent activity** regularly
5. **Set reasonable limits** on transfer amounts and frequency
6. **Use proxy signer** in production (not direct private keys)
7. **Implement rate limiting** for external webhooks
8. **Validate recipient addresses** before deployment

## License

MIT

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## Support

- GitHub Issues: [starknet-agentic/issues](https://github.com/keep-starknet-strange/starknet-agentic/issues)
- Documentation: [docs/](../../docs/)
