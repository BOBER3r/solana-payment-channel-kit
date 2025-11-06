import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PaymentChannel } from "../target/types/payment_channel";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import * as nacl from "tweetnacl";

describe("payment-channel", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PaymentChannel as Program<PaymentChannel>;

  // Test accounts
  let client: Keypair;
  let server: Keypair;
  let usdcMint: PublicKey;
  let clientTokenAccount: PublicKey;
  let serverTokenAccount: PublicKey;

  // Channel parameters
  let channelId: Buffer;
  let channelPda: PublicKey;
  let channelTokenAccount: PublicKey;
  let channelBump: number;

  const INITIAL_DEPOSIT = 100_000_000; // 100 USDC (6 decimals)
  const PAYMENT_AMOUNT = 5_000_000; // 5 USDC

  before(async () => {
    // Create test wallets
    client = Keypair.generate();
    server = Keypair.generate();

    // Airdrop SOL for transaction fees
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        client.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        server.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    // Create USDC mint (simulated)
    usdcMint = await createMint(
      provider.connection,
      client,
      client.publicKey,
      null,
      6 // USDC has 6 decimals
    );

    // Create token accounts
    clientTokenAccount = await createAccount(
      provider.connection,
      client,
      usdcMint,
      client.publicKey
    );

    serverTokenAccount = await createAccount(
      provider.connection,
      server,
      usdcMint,
      server.publicKey
    );

    // Mint USDC to client
    await mintTo(
      provider.connection,
      client,
      usdcMint,
      clientTokenAccount,
      client.publicKey,
      1_000_000_000 // 1000 USDC
    );

    // Generate channel ID
    channelId = Buffer.from(
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
    );

    // Derive channel PDA
    [channelPda, channelBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), channelId],
      program.programId
    );

    // Derive channel token account PDA
    [channelTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel_token"), channelId],
      program.programId
    );

    console.log("Test Setup Complete:");
    console.log("  Client:", client.publicKey.toBase58());
    console.log("  Server:", server.publicKey.toBase58());
    console.log("  USDC Mint:", usdcMint.toBase58());
    console.log("  Channel ID:", channelId.toString("hex"));
    console.log("  Channel PDA:", channelPda.toBase58());
  });

  it("Opens a payment channel", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now

    const tx = await program.methods
      .openChannel(Array.from(channelId), new anchor.BN(INITIAL_DEPOSIT), new anchor.BN(expiry))
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        client: client.publicKey,
        server: server.publicKey,
        clientTokenAccount: clientTokenAccount,
        usdcMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([client])
      .rpc();

    console.log("  Channel opened, tx:", tx);

    // Verify channel state
    const channelAccount = await program.account.paymentChannel.fetch(channelPda);

    assert.deepEqual(
      channelAccount.channelId,
      Array.from(channelId),
      "Channel ID mismatch"
    );
    assert.equal(
      channelAccount.client.toBase58(),
      client.publicKey.toBase58(),
      "Client mismatch"
    );
    assert.equal(
      channelAccount.server.toBase58(),
      server.publicKey.toBase58(),
      "Server mismatch"
    );
    assert.equal(
      channelAccount.clientDeposit.toNumber(),
      INITIAL_DEPOSIT,
      "Deposit mismatch"
    );
    assert.equal(channelAccount.serverClaimed.toNumber(), 0, "Server claimed should be 0");
    assert.equal(channelAccount.nonce.toNumber(), 0, "Nonce should be 0");
    assert.deepEqual(channelAccount.status, { open: {} }, "Status should be Open");

    // Verify token transfer
    const clientBalance = await getAccount(provider.connection, clientTokenAccount);
    const channelBalance = await getAccount(provider.connection, channelTokenAccount);

    assert.equal(
      clientBalance.amount.toString(),
      (1_000_000_000 - INITIAL_DEPOSIT).toString(),
      "Client balance incorrect"
    );
    assert.equal(
      channelBalance.amount.toString(),
      INITIAL_DEPOSIT.toString(),
      "Channel balance incorrect"
    );
  });

  it("Adds funds to an existing channel", async () => {
    const additionalFunds = 50_000_000; // 50 USDC

    const tx = await program.methods
      .addFunds(new anchor.BN(additionalFunds))
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        client: client.publicKey,
        clientTokenAccount: clientTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    console.log("  Funds added, tx:", tx);

    // Verify channel state
    const channelAccount = await program.account.paymentChannel.fetch(channelPda);
    assert.equal(
      channelAccount.clientDeposit.toNumber(),
      INITIAL_DEPOSIT + additionalFunds,
      "Deposit not updated"
    );

    // Verify token transfer
    const channelBalance = await getAccount(provider.connection, channelTokenAccount);
    assert.equal(
      channelBalance.amount.toString(),
      (INITIAL_DEPOSIT + additionalFunds).toString(),
      "Channel balance incorrect"
    );
  });

  it("Claims payment with valid signature", async () => {
    const claimAmount = PAYMENT_AMOUNT;
    const nonce = 1;

    // Create message to sign
    const message = createClaimMessage(
      channelId,
      server.publicKey,
      claimAmount,
      nonce
    );

    // Client signs the message
    const signature = nacl.sign.detached(message, client.secretKey);

    // Create Ed25519 signature verification instruction
    const ed25519Ix = createEd25519VerifyInstruction(
      message,
      signature,
      client.publicKey.toBytes()
    );

    // Get channel account before claim
    const channelBefore = await program.account.paymentChannel.fetch(channelPda);
    const serverBalanceBefore = await getAccount(provider.connection, serverTokenAccount);

    // Claim payment instruction
    const claimIx = await program.methods
      .claimPayment(
        new anchor.BN(claimAmount),
        new anchor.BN(nonce),
        Array.from(signature)
      )
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        server: server.publicKey,
        serverTokenAccount: serverTokenAccount,
        instructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // Send transaction with Ed25519 verification first
    const tx = new Transaction().add(ed25519Ix).add(claimIx);
    await provider.sendAndConfirm(tx, [server]);

    console.log("  Payment claimed");

    // Verify channel state
    const channelAfter = await program.account.paymentChannel.fetch(channelPda);
    assert.equal(
      channelAfter.serverClaimed.toNumber(),
      claimAmount,
      "Server claimed amount incorrect"
    );
    assert.equal(channelAfter.nonce.toNumber(), nonce, "Nonce not updated");

    // Verify token transfer
    const serverBalanceAfter = await getAccount(provider.connection, serverTokenAccount);
    assert.equal(
      serverBalanceAfter.amount.toString(),
      (Number(serverBalanceBefore.amount) + claimAmount).toString(),
      "Server balance not updated correctly"
    );
  });

  it("Claims incremental payments", async () => {
    const firstClaim = PAYMENT_AMOUNT; // Already claimed in previous test
    const secondClaim = firstClaim + PAYMENT_AMOUNT; // Cumulative
    const nonce = 2;

    // Create and sign message
    const message = createClaimMessage(
      channelId,
      server.publicKey,
      secondClaim,
      nonce
    );
    const signature = nacl.sign.detached(message, client.secretKey);

    const ed25519Ix = createEd25519VerifyInstruction(
      message,
      signature,
      client.publicKey.toBytes()
    );

    const serverBalanceBefore = await getAccount(provider.connection, serverTokenAccount);

    const claimIx = await program.methods
      .claimPayment(
        new anchor.BN(secondClaim),
        new anchor.BN(nonce),
        Array.from(signature)
      )
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        server: server.publicKey,
        serverTokenAccount: serverTokenAccount,
        instructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(claimIx);
    await provider.sendAndConfirm(tx, [server]);

    console.log("  Incremental payment claimed");

    // Verify only the incremental amount was transferred
    const serverBalanceAfter = await getAccount(provider.connection, serverTokenAccount);
    const incrementalAmount = secondClaim - firstClaim;
    assert.equal(
      serverBalanceAfter.amount.toString(),
      (Number(serverBalanceBefore.amount) + incrementalAmount).toString(),
      "Incremental payment incorrect"
    );
  });

  it("Fails to claim with invalid nonce", async () => {
    const claimAmount = PAYMENT_AMOUNT * 3;
    const invalidNonce = 1; // Lower than current nonce (2)

    const message = createClaimMessage(
      channelId,
      server.publicKey,
      claimAmount,
      invalidNonce
    );
    const signature = nacl.sign.detached(message, client.secretKey);

    const ed25519Ix = createEd25519VerifyInstruction(
      message,
      signature,
      client.publicKey.toBytes()
    );

    const claimIx = await program.methods
      .claimPayment(
        new anchor.BN(claimAmount),
        new anchor.BN(invalidNonce),
        Array.from(signature)
      )
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        server: server.publicKey,
        serverTokenAccount: serverTokenAccount,
        instructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(claimIx);

    try {
      await provider.sendAndConfirm(tx, [server]);
      assert.fail("Should have failed with invalid nonce");
    } catch (err) {
      assert.include(err.toString(), "InvalidNonce");
      console.log("  Correctly rejected invalid nonce");
    }
  });

  it("Fails to claim more than deposited", async () => {
    const channelAccount = await program.account.paymentChannel.fetch(channelPda);
    const excessiveAmount = channelAccount.clientDeposit.toNumber() + 1;
    const nonce = 10;

    const message = createClaimMessage(
      channelId,
      server.publicKey,
      excessiveAmount,
      nonce
    );
    const signature = nacl.sign.detached(message, client.secretKey);

    const ed25519Ix = createEd25519VerifyInstruction(
      message,
      signature,
      client.publicKey.toBytes()
    );

    const claimIx = await program.methods
      .claimPayment(
        new anchor.BN(excessiveAmount),
        new anchor.BN(nonce),
        Array.from(signature)
      )
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        server: server.publicKey,
        serverTokenAccount: serverTokenAccount,
        instructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(claimIx);

    try {
      await provider.sendAndConfirm(tx, [server]);
      assert.fail("Should have failed with insufficient funds");
    } catch (err) {
      assert.include(err.toString(), "InsufficientFunds");
      console.log("  Correctly rejected excessive claim");
    }
  });

  it("Closes channel and returns remaining balance", async () => {
    // First, let's get the channel account to check balances
    const channelAccount = await program.account.paymentChannel.fetch(channelPda);
    const remaining = channelAccount.clientDeposit.toNumber() - channelAccount.serverClaimed.toNumber();

    const clientBalanceBefore = await getAccount(provider.connection, clientTokenAccount);

    // Set expiry to past for testing
    // In production, you'd wait for expiry or have client close after full settlement
    // For this test, we'll create a new channel that expires immediately

    const tx = await program.methods
      .closeChannel()
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        closer: client.publicKey,
        clientTokenAccount: clientTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    console.log("  Channel closed, tx:", tx);

    // Verify channel is closed
    const channelAfter = await program.account.paymentChannel.fetch(channelPda);
    assert.deepEqual(channelAfter.status, { closed: {} }, "Channel should be closed");

    // Verify remaining funds returned
    const clientBalanceAfter = await getAccount(provider.connection, clientTokenAccount);
    assert.equal(
      clientBalanceAfter.amount.toString(),
      (Number(clientBalanceBefore.amount) + remaining).toString(),
      "Remaining balance not returned correctly"
    );
  });

  it("Demonstrates dispute resolution flow", async () => {
    // Create a new channel for dispute testing
    const disputeChannelId = Buffer.from(
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
    );

    const [disputeChannelPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), disputeChannelId],
      program.programId
    );

    const [disputeChannelTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel_token"), disputeChannelId],
      program.programId
    );

    const expiry = Math.floor(Date.now() / 1000) + 86400;

    // Open channel
    await program.methods
      .openChannel(
        Array.from(disputeChannelId),
        new anchor.BN(INITIAL_DEPOSIT),
        new anchor.BN(expiry)
      )
      .accounts({
        channel: disputeChannelPda,
        channelTokenAccount: disputeChannelTokenAccount,
        client: client.publicKey,
        server: server.publicKey,
        clientTokenAccount: clientTokenAccount,
        usdcMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([client])
      .rpc();

    // Initiate dispute
    await program.methods
      .disputeChannel()
      .accounts({
        channel: disputeChannelPda,
        disputer: client.publicKey,
      })
      .signers([client])
      .rpc();

    const disputedChannel = await program.account.paymentChannel.fetch(disputeChannelPda);
    assert.deepEqual(
      disputedChannel.status,
      { disputed: {} },
      "Channel should be in disputed state"
    );

    console.log("  Dispute initiated successfully");
  });
});

// Helper function to create claim message
function createClaimMessage(
  channelId: Buffer,
  server: PublicKey,
  amount: number,
  nonce: number
): Uint8Array {
  const message = new Uint8Array(80);

  // channel_id (32 bytes)
  message.set(channelId, 0);

  // server pubkey (32 bytes)
  message.set(server.toBytes(), 32);

  // amount (8 bytes, little-endian)
  const amountView = new DataView(message.buffer, 64, 8);
  amountView.setBigUint64(0, BigInt(amount), true);

  // nonce (8 bytes, little-endian)
  const nonceView = new DataView(message.buffer, 72, 8);
  nonceView.setBigUint64(0, BigInt(nonce), true);

  return message;
}

// Helper function to create Ed25519 signature verification instruction
function createEd25519VerifyInstruction(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): TransactionInstruction {
  const ED25519_PROGRAM_ID = new PublicKey("Ed25519SigVerify111111111111111111111111111");

  // Instruction data format for Ed25519 program
  const numSignatures = 1;
  const signatureOffset = 112; // Header size for 1 signature
  const publicKeyOffset = signatureOffset + 64;
  const messageOffset = publicKeyOffset + 32;

  const data = Buffer.alloc(messageOffset + message.length);

  // Number of signatures (1 byte)
  data.writeUInt8(numSignatures, 0);

  // Padding (1 byte)
  data.writeUInt8(0, 1);

  // Signature info (14 bytes per signature)
  let offset = 2;

  // Signature offset (2 bytes, little-endian)
  data.writeUInt16LE(signatureOffset, offset);
  offset += 2;

  // Signature instruction index (2 bytes) - 0xFFFF means data in this instruction
  data.writeUInt16LE(0xFFFF, offset);
  offset += 2;

  // Public key offset (2 bytes, little-endian)
  data.writeUInt16LE(publicKeyOffset, offset);
  offset += 2;

  // Public key instruction index (2 bytes)
  data.writeUInt16LE(0xFFFF, offset);
  offset += 2;

  // Message data offset (2 bytes, little-endian)
  data.writeUInt16LE(messageOffset, offset);
  offset += 2;

  // Message data size (2 bytes, little-endian)
  data.writeUInt16LE(message.length, offset);
  offset += 2;

  // Message instruction index (2 bytes)
  data.writeUInt16LE(0xFFFF, offset);
  offset += 2;

  // Padding to signature offset
  offset = signatureOffset;

  // Signature (64 bytes)
  data.set(signature, offset);
  offset += 64;

  // Public key (32 bytes)
  data.set(publicKey, offset);
  offset += 32;

  // Message
  data.set(message, offset);

  return new TransactionInstruction({
    keys: [],
    programId: ED25519_PROGRAM_ID,
    data,
  });
}
