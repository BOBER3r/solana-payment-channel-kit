"use strict";
/**
 * Integration tests for blockchain functionality
 * Tests real transactions on local Solana validator with Anchor
 *
 * IMPORTANT: These are REAL tests, not mocks!
 * Run with: anchor test
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const core_1 = require("@x402-channels/core");
const core_2 = require("@x402-channels/core");
const chai_1 = require("chai");
const PROGRAM_ID = new web3_js_1.PublicKey('CEVo4h4qnZkJVgzahQ9XwYz7a8NuCWdFcoiYiX6mZS1t');
// Test constants
const INITIAL_DEPOSIT = BigInt(10000000); // 10 USDC
const ADD_FUNDS_AMOUNT = BigInt(5000000); // 5 USDC
const PAYMENT_AMOUNT = BigInt(1000000); // 1 USDC
describe('Payment Channel - Blockchain Integration', () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const connection = provider.connection;
    const payer = provider.wallet.payer;
    let clientKeypair;
    let serverKeypair;
    let usdcMint;
    let clientManager;
    let blockchainConfig;
    before(async () => {
        console.log('\n===========================================');
        console.log('Setting up blockchain integration tests...');
        console.log('===========================================\n');
        // Check validator is running
        try {
            const version = await connection.getVersion();
            console.log(`Connected to Solana validator: ${JSON.stringify(version)}`);
        }
        catch (error) {
            throw new Error(`Failed to connect to local validator. Please ensure anchor test is running the validator.`);
        }
        // Create test accounts
        clientKeypair = web3_js_1.Keypair.generate();
        serverKeypair = web3_js_1.Keypair.generate();
        console.log(`Payer: ${payer.publicKey.toBase58()}`);
        console.log(`Client: ${clientKeypair.publicKey.toBase58()}`);
        console.log(`Server: ${serverKeypair.publicKey.toBase58()}`);
        // Fund client and server accounts with SOL
        console.log('\nAirdropping SOL...');
        const airdropSig1 = await connection.requestAirdrop(clientKeypair.publicKey, 2 * web3_js_1.LAMPORTS_PER_SOL);
        await connection.confirmTransaction(airdropSig1);
        const airdropSig2 = await connection.requestAirdrop(serverKeypair.publicKey, 2 * web3_js_1.LAMPORTS_PER_SOL);
        await connection.confirmTransaction(airdropSig2);
        console.log('SOL airdropped successfully');
        // Create test USDC mint
        console.log('\nCreating test USDC mint...');
        usdcMint = await (0, spl_token_1.createMint)(connection, payer, payer.publicKey, null, 6 // USDC has 6 decimals
        );
        console.log(`USDC Mint: ${usdcMint.toBase58()}`);
        // Create token accounts and mint USDC
        console.log('\nMinting test USDC...');
        const clientTokenAccount = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, payer, usdcMint, clientKeypair.publicKey);
        const serverTokenAccount = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, payer, usdcMint, serverKeypair.publicKey);
        // Mint 100 USDC to client
        await (0, spl_token_1.mintTo)(connection, payer, usdcMint, clientTokenAccount.address, payer, 100000000 // 100 USDC
        );
        console.log(`Client USDC balance: 100 USDC`);
        console.log(`Server USDC balance: 0 USDC`);
        // Create blockchain config
        blockchainConfig = {
            connection,
            programId: PROGRAM_ID,
            usdcMint,
            commitment: 'confirmed',
        };
        // Create channel manager
        const config = (0, core_1.createChannelConfig)('localnet', PROGRAM_ID, {
            rpcUrl: connection.rpcEndpoint,
            usdcMint,
        });
        clientManager = new core_1.ChannelManager(config, clientKeypair);
        console.log('\n===========================================');
        console.log('Setup complete!');
        console.log('===========================================\n');
    });
    after(() => {
        console.log('\n===========================================');
        console.log('Blockchain integration tests complete');
        console.log('===========================================\n');
    });
    describe('Channel Lifecycle', () => {
        let channelId;
        let channelIdBuffer;
        it('should open a new payment channel', async () => {
            console.log('\n--- TEST: Opening Payment Channel ---');
            const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
            channelId = await clientManager.openChannel({
                serverPubkey: serverKeypair.publicKey,
                initialDeposit: INITIAL_DEPOSIT,
                expiry,
            });
            console.log(`Channel opened with ID: ${channelId}`);
            chai_1.assert.isDefined(channelId);
            chai_1.assert.equal(channelId.length, 64); // 32 bytes as hex
            channelIdBuffer = Buffer.from(channelId, 'hex');
            // Verify channel exists on-chain
            const channelState = await (0, core_1.fetchChannelStateFromChain)(blockchainConfig, channelIdBuffer);
            console.log(`On-chain state: ${JSON.stringify(channelState, null, 2)}`);
            chai_1.assert.equal(channelState.channelId, channelId);
            chai_1.assert.equal(channelState.clientPubkey, clientKeypair.publicKey.toBase58());
            chai_1.assert.equal(channelState.serverPubkey, serverKeypair.publicKey.toBase58());
            chai_1.assert.equal(channelState.totalDeposit.toString(), INITIAL_DEPOSIT.toString());
            chai_1.assert.equal(channelState.currentBalance.toString(), INITIAL_DEPOSIT.toString());
            chai_1.assert.equal(channelState.claimedAmount.toString(), '0');
            chai_1.assert.equal(channelState.nonce.toString(), '0');
            chai_1.assert.equal(channelState.status, core_2.ChannelStatus.Open);
            chai_1.assert.equal(channelState.isOpen, true);
            console.log('✓ Channel opened successfully\n');
        });
        it('should fetch channel state from blockchain', async () => {
            console.log('\n--- TEST: Fetching Channel State ---');
            const state = await clientManager.getChannelState(channelId);
            console.log(`Fetched state: ${JSON.stringify(state, null, 2)}`);
            chai_1.assert.equal(state.channelId, channelId);
            chai_1.assert.equal(state.totalDeposit.toString(), INITIAL_DEPOSIT.toString());
            chai_1.assert.equal(state.isOpen, true);
            console.log('✓ Channel state fetched successfully\n');
        });
        it('should add funds to existing channel', async () => {
            console.log('\n--- TEST: Adding Funds to Channel ---');
            const signature = await clientManager.addFunds(channelId, ADD_FUNDS_AMOUNT);
            console.log(`Add funds transaction: ${signature}`);
            chai_1.assert.isDefined(signature);
            // Wait a bit for transaction to be processed
            await new Promise((resolve) => setTimeout(resolve, 2000));
            // Verify updated state
            const state = await (0, core_1.fetchChannelStateFromChain)(blockchainConfig, channelIdBuffer);
            console.log(`Updated state: ${JSON.stringify(state, null, 2)}`);
            const expectedTotal = INITIAL_DEPOSIT + ADD_FUNDS_AMOUNT;
            chai_1.assert.equal(state.totalDeposit.toString(), expectedTotal.toString());
            chai_1.assert.equal(state.currentBalance.toString(), expectedTotal.toString());
            console.log('✓ Funds added successfully\n');
        });
        it('should verify channel balance after adding funds', async () => {
            console.log('\n--- TEST: Verifying Channel Balance ---');
            const state = await clientManager.getChannelState(channelId);
            const expectedTotal = INITIAL_DEPOSIT + ADD_FUNDS_AMOUNT;
            chai_1.assert.equal(state.totalDeposit.toString(), expectedTotal.toString());
            chai_1.assert.equal(state.currentBalance.toString(), expectedTotal.toString());
            console.log(`Total deposit: ${state.totalDeposit} micro-USDC`);
            console.log(`Current balance: ${state.currentBalance} micro-USDC`);
            console.log('✓ Balance verified\n');
        });
        it('should close channel and return remaining funds', async () => {
            console.log('\n--- TEST: Closing Payment Channel ---');
            // Get client token account balance before close
            const clientTokenAccount = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, payer, usdcMint, clientKeypair.publicKey);
            const balanceBefore = await (0, spl_token_1.getAccount)(connection, clientTokenAccount.address);
            console.log(`Client USDC before close: ${balanceBefore.amount}`);
            const signature = await clientManager.closeChannel(channelId);
            console.log(`Close channel transaction: ${signature}`);
            chai_1.assert.isDefined(signature);
            // Wait for transaction
            await new Promise((resolve) => setTimeout(resolve, 3000));
            // Verify channel is closed on-chain
            const state = await (0, core_1.fetchChannelStateFromChain)(blockchainConfig, channelIdBuffer);
            console.log(`Final state: ${JSON.stringify(state, null, 2)}`);
            chai_1.assert.equal(state.status, core_2.ChannelStatus.Closed);
            chai_1.assert.equal(state.isOpen, false);
            // Verify funds returned to client
            const balanceAfter = await (0, spl_token_1.getAccount)(connection, clientTokenAccount.address);
            console.log(`Client USDC after close: ${balanceAfter.amount}`);
            // Balance should have increased by the channel deposit amount
            const expectedIncrease = INITIAL_DEPOSIT + ADD_FUNDS_AMOUNT;
            const actualIncrease = BigInt(balanceAfter.amount.toString()) - BigInt(balanceBefore.amount.toString());
            chai_1.assert.isTrue(actualIncrease >= expectedIncrease - BigInt(1000000), `Expected increase of at least ${expectedIncrease}, got ${actualIncrease}`);
            console.log('✓ Channel closed successfully\n');
        });
    });
    describe('Error Handling', () => {
        it('should fail to open channel with insufficient balance', async () => {
            console.log('\n--- TEST: Insufficient Balance Error ---');
            const poorClient = web3_js_1.Keypair.generate();
            // Airdrop SOL but no USDC
            const airdropSig = await connection.requestAirdrop(poorClient.publicKey, web3_js_1.LAMPORTS_PER_SOL);
            await connection.confirmTransaction(airdropSig);
            const config = (0, core_1.createChannelConfig)('localnet', PROGRAM_ID, {
                rpcUrl: connection.rpcEndpoint,
                usdcMint,
            });
            const poorManager = new core_1.ChannelManager(config, poorClient);
            let errorThrown = false;
            try {
                await poorManager.openChannel({
                    serverPubkey: serverKeypair.publicKey,
                    initialDeposit: INITIAL_DEPOSIT,
                });
            }
            catch (error) {
                errorThrown = true;
            }
            chai_1.assert.isTrue(errorThrown, 'Expected error to be thrown for insufficient balance');
            console.log('✓ Insufficient balance error handled correctly\n');
        });
        it('should fail to fetch non-existent channel', async () => {
            console.log('\n--- TEST: Non-existent Channel Error ---');
            const fakeChannelId = Buffer.alloc(32, 0xff);
            let errorThrown = false;
            try {
                await (0, core_1.fetchChannelStateFromChain)(blockchainConfig, fakeChannelId);
            }
            catch (error) {
                errorThrown = true;
            }
            chai_1.assert.isTrue(errorThrown, 'Expected error to be thrown for non-existent channel');
            console.log('✓ Non-existent channel error handled correctly\n');
        });
    });
    describe('Concurrent Operations', () => {
        it('should handle opening multiple channels concurrently', async () => {
            console.log('\n--- TEST: Multiple Concurrent Channels ---');
            const promises = [];
            for (let i = 0; i < 3; i++) {
                promises.push(clientManager.openChannel({
                    serverPubkey: serverKeypair.publicKey,
                    initialDeposit: BigInt(1000000),
                }));
            }
            const channelIds = await Promise.all(promises);
            console.log(`Opened ${channelIds.length} channels concurrently`);
            chai_1.assert.equal(channelIds.length, 3);
            chai_1.assert.equal(new Set(channelIds).size, 3); // All unique
            for (const id of channelIds) {
                console.log(`  Channel: ${id}`);
            }
            console.log('✓ Concurrent channels created successfully\n');
        });
    });
});
