/**
 * Blockchain transaction implementations for payment channels
 * This module replaces all mock transactions with real Solana/Anchor calls
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  Commitment,
  ConfirmOptions,
  Ed25519Program,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { ChannelState, ChannelStatus } from '../types';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
// Import the generated TypeScript types from our package
import { PaymentChannel } from '../types/program/payment_channel';
import { serializeClaimMessage } from '../crypto/message';
// Import IDL - using require for JSON compatibility
import IDL_JSON from '../types/program/payment_channel.json';

const IDL = IDL_JSON as unknown as PaymentChannel;

/**
 * Configuration for blockchain operations
 */
export interface BlockchainConfig {
  connection: Connection;
  programId: PublicKey;
  usdcMint: PublicKey;
  commitment?: Commitment;
}

/**
 * Transaction confirmation options
 */
const DEFAULT_CONFIRM_OPTIONS: ConfirmOptions = {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
  skipPreflight: false,
  maxRetries: 3,
};

/**
 * Retry configuration for transaction confirmation
 */
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

/**
 * Derives the PDA for a payment channel
 */
export function getChannelPDA(
  channelId: Buffer,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('channel'), channelId],
    programId
  );
}

/**
 * Derives the PDA for a channel's token account
 * Uses seeds: [b"channel_token", channel_id]
 */
export function getChannelTokenAccount(
  channelId: Buffer,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('channel_token'), channelId],
    programId
  );
}

/**
 * Wait for transaction confirmation with retries
 */
async function confirmTransactionWithRetry(
  connection: Connection,
  signature: string,
  commitment: Commitment = 'confirmed'
): Promise<void> {
  let attempt = 0;
  let delay = RETRY_CONFIG.initialDelay;

  while (attempt < RETRY_CONFIG.maxRetries) {
    try {
      const confirmation = await connection.confirmTransaction(
        signature,
        commitment
      );

      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      return;
    } catch (error) {
      attempt++;
      if (attempt >= RETRY_CONFIG.maxRetries) {
        throw new Error(
          `Transaction confirmation failed after ${RETRY_CONFIG.maxRetries} attempts: ${error}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelay);
    }
  }
}

/**
 * Ensures an associated token account exists, creates it if not
 */
async function ensureTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false
): Promise<PublicKey> {
  const tokenAccount = await getAssociatedTokenAddress(
    mint,
    owner,
    allowOwnerOffCurve
  );

  try {
    await getAccount(connection, tokenAccount);
    return tokenAccount;
  } catch (error) {
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        tokenAccount,
        owner,
        mint
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [payer], {
      commitment: 'confirmed',
    });

    return tokenAccount;
  }
}

/**
 * Creates an Anchor program instance
 * Note: Using 2-argument constructor for IDL spec 0.1.0 which embeds program address
 */
function createProgramInstance(
  connection: Connection,
  wallet: Keypair,
  programId: PublicKey
): anchor.Program<PaymentChannel> {
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: async (tx) => {
        // Type narrowing: check if it's a legacy Transaction
        if ('partialSign' in tx) {
          tx.partialSign(wallet);
        } else {
          // For VersionedTransaction, use sign method
          tx.sign([wallet]);
        }
        return tx;
      },
      signAllTransactions: async (txs) => {
        txs.forEach((tx) => {
          // Type narrowing: check if it's a legacy Transaction
          if ('partialSign' in tx) {
            tx.partialSign(wallet);
          } else {
            // For VersionedTransaction, use sign method
            tx.sign([wallet]);
          }
        });
        return txs;
      },
    },
    DEFAULT_CONFIRM_OPTIONS
  );
  // Use 2-argument constructor - IDL spec 0.1.0 embeds program address
  const program = new anchor.Program<PaymentChannel>(IDL as any, provider);
  return program;
}

/**
 * Opens a new payment channel on-chain
 */
export async function sendOpenChannelTransaction(
  config: BlockchainConfig,
  wallet: Keypair,
  channelId: Buffer,
  serverPubkey: PublicKey,
  deposit: bigint,
  expiry: Date,
  creditLimit: bigint = BigInt(0)
): Promise<string> {
  const program = createProgramInstance(config.connection, wallet, config.programId);

  const [channelPDA, bump] = getChannelPDA(channelId, config.programId);

  // Ensure client has a token account (ATA)
  const clientTokenAccount = await ensureTokenAccount(
    config.connection,
    wallet,
    config.usdcMint,
    wallet.publicKey
  );

  // Derive channel token account PDA (program will initialize it)
  const [channelTokenAccount] = getChannelTokenAccount(channelId, config.programId);

  const expiryTimestamp = new BN(Math.floor(expiry.getTime() / 1000));
  const depositAmount = new BN(deposit.toString());
  const creditLimitAmount = new BN(creditLimit.toString());

  try {
    const signature = await program.methods
      .openChannel(Array.from(channelId), depositAmount, expiryTimestamp, creditLimitAmount)
      .accounts({
        channel: channelPDA,
        client: wallet.publicKey,
        server: serverPubkey,
        clientTokenAccount,
        channelTokenAccount,
        usdcMint: config.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([wallet])
      .rpc();

    await confirmTransactionWithRetry(
      config.connection,
      signature,
      config.commitment
    );

    return signature;
  } catch (error) {
    throw new Error(
      `Failed to open channel: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Adds funds to an existing payment channel
 */
export async function sendAddFundsTransaction(
  config: BlockchainConfig,
  wallet: Keypair,
  channelId: Buffer,
  amount: bigint
): Promise<string> {
  const program = createProgramInstance(config.connection, wallet, config.programId);

  const [channelPDA] = getChannelPDA(channelId, config.programId);

  // Fetch channel to get server pubkey
  const channelAccount = await program.account.paymentChannel.fetch(channelPDA);

  const clientTokenAccount = await getAssociatedTokenAddress(
    config.usdcMint,
    wallet.publicKey
  );

  // Get server's token account (should already exist)
  const serverTokenAccount = await getAssociatedTokenAddress(
    config.usdcMint,
    channelAccount.server
  );

  // Use PDA for channel token account
  const [channelTokenAccount] = getChannelTokenAccount(channelId, config.programId);

  const amountBN = new BN(amount.toString());

  try {
    const signature = await program.methods
      .addFunds(amountBN)
      .accounts({
        channel: channelPDA,
        channelTokenAccount,
        client: wallet.publicKey,
        clientTokenAccount,
        serverTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([wallet])
      .rpc();

    await confirmTransactionWithRetry(
      config.connection,
      signature,
      config.commitment
    );

    return signature;
  } catch (error) {
    throw new Error(
      `Failed to add funds: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Closes a payment channel and returns remaining funds to client
 * Requires the client's latest payment authorization to auto-claim for server
 */
export async function sendCloseChannelTransaction(
  config: BlockchainConfig,
  wallet: Keypair,
  channelId: Buffer,
  clientPubkey: PublicKey,
  latestAmount: bigint,
  latestNonce: bigint,
  latestSignature: Uint8Array
): Promise<string> {
  const program = createProgramInstance(config.connection, wallet, config.programId);

  const [channelPDA] = getChannelPDA(channelId, config.programId);

  // Fetch channel to get server pubkey
  const channelAccount = await program.account.paymentChannel.fetch(channelPDA);

  // Use PDA for channel token account
  const [channelTokenAccount] = getChannelTokenAccount(channelId, config.programId);

  const clientTokenAccount = await getAssociatedTokenAddress(
    config.usdcMint,
    clientPubkey
  );

  const serverTokenAccount = await getAssociatedTokenAddress(
    config.usdcMint,
    channelAccount.server
  );

  const amountBN = new BN(latestAmount.toString());
  const nonceBN = new BN(latestNonce.toString());
  const signatureArray = Array.from(latestSignature);

  try {
    const signature = await program.methods
      .closeChannel(amountBN, nonceBN, signatureArray)
      .accounts({
        channel: channelPDA,
        channelTokenAccount,
        closer: wallet.publicKey,
        client: clientPubkey,
        clientTokenAccount,
        serverTokenAccount,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([wallet])
      .rpc();

    await confirmTransactionWithRetry(
      config.connection,
      signature,
      config.commitment
    );

    return signature;
  } catch (error) {
    throw new Error(
      `Failed to close channel: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Fetches channel state from the blockchain
 */
export async function fetchChannelStateFromChain(
  config: BlockchainConfig,
  channelId: Buffer
): Promise<ChannelState> {
  const program = createProgramInstance(
    config.connection,
    Keypair.generate(), // Dummy keypair for read-only operations
    config.programId
  );

  const [channelPDA] = getChannelPDA(channelId, config.programId);

  try {
    const channelAccount: any = await (program.account as any).paymentChannel.fetch(channelPDA);

    const statusMap = {
      open: ChannelStatus.Open,
      closed: ChannelStatus.Closed,
      disputed: ChannelStatus.Disputed,
    };

    const statusKey = Object.keys(channelAccount.status)[0] as keyof typeof statusMap;
    const status = statusMap[statusKey] || ChannelStatus.Closed;

    return {
      channelId: channelId.toString('hex'),
      clientPubkey: channelAccount.client.toBase58(),
      serverPubkey: channelAccount.server.toBase58(),
      totalDeposit: BigInt(channelAccount.clientDeposit.toString()),
      currentBalance:
        BigInt(channelAccount.clientDeposit.toString()) -
        BigInt(channelAccount.serverClaimed.toString()),
      claimedAmount: BigInt(channelAccount.serverClaimed.toString()),
      nonce: BigInt(channelAccount.nonce.toString()),
      expiry: new Date(channelAccount.expiry.toNumber() * 1000),
      status,
      isOpen: status === ChannelStatus.Open,
    };
  } catch (error) {
    throw new Error(
      `Channel not found or failed to fetch: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Server claims payment with client signature
 */
export async function sendClaimPaymentTransaction(
  config: BlockchainConfig,
  serverWallet: Keypair,
  channelId: Buffer,
  amount: bigint,
  nonce: bigint,
  clientSignature: Uint8Array
): Promise<string> {
  const program = createProgramInstance(
    config.connection,
    serverWallet,
    config.programId
  );

  const [channelPDA] = getChannelPDA(channelId, config.programId);

  // Fetch channel state to get client pubkey and expiry
  const channelState = await fetchChannelStateFromChain(config, channelId);
  const clientPubkey = new PublicKey(channelState.clientPubkey);
  const expiry = BigInt(Math.floor(channelState.expiry.getTime() / 1000));

  // Serialize the claim message (same format as client used for signing)
  const message = serializeClaimMessage({
    channelId: channelPDA,
    server: serverWallet.publicKey,
    amount,
    nonce,
    expiry,
  });

  // Create Ed25519 verification instruction
  // This must be placed immediately before the claim instruction
  const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
    publicKey: clientPubkey.toBytes(),
    message,
    signature: clientSignature,
  });

  // Use PDA for channel token account
  const [channelTokenAccount] = getChannelTokenAccount(channelId, config.programId);

  const serverTokenAccount = await getAssociatedTokenAddress(
    config.usdcMint,
    serverWallet.publicKey
  );

  const amountBN = new BN(amount.toString());
  const nonceBN = new BN(nonce.toString());
  const signatureArray = Array.from(clientSignature);

  try {
    // Build the claim instruction (don't execute yet)
    const claimInstruction = await program.methods
      .claimPayment(amountBN, nonceBN, signatureArray)
      .accounts({
        channel: channelPDA,
        server: serverWallet.publicKey,
        channelTokenAccount,
        serverTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      } as any)
      .instruction();

    // Create transaction with both instructions
    // Ed25519 verification MUST come first
    const transaction = new Transaction().add(ed25519Instruction).add(claimInstruction);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await getRecentBlockhashWithRetry(
      config.connection
    );
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = serverWallet.publicKey;

    // Sign and send
    transaction.sign(serverWallet);
    const signature = await config.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: config.commitment || 'confirmed',
    });

    await confirmTransactionWithRetry(
      config.connection,
      signature,
      config.commitment
    );

    return signature;
  } catch (error) {
    throw new Error(
      `Failed to claim payment: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Simulates a transaction before sending
 */
export async function simulateTransaction(
  config: BlockchainConfig,
  transaction: Transaction
): Promise<void> {
  try {
    const simulation = await config.connection.simulateTransaction(transaction);

    if (simulation.value.err) {
      throw new Error(
        `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`
      );
    }
  } catch (error) {
    throw new Error(
      `Transaction simulation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Gets recent blockhash with retry
 */
export async function getRecentBlockhashWithRetry(
  connection: Connection
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  let attempt = 0;
  let delay = RETRY_CONFIG.initialDelay;

  while (attempt < RETRY_CONFIG.maxRetries) {
    try {
      return await connection.getLatestBlockhash('confirmed');
    } catch (error) {
      attempt++;
      if (attempt >= RETRY_CONFIG.maxRetries) {
        throw new Error(
          `Failed to get recent blockhash after ${RETRY_CONFIG.maxRetries} attempts: ${error}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelay);
    }
  }

  throw new Error('Failed to get recent blockhash');
}
