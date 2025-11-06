#!/bin/bash

# Start local Solana test validator with proper configuration for payment channel testing
# This script:
# 1. Starts solana-test-validator
# 2. Clones necessary accounts (USDC mint, token program)
# 3. Deploys the payment channel program
# 4. Creates test USDC mint for local testing

set -e

echo "======================================"
echo "Starting Solana Test Validator"
echo "======================================"

# Kill any existing validator
pkill -f solana-test-validator || true
sleep 2

# Clean up old ledger
rm -rf test-ledger

# USDC mint on devnet (will be cloned for testing)
USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
SYSTEM_PROGRAM="11111111111111111111111111111111"

echo ""
echo "Configuration:"
echo "- USDC Mint: $USDC_MINT"
echo "- Token Program: $TOKEN_PROGRAM"
echo ""

# Start validator with cloned accounts
solana-test-validator \
  --ledger test-ledger \
  --reset \
  --quiet \
  --clone $USDC_MINT \
  --clone $TOKEN_PROGRAM \
  --clone $SYSTEM_PROGRAM \
  --bpf-program PAyEN6C8YWzuRyvvqyPBQ9xdcbRc8SY9JmxdqgzbZ5j target/deploy/payment_channel.so &

VALIDATOR_PID=$!

echo ""
echo "Waiting for validator to start..."
sleep 5

# Wait for validator to be ready
timeout 30 bash -c 'until solana cluster-version > /dev/null 2>&1; do sleep 1; done' || {
  echo "ERROR: Validator failed to start"
  kill $VALIDATOR_PID 2>/dev/null || true
  exit 1
}

echo ""
echo "======================================"
echo "Validator Started Successfully!"
echo "======================================"
echo "PID: $VALIDATOR_PID"
echo ""
echo "Validator is running at: http://localhost:8899"
echo ""
echo "To stop the validator, run:"
echo "  pkill -f solana-test-validator"
echo ""
echo "Or press Ctrl+C"
echo ""

# Keep the script running
wait $VALIDATOR_PID
