#!/bin/bash

# Comprehensive blockchain integration testing script
# This script:
# 1. Builds the Rust program
# 2. Starts a local validator
# 3. Deploys the program
# 4. Runs integration tests
# 5. Cleans up

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "================================================"
echo "Blockchain Integration Test Suite"
echo "================================================"
echo ""
echo "Project root: $PROJECT_ROOT"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Function to cleanup
cleanup() {
    echo ""
    print_info "Cleaning up..."
    pkill -f solana-test-validator || true
    sleep 2
    print_success "Cleanup complete"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Step 1: Build the Rust program
echo "================================================"
echo "Step 1: Building Rust Program"
echo "================================================"
echo ""

cd programs/payment-channel

if cargo build-sbf 2>&1 | grep -i "error"; then
    print_error "Failed to build Rust program"
    exit 1
fi

print_success "Rust program built successfully"
echo ""

cd "$PROJECT_ROOT"

# Check if compiled program exists
if [ ! -f "target/deploy/payment_channel.so" ]; then
    print_error "Compiled program not found at target/deploy/payment_channel.so"
    exit 1
fi

print_success "Compiled program found"
echo ""

# Step 2: Start local validator
echo "================================================"
echo "Step 2: Starting Local Validator"
echo "================================================"
echo ""

# Kill any existing validator
pkill -f solana-test-validator || true
sleep 2

# Clean up old ledger
rm -rf test-ledger

# USDC mint on devnet
USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
SYSTEM_PROGRAM="11111111111111111111111111111111"
PROGRAM_ID="CEVo4h4qnZkJVgzahQ9XwYz7a8NuCWdFcoiYiX6mZS1t"

print_info "Configuration:"
echo "  USDC Mint: $USDC_MINT"
echo "  Token Program: $TOKEN_PROGRAM"
echo "  Program ID: $PROGRAM_ID"
echo ""

# Start validator in background
solana-test-validator \
  --ledger test-ledger \
  --reset \
  --quiet \
  --url https://api.devnet.solana.com \
  --clone $USDC_MINT \
  --clone $TOKEN_PROGRAM \
  --clone $SYSTEM_PROGRAM \
  --bpf-program $PROGRAM_ID target/deploy/payment_channel.so &

VALIDATOR_PID=$!

print_info "Validator PID: $VALIDATOR_PID"
echo ""

# Wait for validator to start
print_info "Waiting for validator to start..."
sleep 5

# Check if validator is running
if ! ps -p $VALIDATOR_PID > /dev/null; then
    print_error "Validator failed to start"
    exit 1
fi

# Wait for validator to be ready (macOS compatible)
COUNTER=0
MAX_WAIT=30
while [ $COUNTER -lt $MAX_WAIT ]; do
    if solana cluster-version > /dev/null 2>&1; then
        break
    fi
    sleep 1
    COUNTER=$((COUNTER + 1))
done

if [ $COUNTER -eq $MAX_WAIT ]; then
    print_error "Validator failed to become ready"
    kill $VALIDATOR_PID 2>/dev/null || true
    exit 1
fi

print_success "Validator started successfully"
echo ""

# Verify program is deployed
print_info "Verifying program deployment..."
if solana program show $PROGRAM_ID > /dev/null 2>&1; then
    print_success "Program deployed and accessible"
else
    print_error "Program not found on validator"
    exit 1
fi
echo ""

# Step 3: Build TypeScript packages
echo "================================================"
echo "Step 3: Building TypeScript Packages"
echo "================================================"
echo ""

cd packages/core

if npm run build -- --no-dts 2>&1 | grep -i "error"; then
    print_error "Failed to build TypeScript package"
    exit 1
fi

print_success "TypeScript package built successfully"
echo ""

cd "$PROJECT_ROOT"

# Step 4: Run integration tests
echo "================================================"
echo "Step 4: Running Integration Tests"
echo "================================================"
echo ""

cd packages/core

# Run tests with detailed output
if npm test -- tests/integration/blockchain.test.ts; then
    echo ""
    print_success "All integration tests passed!"
    TEST_EXIT_CODE=0
else
    echo ""
    print_error "Some integration tests failed"
    TEST_EXIT_CODE=1
fi

echo ""

cd "$PROJECT_ROOT"

# Summary
echo "================================================"
echo "Test Summary"
echo "================================================"
echo ""

if [ $TEST_EXIT_CODE -eq 0 ]; then
    print_success "All blockchain integration tests PASSED"
    print_success "Phase 2: Blockchain Integration COMPLETE"
else
    print_error "Some tests FAILED"
    print_error "Please review the test output above"
fi

echo ""
echo "================================================"

exit $TEST_EXIT_CODE
