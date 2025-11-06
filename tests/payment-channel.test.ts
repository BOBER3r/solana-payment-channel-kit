/**
 * Payment Channel Integration Tests
 * Using Mocha + CommonJS (proven working pattern from sol-bets-v3)
 * Using the ChannelManager API we built in Phase 2
 *
 * Run with: anchor test --skip-local-validator
 */

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Import our Phase 2 implementation from source (not built dist)
const { ChannelManager, createChannelConfig, fetchChannelStateFromChain } = require("../packages/core/src/index.ts");

// Import test helpers for local USDC
import { setupLocalUSDC, fundTestAccount, getUSDCBalance } from "./helpers";

const PROGRAM_ID = new PublicKey("CEVo4h4qnZkJVgzahQ9XwYz7a8NuCWdFcoiYiX6mZS1t");

describe("Payment Channel - Local Validator Integration", () => {
  // Configure the client to use the local validator
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  let localUsdcMint: PublicKey;
  let mintAuthority: Keypair;
  let clientKeypair: Keypair;
  let serverKeypair: Keypair;
  let clientManager: any;

  before(async function() {
    this.timeout(60000);

    console.log("\n========================================");
    console.log("🚀 Setting up LOCAL TEST environment...");
    console.log("========================================\n");

    // Check validator connection
    try {
      const version = await connection.getVersion();
      console.log(`✓ Connected to Local Validator: ${JSON.stringify(version)}`);
    } catch (error) {
      throw new Error("Failed to connect to local validator. Is it running?");
    }

    // Setup local USDC mint (we control this!)
    const usdcSetup = await setupLocalUSDC(connection, payer);
    localUsdcMint = usdcSetup.mint;
    mintAuthority = usdcSetup.authority;

    // Create test keypairs
    clientKeypair = Keypair.generate();
    serverKeypair = Keypair.generate();

    console.log(`\n📋 Test Accounts:`);
    console.log(`  - Payer:  ${payer.publicKey.toBase58()}`);
    console.log(`  - Client: ${clientKeypair.publicKey.toBase58()}`);
    console.log(`  - Server: ${serverKeypair.publicKey.toBase58()}`);

    // Fund client with SOL and USDC
    await fundTestAccount(
      connection,
      payer,
      localUsdcMint,
      mintAuthority,
      clientKeypair.publicKey,
      1.0,   // 1 SOL for transaction fees
      1000   // 1000 USDC for testing
    );

    // Fund server with SOL (no USDC needed)
    await fundTestAccount(
      connection,
      payer,
      localUsdcMint,
      mintAuthority,
      serverKeypair.publicKey,
      0.5,   // 0.5 SOL for transaction fees
      0      // Server receives USDC from channel
    );

    // Create ChannelManager using our Phase 2 implementation
    console.log("\n🔧 Initializing ChannelManager...");
    const config = createChannelConfig("devnet", PROGRAM_ID, {
      rpcUrl: connection.rpcEndpoint,
      usdcMint: localUsdcMint,  // Use our local USDC mint!
    });

    clientManager = new ChannelManager(config, clientKeypair);
    console.log("✓ ChannelManager ready");

    // Debug: Verify setup
    console.log("\n🔍 Configuration:");
    console.log(`  - Local USDC Mint: ${localUsdcMint.toBase58()}`);
    console.log(`  - Program ID: ${PROGRAM_ID.toBase58()}`);
    console.log(`  - Client Wallet: ${clientKeypair.publicKey.toBase58()}`);

    // Verify client USDC balance
    const { getAssociatedTokenAddress } = require("@solana/spl-token");
    const clientTokenAccount = await getAssociatedTokenAddress(
      localUsdcMint,
      clientKeypair.publicKey
    );
    const clientUsdcBalance = await getUSDCBalance(connection, clientTokenAccount);
    console.log(`  - Client USDC Balance: ${clientUsdcBalance} USDC`);

    console.log("\n========================================");
    console.log("✅ Setup complete!");
    console.log("========================================\n");
  });

  describe("Channel Lifecycle", () => {
    let channelId: string;

    it("should open a new payment channel", async function() {
      this.timeout(30000);

      console.log("\n--- TEST: Opening Payment Channel ---");

      const deposit = BigInt(10_000_000); // 10 USDC
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      channelId = await clientManager.openChannel({
        serverPubkey: serverKeypair.publicKey,
        initialDeposit: deposit,
        expiry,
      });

      console.log(`✓ Channel opened: ${channelId}`);

      expect(channelId).to.exist;
      expect(channelId).to.have.length(64); // 32 bytes as hex

      // Verify on-chain
      const channelIdBuffer = Buffer.from(channelId, "hex");
      const blockchainConfig = {
        connection,
        programId: PROGRAM_ID,
        usdcMint: localUsdcMint,
        commitment: "confirmed" as const,
      };

      const state = await fetchChannelStateFromChain(blockchainConfig, channelIdBuffer);
      console.log(`✓ Channel verified on-chain`);
      console.log(`  - Deposit: ${state.totalDeposit} micro-USDC`);
      console.log(`  - Status: ${state.isOpen ? "OPEN" : "CLOSED"}`);

      expect(state.isOpen).to.be.true;
      expect(state.totalDeposit.toString()).to.equal(deposit.toString());
    });

    it("should fetch channel state from blockchain", async function() {
      this.timeout(15000);

      console.log("\n--- TEST: Fetching Channel State ---");

      const state = await clientManager.getChannelState(channelId);

      console.log(`✓ Channel state fetched`);
      console.log(`  - Channel ID: ${state.channelId}`);
      console.log(`  - Balance: ${state.currentBalance}`);

      expect(state.channelId).to.equal(channelId);
      expect(state.isOpen).to.be.true;
    });

    it("should add funds to existing channel", async function() {
      this.timeout(30000);

      console.log("\n--- TEST: Adding Funds to Channel ---");

      const addAmount = BigInt(5_000_000); // 5 USDC

      const signature = await clientManager.addFunds(channelId, addAmount);
      console.log(`✓ Funds added: ${signature}`);

      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 3000));

      const state = await clientManager.getChannelState(channelId);
      console.log(`✓ New balance: ${state.totalDeposit} micro-USDC`);

      expect(state.totalDeposit).to.equal(BigInt(15_000_000)); // 10 + 5
    });

    it("should close channel and return remaining funds", async function() {
      this.timeout(30000);

      console.log("\n--- TEST: Closing Payment Channel ---");

      const clientTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        localUsdcMint,
        clientKeypair.publicKey
      );

      const balanceBefore = await getAccount(connection, clientTokenAccount.address);
      console.log(`Client balance before close: ${balanceBefore.amount}`);

      const signature = await clientManager.closeChannel(channelId);
      console.log(`✓ Channel closed: ${signature}`);

      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 3000));

      const state = await clientManager.getChannelState(channelId);
      console.log(`✓ Final status: ${state.isOpen ? "OPEN" : "CLOSED"}`);

      expect(state.isOpen).to.be.false;

      // Verify funds returned
      const balanceAfter = await getAccount(connection, clientTokenAccount.address);
      console.log(`Client balance after close: ${balanceAfter.amount}`);

      expect(Number(balanceAfter.amount)).to.be.greaterThan(Number(balanceBefore.amount));
    });
  });

  describe("Error Handling", () => {
    it("should fail to open channel with insufficient USDC balance", async function() {
      this.timeout(30000);

      console.log("\n--- TEST: Insufficient Balance Error ---");

      const poorClient = Keypair.generate();

      // Transfer SOL from payer but no USDC
      const transferTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: poorClient.publicKey,
          lamports: 0.5 * LAMPORTS_PER_SOL,
        })
      );
      await anchor.web3.sendAndConfirmTransaction(connection, transferTx, [payer]);

      const config = createChannelConfig("devnet", PROGRAM_ID, {
        rpcUrl: connection.rpcEndpoint,
        usdcMint: localUsdcMint,
      });

      const poorManager = new ChannelManager(config, poorClient);

      try {
        await poorManager.openChannel({
          serverPubkey: serverKeypair.publicKey,
          initialDeposit: BigInt(10_000_000),
        });

        // Should not reach here
        expect.fail("Should have thrown an error");
      } catch (error) {
        console.log("✓ Error thrown as expected");
        expect(error).to.exist;
      }
    });
  });

  after(() => {
    console.log("\n========================================");
    console.log("✅ All tests complete!");
    console.log("========================================\n");
  });
});
