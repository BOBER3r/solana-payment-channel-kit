/**
 * Demo Server - Batch Test with Full Channel Lifecycle
 * Shows side-by-side comparison of on-chain vs payment channels
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { ChannelPaymentVerifier } from '@x402-solana/core';
import { ChannelManager, createPaymentAuthorizationV2, createChannelConfig } from '@solana-payment-channel/core';
import bs58 from 'bs58';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Config
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID || 'H8SsYx7Z8qp12AvaX8oEWDCHWo8JYmEK21zWLWcfW4Zc';
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

const demoClientKey = Keypair.fromSecretKey(bs58.decode(process.env.DEMO_CLIENT_KEY!));
const serverWallet = new PublicKey(process.env.SERVER_WALLET!);

const connection = new Connection(RPC_URL, 'confirmed');
const channelVerifier = new ChannelPaymentVerifier({ connection, programId: PROGRAM_ID });
const channelConfig = createChannelConfig('devnet', PROGRAM_ID);
const channelManager = new ChannelManager(channelConfig, demoClientKey);

// Broadcast to all clients
function broadcast(data: any) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Run on-chain test
async function runOnChainTest(count: number, testId: string) {
  const results = {
    transactions: [] as any[],
    totalDuration: 0,
    totalCost: 0,
    errors: 0,
  };

  broadcast({ type: 'onchain-start', testId, count });

  const startTime = Date.now();

  for (let i = 0; i < count; i++) {
    const txStart = Date.now();

    try {
      // Get token accounts
      const clientTokenAccount = await getAssociatedTokenAddress(USDC_MINT, demoClientKey.publicKey);
      const serverTokenAccount = await getAssociatedTokenAddress(USDC_MINT, serverWallet);

      // Create USDC transfer
      const tx = new Transaction().add(
        createTransferInstruction(
          clientTokenAccount,
          serverTokenAccount,
          demoClientKey.publicKey,
          100_000 // $0.10
        )
      );

      const signature = await sendAndConfirmTransaction(connection, tx, [demoClientKey], { commitment: 'confirmed' });
      const duration = Date.now() - txStart;

      const txResult = {
        index: i + 1,
        signature,
        duration,
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
        status: 'success',
      };

      results.transactions.push(txResult);
      results.totalCost += 0.0005;

      broadcast({ type: 'onchain-tx', testId, ...txResult, progress: i + 1, total: count });

    } catch (error: any) {
      results.errors++;
      const txResult = {
        index: i + 1,
        error: error.message,
        duration: Date.now() - txStart,
        status: 'failed',
      };
      results.transactions.push(txResult);
      broadcast({ type: 'onchain-tx', testId, ...txResult, progress: i + 1, total: count });
    }
  }

  results.totalDuration = Date.now() - startTime;

  broadcast({ type: 'onchain-complete', testId, results });
  return results;
}

// Run channel test (full lifecycle)
async function runChannelTest(count: number, testId: string) {
  const results = {
    transactions: [] as any[],
    channelTx: {} as any,
    totalDuration: 0,
    totalCost: 0,
    errors: 0,
  };

  broadcast({ type: 'channel-start', testId, count });

  const fullStartTime = Date.now();

  try {
    // Step 1: Open channel
    broadcast({ type: 'channel-step', testId, step: 'opening', message: 'Creating payment channel...' });
    const channelStart = Date.now();

    const channelId = await channelManager.openChannel({
      serverPubkey: serverWallet,
      initialDeposit: BigInt(1_000_000), // $1.00 initial
      creditLimit: BigInt(500_000),      // $0.50 overdraft
    });

    const channelDuration = Date.now() - channelStart;
    const channelPDA = PublicKey.findProgramAddressSync(
      [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
      new PublicKey(PROGRAM_ID)
    )[0];

    results.channelTx.open = {
      step: 'open',
      duration: channelDuration,
      channelId,
      explorerUrl: `https://explorer.solana.com/address/${channelPDA.toString()}?cluster=devnet`,
    };
    results.totalCost += 0.0005;

    broadcast({ type: 'channel-opened', testId, channelId, duration: channelDuration, explorerUrl: results.channelTx.open.explorerUrl });

    // Step 2: Make off-chain payments
    broadcast({ type: 'channel-step', testId, step: 'payments', message: 'Making off-chain payments...' });

    // Fetch channel state to get the channel's expiry (all authorizations must use this)
    const channelState = await channelManager.getChannelState(channelId);
    const channelExpiry = BigInt(Math.floor(channelState.expiry.getTime() / 1000));

    let currentNonce = 1n;
    let cumulativeAmount = 0n;
    let latestAuthorization: { amount: bigint; nonce: bigint; signature: Buffer } | null = null;

    for (let i = 0; i < count; i++) {
      const paymentStart = Date.now();

      try {
        cumulativeAmount += 100_000n; // $0.10 per payment

        // Create off-chain signature using channel's expiry (NOT a new one!)
        const authorization = await createPaymentAuthorizationV2(
          new PublicKey(channelId),
          serverWallet,
          cumulativeAmount,
          currentNonce,
          channelExpiry,
          demoClientKey
        );

        // Track latest authorization for channel close (including expiry!)
        latestAuthorization = {
          amount: cumulativeAmount,
          nonce: currentNonce,
          signature: authorization.signature,
          expiry,
        };

        // Verify locally
        const verification = await channelVerifier.verifyChannelPayment(
          {
            channelId,
            amount: cumulativeAmount.toString(),
            nonce: currentNonce.toString(),
            signature: authorization.signature.toString('base64'),
            expiry: (BigInt(Math.floor(Date.now() / 1000) + 3600)).toString(),
          },
          serverWallet.toString(),
          { minClaimIncrement: '1000' }
        );

        const duration = Date.now() - paymentStart;

        if (verification.valid) {
          const txResult = {
            index: i + 1,
            nonce: Number(currentNonce),
            amount: '$0.10',
            cumulativeAmount: `$${(Number(cumulativeAmount) / 1_000_000).toFixed(2)}`,
            duration,
            signature: authorization.signature.toString('base64').substring(0, 16) + '...',
            status: 'verified',
            type: 'off-chain',
          };

          results.transactions.push(txResult);
          broadcast({ type: 'channel-payment', testId, ...txResult, progress: i + 1, total: count });

          currentNonce++;
        } else {
          throw new Error(verification.error || 'Verification failed');
        }
      } catch (error: any) {
        results.errors++;
        broadcast({ type: 'channel-payment', testId, index: i + 1, error: error.message, status: 'failed', progress: i + 1, total: count });
      }
    }

    // Step 3: Show overdraft (cumulative amount > initial deposit)
    if (cumulativeAmount > 1_000_000n) {
      broadcast({ type: 'channel-step', testId, step: 'overdraft', message: `Using overdraft: $${((Number(cumulativeAmount) - 1_000_000) / 1_000_000).toFixed(2)}` });
    }

    // Step 4: Add more funds (settle debt)
    broadcast({ type: 'channel-step', testId, step: 'funding', message: 'Adding funds to settle debt...' });
    const fundStart = Date.now();

    const fundSignature = await channelManager.addFunds(channelId, BigInt(2_000_000)); // Add $2
    const fundDuration = Date.now() - fundStart;

    results.channelTx.addFunds = {
      step: 'add_funds',
      duration: fundDuration,
      signature: fundSignature,
      explorerUrl: `https://explorer.solana.com/tx/${fundSignature}?cluster=devnet`,
    };
    results.totalCost += 0.0005;

    broadcast({ type: 'channel-funded', testId, signature: fundSignature, duration: fundDuration, explorerUrl: results.channelTx.addFunds.explorerUrl });

    // Step 5: Close channel and get refund
    broadcast({ type: 'channel-step', testId, step: 'closing', message: 'Closing channel and claiming refund...' });
    const closeStart = Date.now();

    // Provide latest authorization to ensure server gets paid before close
    if (!latestAuthorization) {
      throw new Error('No payments made - cannot close channel without authorization');
    }

    const closeSignature = await channelManager.closeChannel(
      channelId,
      latestAuthorization.amount,
      latestAuthorization.nonce,
      new Uint8Array(latestAuthorization.signature),
      latestAuthorization.expiry
    );
    const closeDuration = Date.now() - closeStart;

    results.channelTx.close = {
      step: 'close',
      duration: closeDuration,
      signature: closeSignature,
      explorerUrl: `https://explorer.solana.com/tx/${closeSignature}?cluster=devnet`,
    };
    results.totalCost += 0.0005;

    broadcast({ type: 'channel-closed', testId, signature: closeSignature, duration: closeDuration, explorerUrl: results.channelTx.close.explorerUrl });

  } catch (error: any) {
    results.errors++;
    broadcast({ type: 'channel-error', testId, error: error.message });
  }

  results.totalDuration = Date.now() - fullStartTime;

  broadcast({ type: 'channel-complete', testId, results });
  return results;
}

// Endpoint: Run batch test
app.post('/api/run-batch-test', async (req, res) => {
  const { count = 10 } = req.body;
  const testId = `test_${Date.now()}`;

  console.log(`🚀 Starting batch test: ${count} transactions per method`);

  // Start both tests in parallel
  Promise.all([
    runOnChainTest(count, testId),
    runChannelTest(count, testId),
  ]).then(([onChainResults, channelResults]) => {
    console.log('✅ Batch test complete');

    const comparison = {
      speedImprovement: ((1 - channelResults.totalDuration / onChainResults.totalDuration) * 100).toFixed(0),
      costSavings: (onChainResults.totalCost - channelResults.totalCost).toFixed(4),
      timeSaved: Math.round((onChainResults.totalDuration - channelResults.totalDuration) / 1000),
    };

    broadcast({ type: 'test-complete', testId, onChainResults, channelResults, comparison });
  }).catch(error => {
    console.error('❌ Batch test failed:', error);
    broadcast({ type: 'test-error', testId, error: error.message });
  });

  res.json({ success: true, testId, message: 'Test started. Connect to WebSocket for real-time updates.' });
});

// WebSocket connection
wss.on('connection', (ws) => {
  console.log('📡 Client connected');
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to demo server' }));
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Demo server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket available at ws://localhost:${PORT}`);
  console.log(`📍 Client: ${demoClientKey.publicKey.toString()}`);
  console.log(`📍 Server: ${serverWallet.toString()}`);
});
