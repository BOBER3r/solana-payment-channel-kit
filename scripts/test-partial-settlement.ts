/**
 * Test Partial Settlement - Proves remaining funds go back to CLIENT
 *
 * Scenario:
 * 1. Client deposits 100 USDC
 * 2. Client authorizes only 30 USDC
 * 3. Server claims 30 USDC
 * 4. Client closes channel
 * 5. Client should receive 70 USDC back!
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ChannelManager, createPaymentAuthorizationV2 } from '../packages/core/dist/index.js';
import { ServerChannelManager } from '../packages/server/dist/index.js';
import { getAccount } from '@solana/spl-token';
import * as fs from 'fs';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = 'H8SsYx7Z8qp12AvaX8oEWDCHWo8JYmEK21zWLWcfW4Zc';
const TEST_USDC_MINT = '8UAFd3yrj6XRNKDcSKAt4smgUfxXTTDZmXaM2y61MAC3';

async function main() {
  console.log('\n🧪 PARTIAL SETTLEMENT TEST');
  console.log('Testing that remaining funds go back to CLIENT\n');

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const clientKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/Users/bober4ik/my-solana-wallet.json', 'utf-8')))
  );
  const serverKeypair = Keypair.generate();

  // Setup
  const { SystemProgram, Transaction, sendAndConfirmTransaction, getOrCreateAssociatedTokenAccount } = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token');

  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: clientKeypair.publicKey,
      toPubkey: serverKeypair.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [clientKeypair]);

  const usdcMint = new PublicKey(TEST_USDC_MINT);
  const serverUsdcAccount = await spl.getOrCreateAssociatedTokenAccount(
    connection,
    clientKeypair,
    usdcMint,
    serverKeypair.publicKey
  );

  // Get client's initial USDC balance
  const clientUsdcAccount = await spl.getAssociatedTokenAddress(usdcMint, clientKeypair.publicKey);
  const initialBalance = await connection.getTokenAccountBalance(clientUsdcAccount);
  console.log(`💰 Client initial balance: ${(Number(initialBalance.value.amount) / 1_000_000).toFixed(2)} USDC\n`);

  const config = {
    rpcUrl: DEVNET_RPC,
    network: 'devnet' as const,
    programId: new PublicKey(PROGRAM_ID),
    usdcMint: new PublicKey(TEST_USDC_MINT),
  };

  const manager = new ChannelManager(config, clientKeypair);
  const serverManager = new ServerChannelManager(config, serverKeypair);

  // STEP 1: Open channel with 100 USDC
  console.log('📖 Opening channel with 100 USDC...');
  const channelId = await manager.openChannel({
    serverPubkey: serverKeypair.publicKey,
    initialDeposit: BigInt(100_000_000), // 100 USDC
  });
  console.log(`✅ Channel opened: ${channelId}\n`);

  // STEP 2: Make only 3 payments totaling 30 USDC
  console.log('📡 Making only 3 payments (30 USDC total)...');
  const channelState = await manager.getChannelState(channelId);
  let cumulativeAmount = BigInt(0);
  let nonce = BigInt(1);

  for (let i = 0; i < 3; i++) {
    cumulativeAmount += BigInt(10_000_000); // 10 USDC each

    const [channelPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
      new PublicKey(PROGRAM_ID)
    );

    const authorization = await createPaymentAuthorizationV2(
      channelPDA,
      serverKeypair.publicKey,
      cumulativeAmount,
      nonce,
      BigInt(Math.floor(channelState.expiry.getTime() / 1000)),
      clientKeypair
    );

    await serverManager.acceptPayment(channelId, authorization);
    nonce++;
  }
  console.log(`✅ 3 payments accepted (30 USDC total)\n`);

  // STEP 3: Server claims 30 USDC
  console.log('⛓️  Server claiming 30 USDC...');
  const claimResult = await serverManager.claimBatch(channelId);
  console.log(`✅ Server claimed: ${(Number(claimResult.claimedAmount) / 1_000_000).toFixed(2)} USDC\n`);

  // STEP 4: Close channel - client should get 70 USDC back!
  console.log('🔒 Closing channel...');
  const beforeClose = await manager.getChannelState(channelId, true);
  console.log(`   Deposited: ${(Number(beforeClose.totalDeposit) / 1_000_000).toFixed(2)} USDC`);
  console.log(`   Claimed: ${(Number(beforeClose.claimedAmount) / 1_000_000).toFixed(2)} USDC`);
  console.log(`   Should return: ${(Number(beforeClose.totalDeposit - beforeClose.claimedAmount) / 1_000_000).toFixed(2)} USDC\n`);

  await manager.closeChannel(channelId);

  // STEP 5: Verify client received the remaining 70 USDC
  const finalBalance = await connection.getTokenAccountBalance(clientUsdcAccount);
  const returned = Number(finalBalance.value.amount) - Number(initialBalance.value.amount);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Initial balance: ${(Number(initialBalance.value.amount) / 1_000_000).toFixed(2)} USDC`);
  console.log(`Final balance:   ${(Number(finalBalance.value.amount) / 1_000_000).toFixed(2)} USDC`);
  console.log(`Returned:        ${(returned / 1_000_000).toFixed(2)} USDC`);
  console.log('');

  if (returned === 70_000_000) {
    console.log('✅ SUCCESS! Client received 70 USDC back!');
    console.log('✅ Remaining funds correctly returned to CLIENT, not server!');
  } else {
    console.log(`❌ FAILED! Expected 70 USDC, got ${(returned / 1_000_000).toFixed(2)} USDC`);
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
