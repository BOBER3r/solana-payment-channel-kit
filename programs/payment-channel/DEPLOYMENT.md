# Deployment Guide

This guide walks through deploying the Payment Channel program to Solana devnet and mainnet.

## Prerequisites

- Anchor CLI installed (v0.32.1+)
- Solana CLI installed (v1.18+)
- Node.js v18+ and yarn
- Sufficient SOL for deployment fees

## Installation

```bash
# Install dependencies
yarn install

# Build program
anchor build
```

## Configuration

### 1. Generate Program Keypair

```bash
# Generate new keypair for program
solana-keygen new -o target/deploy/payment_channel-keypair.json

# Get program ID
solana address -k target/deploy/payment_channel-keypair.json
```

### 2. Update Program ID

Replace `PayXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` with your actual program ID in:

- `programs/payment-channel/src/lib.rs` (line 5)
- `programs/payment-channel/Anchor.toml` (lines 11, 14, 17)

```rust
// lib.rs
declare_id!("YourProgramIDHere11111111111111111111111111");
```

```toml
# Anchor.toml
[programs.localnet]
payment_channel = "YourProgramIDHere11111111111111111111111111"
```

### 3. Rebuild After Program ID Update

```bash
anchor build
```

This step is critical - the program ID must match the keypair for deployment to succeed.

## Devnet Deployment

### 1. Configure Solana CLI for Devnet

```bash
solana config set --url https://api.devnet.solana.com

# Verify configuration
solana config get
```

### 2. Create/Fund Deployer Wallet

```bash
# Create new wallet (if needed)
solana-keygen new -o ~/.config/solana/devnet-deployer.json

# Set as default
solana config set --keypair ~/.config/solana/devnet-deployer.json

# Request airdrop (devnet only)
solana airdrop 2

# Check balance (need ~5 SOL for deployment + testing)
solana balance
```

### 3. Deploy to Devnet

```bash
# Deploy program
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show <PROGRAM_ID>
```

Expected output:
```
Program Id: YourProgramIDHere...
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: ...
Authority: YourWalletAddress...
Last Deployed In Slot: ...
Data Length: ... bytes
Balance: ... SOL
```

### 4. Verify Program

```bash
# Get program account info
solana account <PROGRAM_ID> --output json

# Verify program is executable
solana program show <PROGRAM_ID> | grep "Owner"
# Should show: BPFLoaderUpgradeab1e11111111111111111111111
```

## Testing on Devnet

### 1. Run Integration Tests

```bash
# Configure test to use devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/devnet-deployer.json

# Run tests
anchor test --skip-local-validator
```

### 2. Manual Testing

```bash
# Create test channel
ts-node scripts/open-channel.ts --cluster devnet

# Monitor events
solana logs <PROGRAM_ID> --commitment confirmed
```

## Mainnet Deployment

### Pre-Deployment Checklist

- [ ] Security audit completed and reviewed
- [ ] All audit findings addressed
- [ ] Extensive testing on devnet
- [ ] Documentation complete
- [ ] Incident response plan in place
- [ ] Monitoring and alerting configured
- [ ] Team trained on emergency procedures

### 1. Prepare Mainnet Environment

```bash
# Configure for mainnet
solana config set --url https://api.mainnet-beta.solana.com

# Use dedicated mainnet wallet
solana config set --keypair ~/.config/solana/mainnet-deployer.json

# Verify you have enough SOL (need 15-20 SOL for safety)
solana balance
```

### 2. Final Build and Verification

```bash
# Clean build
cargo clean
anchor clean

# Build with verifiable flag
anchor build --verifiable

# Verify build
anchor build --verifiable 2>&1 | grep "Build successful"

# Check program size (should be under 200KB ideally)
ls -lh target/deploy/payment_channel.so
```

### 3. Deploy to Mainnet

```bash
# Deploy (this will cost ~10-15 SOL)
anchor deploy --provider.cluster mainnet

# Immediately verify
solana program show <PROGRAM_ID>
```

### 4. Transfer Upgrade Authority (IMPORTANT)

For production security, transfer upgrade authority to a multisig:

```bash
# Create multisig (using Squads Protocol or similar)
# See: https://squads.so/

# Transfer authority to multisig
solana program set-upgrade-authority \
  <PROGRAM_ID> \
  --upgrade-authority ~/.config/solana/mainnet-deployer.json \
  --new-upgrade-authority <MULTISIG_ADDRESS>

# Verify transfer
solana program show <PROGRAM_ID> | grep Authority
```

### 5. Verification on Mainnet

```bash
# Verify program is live
solana program show <PROGRAM_ID>

# Test with small transaction
ts-node scripts/open-channel.ts \
  --cluster mainnet \
  --amount 1000000  # 1 USDC test

# Monitor for 24 hours
solana logs <PROGRAM_ID> --commitment confirmed
```

## Post-Deployment

### 1. Monitoring Setup

```bash
# Set up log monitoring
solana logs <PROGRAM_ID> > logs/program.log &

# Monitor events
node scripts/monitor-events.js
```

### 2. Create Verification Materials

```bash
# Generate IDL
anchor idl init -f target/idl/payment_channel.json <PROGRAM_ID>

# Publish IDL to chain
anchor idl upgrade -f target/idl/payment_channel.json <PROGRAM_ID>

# Verify IDL is on-chain
anchor idl fetch <PROGRAM_ID> -o fetched-idl.json
diff target/idl/payment_channel.json fetched-idl.json
```

### 3. Documentation Updates

Update the following with mainnet program ID:

- README.md
- API documentation
- Integration guides
- Example code
- SDK configuration

### 4. Announce Deployment

- Blog post with program ID and verification instructions
- Discord/Twitter announcement
- Update documentation site
- Notify early users/partners

## Upgrade Procedure

If you need to upgrade the program (mainnet):

### 1. Prepare Upgrade

```bash
# Make code changes
# ... edit code ...

# Build new version
anchor build --verifiable

# Test extensively on devnet first!
anchor upgrade target/deploy/payment_channel.so \
  --provider.cluster devnet \
  --program-id <PROGRAM_ID>

# Test upgraded program on devnet
anchor test --skip-local-validator
```

### 2. Mainnet Upgrade (with Multisig)

```bash
# Create upgrade proposal in multisig
# (specific steps depend on multisig solution)

# Once approved, execute upgrade
anchor upgrade target/deploy/payment_channel.so \
  --provider.cluster mainnet \
  --program-id <PROGRAM_ID> \
  --program-keypair <MULTISIG_KEYPAIR>
```

### 3. Verify Upgrade

```bash
# Check new deployment slot
solana program show <PROGRAM_ID>

# Test critical functions
ts-node scripts/test-upgrade.ts

# Monitor for issues
solana logs <PROGRAM_ID>
```

## Troubleshooting

### Deployment Fails with "Insufficient Funds"

```bash
# Check balance
solana balance

# Request more SOL (devnet)
solana airdrop 5

# Or transfer SOL (mainnet)
# Need ~15 SOL for initial deployment
```

### Program ID Mismatch Error

```bash
# Ensure program ID in code matches keypair
solana address -k target/deploy/payment_channel-keypair.json

# Update lib.rs and Anchor.toml with correct ID

# Rebuild
anchor build
```

### Upgrade Authority Error

```bash
# Check current authority
solana program show <PROGRAM_ID> | grep Authority

# If wrong, recover authority (requires original deployer)
solana program set-upgrade-authority <PROGRAM_ID> \
  --upgrade-authority <CURRENT_AUTHORITY> \
  --new-upgrade-authority <YOUR_WALLET>
```

### Transaction Too Large Error

```bash
# Program size too large, optimize build
cargo clean
anchor build --release

# If still too large, consider:
# - Removing debug code
# - Optimizing dependencies
# - Splitting into multiple programs
```

### Verifiable Build Fails

```bash
# Ensure Docker is running
docker ps

# Use Anchor's verifiable build
anchor build --verifiable

# If persistent issues, try rebuilding Anchor Docker image
docker pull projectserum/build:v0.32.1
```

## Cost Estimates

### Devnet
- Deployment: Free (airdropped SOL)
- Testing: Free

### Mainnet
- Initial deployment: ~10-15 SOL
- Program upgrade: ~1-2 SOL
- Rent for program account: ~2.5 SOL (one-time, refundable)
- Each channel creation: ~0.002 SOL rent (paid by users)

## Security Considerations

### Before Mainnet Deployment

1. **Security Audit**: Get professional audit
2. **Bug Bounty**: Consider launching bug bounty program
3. **Multisig**: Use multisig for upgrade authority
4. **Time Lock**: Implement upgrade time lock if possible
5. **Insurance**: Consider smart contract insurance

### After Deployment

1. **Monitoring**: 24/7 monitoring of program activity
2. **Incident Response**: Have emergency response plan
3. **Backup Plans**: Know how to pause/upgrade in emergency
4. **Communication**: Clear channels to notify users of issues

## Rollback Plan

If critical issue discovered:

1. **Immediate**: Notify users via all channels
2. **Short-term**: Deploy patched version (requires upgrade authority)
3. **Medium-term**: Assist users in closing affected channels
4. **Long-term**: Post-mortem and process improvements

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Devnet

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Anchor
        run: npm install -g @coral-xyz/anchor-cli

      - name: Build
        run: anchor build

      - name: Deploy to Devnet
        env:
          ANCHOR_WALLET: ${{ secrets.DEVNET_DEPLOYER_KEY }}
        run: anchor deploy --provider.cluster devnet
```

## Monitoring and Analytics

### On-chain Monitoring

```typescript
// scripts/monitor.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const programId = new PublicKey("YourProgramID...");

// Monitor program logs
connection.onLogs(
  programId,
  (logs) => {
    console.log("Transaction logs:", logs);
    // Alert on errors, unusual patterns, etc.
  },
  "confirmed"
);

// Track channel creations
connection.onProgramAccountChange(
  programId,
  (accountInfo) => {
    // Process account changes
    console.log("Account changed:", accountInfo);
  },
  "confirmed"
);
```

### Metrics to Track

- Number of open channels
- Total value locked (TVL)
- Average channel lifetime
- Payment claim frequency
- Failed transactions
- Gas costs
- User growth

## Support

For deployment issues:
- Documentation: [Link]
- Discord: [Link]
- Email: devops@[domain].com

## References

- [Anchor Deployment Guide](https://www.anchor-lang.com/docs/cli)
- [Solana Program Deployment](https://docs.solana.com/cli/deploy-a-program)
- [Verifiable Builds](https://www.anchor-lang.com/docs/verifiable-builds)
- [Squads Multisig](https://squads.so/)