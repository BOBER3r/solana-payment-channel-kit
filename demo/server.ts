/**
 * Minimal Demo Server - Hackathon Version
 * Two endpoints: on-chain payment vs channel payment
 * Just proves it works with real transactions
 */

import express from 'express';
import cors from 'cors';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { ChannelPaymentVerifier } from '@x402-solana/core';
import { ChannelManager, createPaymentAuthorizationV2, createChannelConfig } from '@solana-payment-channel/core';
import bs58 from 'bs58';

const app = express();
app.use(cors());
app.use(express.json());

// Config
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID || 'H8SsYx7Z8qp12AvaX8oEWDCHWo8JYmEK21zWLWcfW4Zc';
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Devnet USDC

// Demo wallet (pre-funded)
const demoClientKey = Keypair.fromSecretKey(
  bs58.decode(process.env.DEMO_CLIENT_KEY!)
);
const serverWallet = new PublicKey(process.env.SERVER_WALLET!);

const connection = new Connection(RPC_URL, 'confirmed');
const channelVerifier = new ChannelPaymentVerifier({
  connection,
  programId: PROGRAM_ID,
});

// Channel manager for auto-creating channels
const channelConfig = createChannelConfig('devnet', PROGRAM_ID);
const channelManager = new ChannelManager(channelConfig, demoClientKey);

// State
let channelId: string | null = null; // Will be created on startup
let currentNonce = 1n;
const transactions: any[] = [];

// Endpoint 1: Test on-chain payment
app.post('/api/test/on-chain', async (req, res) => {
  const startTime = Date.now();

  try {
    console.log('🔶 Starting on-chain payment...');

    // Get token accounts
    const clientTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      demoClientKey.publicKey
    );
    const serverTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      serverWallet
    );

    // Create USDC transfer (0.10 USDC = 100,000 micro-USDC)
    const tx = new Transaction().add(
      createTransferInstruction(
        clientTokenAccount,
        serverTokenAccount,
        demoClientKey.publicKey,
        100_000 // $0.10
      )
    );

    // Send transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [demoClientKey],
      { commitment: 'confirmed' }
    );

    const duration = Date.now() - startTime;
    const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

    const result = {
      type: 'on-chain',
      signature,
      explorerUrl,
      amount: '$0.10',
      fee: '$0.0005',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      accounts: {
        from: demoClientKey.publicKey.toString(),
        to: serverWallet.toString(),
      },
    };

    transactions.push(result);
    console.log('✅ On-chain payment confirmed:', signature);

    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('❌ On-chain payment failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      duration: `${Date.now() - startTime}ms`,
    });
  }
});

// Endpoint 2: Test channel payment
app.post('/api/test/channel', async (req, res) => {
  const startTime = Date.now();

  try {
    console.log('⚡ Starting channel payment...');

    if (!channelId) {
      return res.status(503).json({
        success: false,
        error: 'Channel not initialized yet. Please wait a moment and try again.',
      });
    }

    // Create off-chain signature
    const authorization = await createPaymentAuthorizationV2(
      new PublicKey(channelId),
      serverWallet,
      100_000n, // $0.10
      currentNonce,
      BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour expiry
      demoClientKey
    );

    // Verify signature (server-side verification)
    const verification = await channelVerifier.verifyChannelPayment(
      {
        channelId,
        amount: 100_000n,
        nonce: currentNonce,
        signature: authorization.signature,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      },
      serverWallet.toString(),
      { minClaimIncrement: 1000n }
    );

    if (!verification.valid) {
      throw new Error(verification.error || 'Signature verification failed');
    }

    const duration = Date.now() - startTime;
    const channelPDA = PublicKey.findProgramAddressSync(
      [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
      new PublicKey(PROGRAM_ID)
    )[0];

    const result = {
      type: 'channel',
      signature: authorization.signature.toString('base64').substring(0, 16) + '...',
      explorerUrl: `https://explorer.solana.com/address/${channelPDA.toString()}?cluster=devnet`,
      amount: '$0.10',
      fee: '$0.00',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      nonce: Number(currentNonce),
      accounts: {
        channelId,
        channelPDA: channelPDA.toString(),
        client: demoClientKey.publicKey.toString(),
        server: serverWallet.toString(),
      },
    };

    transactions.push(result);
    currentNonce++;

    console.log('✅ Channel payment verified (off-chain)');

    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('❌ Channel payment failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      duration: `${Date.now() - startTime}ms`,
    });
  }
});

// Get all transactions
app.get('/api/transactions', (req, res) => {
  res.json({ transactions });
});

// Get account info
app.get('/api/accounts', async (req, res) => {
  try {
    // Get balances
    const clientBalance = await connection.getBalance(demoClientKey.publicKey);
    const clientTokenAccount = await getAssociatedTokenAddress(USDC_MINT, demoClientKey.publicKey);
    const clientUSDC = await connection.getTokenAccountBalance(clientTokenAccount);

    const serverTokenAccount = await getAssociatedTokenAddress(USDC_MINT, serverWallet);
    const serverUSDC = await connection.getTokenAccountBalance(serverTokenAccount);

    // Get channel state
    const channelPDA = PublicKey.findProgramAddressSync(
      [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
      new PublicKey(PROGRAM_ID)
    )[0];
    const channelAccount = await connection.getAccountInfo(channelPDA);

    res.json({
      client: {
        publicKey: demoClientKey.publicKey.toString(),
        solBalance: (clientBalance / 1e9).toFixed(4),
        usdcBalance: clientUSDC.value.uiAmount,
        explorerUrl: `https://explorer.solana.com/address/${demoClientKey.publicKey.toString()}?cluster=devnet`,
      },
      server: {
        publicKey: serverWallet.toString(),
        usdcBalance: serverUSDC.value.uiAmount,
        explorerUrl: `https://explorer.solana.com/address/${serverWallet.toString()}?cluster=devnet`,
      },
      channel: {
        id: channelId,
        pda: channelPDA.toString(),
        exists: channelAccount !== null,
        explorerUrl: `https://explorer.solana.com/address/${channelPDA.toString()}?cluster=devnet`,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get stats
app.get('/api/stats', (req, res) => {
  const onChainTxs = transactions.filter(t => t.type === 'on-chain');
  const channelTxs = transactions.filter(t => t.type === 'channel');

  const avgDuration = (txs: any[]) => {
    if (txs.length === 0) return 0;
    const total = txs.reduce((sum, t) => sum + parseInt(t.duration), 0);
    return Math.round(total / txs.length);
  };

  res.json({
    onChain: {
      count: onChainTxs.length,
      avgDuration: avgDuration(onChainTxs),
      totalCost: (onChainTxs.length * 0.0005).toFixed(4),
    },
    channel: {
      count: channelTxs.length,
      avgDuration: avgDuration(channelTxs),
      totalCost: '$0.00',
      note: 'Costs incurred only when claiming on-chain (batch)',
    },
  });
});

// Initialize demo environment
async function initializeDemoEnvironment() {
  console.log('🔧 Initializing demo environment...');

  try {
    // Check if we already have a channel with the server
    console.log('🔍 Checking for existing channels...');
    const existingChannels = await channelManager.getAllChannels(demoClientKey.publicKey);

    // Find a channel with this server
    const existingChannel = existingChannels.find(
      ch => ch.server.toString() === serverWallet.toString() && !ch.is_closed
    );

    if (existingChannel) {
      channelId = existingChannel.channel_id;
      currentNonce = existingChannel.nonce + 1n;
      console.log(`✅ Using existing channel: ${channelId}`);
      console.log(`   Starting nonce: ${currentNonce}`);
    } else {
      // Create a new channel
      console.log('📡 Opening new payment channel...');
      console.log(`   Initial deposit: 10 USDC`);
      console.log(`   Credit limit: 5 USDC`);

      channelId = await channelManager.openChannel({
        serverPubkey: serverWallet,
        initialDeposit: BigInt(10_000_000), // 10 USDC
        creditLimit: BigInt(5_000_000),      // 5 USDC credit
      });

      console.log(`✅ Channel opened: ${channelId}`);
      currentNonce = 1n;
    }

    const channelPDA = PublicKey.findProgramAddressSync(
      [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
      new PublicKey(PROGRAM_ID)
    )[0];

    console.log(`🔗 Explorer: https://explorer.solana.com/address/${channelPDA.toString()}?cluster=devnet`);

  } catch (error: any) {
    console.error('❌ Failed to initialize channel:', error.message);
    console.error('⚠️  Channel payments will not work, but on-chain payments will still function.');
  }
}

// Start server
const PORT = process.env.PORT || 3001;

async function startServer() {
  await initializeDemoEnvironment();

  app.listen(PORT, () => {
    console.log(`\n✅ Demo server running on http://localhost:${PORT}`);
    console.log(`📍 Client wallet: ${demoClientKey.publicKey.toString()}`);
    console.log(`📍 Server wallet: ${serverWallet.toString()}`);
    if (channelId) {
      console.log(`📍 Channel ID: ${channelId}`);
    }
    console.log(`\n👉 Open http://localhost:${PORT} in your browser to test!`);
  });
}

startServer().catch(console.error);
