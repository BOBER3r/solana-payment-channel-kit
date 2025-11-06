#!/usr/bin/env ts-node

/**
 * Example script to open a payment channel
 * Usage: ts-node scripts/open-channel.ts --amount 100000000 --days 1
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PaymentChannel } from "../target/types/payment_channel";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

interface Args {
  amount: number;
  days: number;
  cluster: string;
  serverPubkey?: string;
  usdcMint?: string;
}

async function parseArgs(): Promise<Args> {
  const args = process.argv.slice(2);
  const parsed: Partial<Args> = {
    cluster: "devnet",
    days: 1,
    amount: 100_000_000, // 100 USDC default
  };

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace("--", "");
    const value = args[i + 1];

    switch (key) {
      case "amount":
        parsed.amount = parseInt(value);
        break;
      case "days":
        parsed.days = parseInt(value);
        break;
      case "cluster":
        parsed.cluster = value;
        break;
      case "server":
        parsed.serverPubkey = value;
        break;
      case "usdc":
        parsed.usdcMint = value;
        break;
    }
  }

  return parsed as Args;
}

async function main() {
  const args = await parseArgs();

  console.log("Opening Payment Channel");
  console.log("======================");
  console.log(`Cluster: ${args.cluster}`);
  console.log(`Amount: ${args.amount / 1_000_000} USDC`);
  console.log(`Duration: ${args.days} days`);
  console.log("");

  // Setup connection
  const connection = new anchor.web3.Connection(
    args.cluster === "mainnet"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com",
    "confirmed"
  );

  // Load wallet
  const walletPath = path.join(
    process.env.HOME!,
    ".config/solana/id.json"
  );
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log(`Client Wallet: ${wallet.publicKey.toBase58()}`);

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load program
  const programId = new PublicKey("PayXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  const idl = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../target/idl/payment_channel.json"),
      "utf-8"
    )
  );
  const program = new Program(idl, programId, provider) as Program<PaymentChannel>;

  // USDC mint (devnet or mainnet)
  const usdcMint = new PublicKey(
    args.usdcMint ||
      (args.cluster === "mainnet"
        ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // Mainnet USDC
        : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU") // Devnet USDC
  );

  // Server public key (use provided or generate new)
  const serverPubkey = args.serverPubkey
    ? new PublicKey(args.serverPubkey)
    : Keypair.generate().publicKey;

  console.log(`Server Wallet: ${serverPubkey.toBase58()}`);
  console.log(`USDC Mint: ${usdcMint.toBase58()}`);
  console.log("");

  // Get or create token accounts
  console.log("Setting up token accounts...");
  const clientTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    usdcMint,
    wallet.publicKey
  );

  console.log(`Client Token Account: ${clientTokenAccount.address.toBase58()}`);
  console.log(`Balance: ${clientTokenAccount.amount / BigInt(1_000_000)} USDC`);

  if (clientTokenAccount.amount < BigInt(args.amount)) {
    throw new Error(
      `Insufficient balance. Need ${args.amount / 1_000_000} USDC, have ${
        Number(clientTokenAccount.amount) / 1_000_000
      } USDC`
    );
  }

  // Generate channel ID
  const channelId = Buffer.from(
    Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
  );

  console.log("");
  console.log(`Channel ID: ${channelId.toString("hex")}`);

  // Derive PDAs
  const [channelPda, channelBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), channelId],
    program.programId
  );

  const [channelTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel_token"), channelId],
    program.programId
  );

  console.log(`Channel PDA: ${channelPda.toBase58()}`);
  console.log(`Channel Token Account: ${channelTokenAccount.toBase58()}`);
  console.log("");

  // Calculate expiry
  const expiry = Math.floor(Date.now() / 1000) + args.days * 86400;
  const expiryDate = new Date(expiry * 1000);

  console.log(`Expiry: ${expiryDate.toISOString()} (${args.days} days)`);
  console.log("");

  // Open channel
  console.log("Opening channel...");
  try {
    const tx = await program.methods
      .openChannel(
        Array.from(channelId),
        new anchor.BN(args.amount),
        new anchor.BN(expiry)
      )
      .accounts({
        channel: channelPda,
        channelTokenAccount: channelTokenAccount,
        client: wallet.publicKey,
        server: serverPubkey,
        clientTokenAccount: clientTokenAccount.address,
        usdcMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("✅ Channel opened successfully!");
    console.log(`Transaction: ${tx}`);
    console.log("");

    // Fetch and display channel state
    const channelAccount = await program.account.paymentChannel.fetch(channelPda);

    console.log("Channel Details:");
    console.log("===============");
    console.log(`Channel ID: ${Buffer.from(channelAccount.channelId).toString("hex")}`);
    console.log(`Client: ${channelAccount.client.toBase58()}`);
    console.log(`Server: ${channelAccount.server.toBase58()}`);
    console.log(`Deposit: ${channelAccount.clientDeposit.toNumber() / 1_000_000} USDC`);
    console.log(`Claimed: ${channelAccount.serverClaimed.toNumber() / 1_000_000} USDC`);
    console.log(
      `Available: ${
        (channelAccount.clientDeposit.toNumber() - channelAccount.serverClaimed.toNumber()) /
        1_000_000
      } USDC`
    );
    console.log(`Nonce: ${channelAccount.nonce.toString()}`);
    console.log(`Status: ${JSON.stringify(channelAccount.status)}`);
    console.log(`Created: ${new Date(channelAccount.createdAt.toNumber() * 1000).toISOString()}`);
    console.log("");

    // Save channel info to file
    const channelInfo = {
      channelId: channelId.toString("hex"),
      channelPda: channelPda.toBase58(),
      client: wallet.publicKey.toBase58(),
      server: serverPubkey.toBase58(),
      deposit: args.amount,
      expiry: expiry,
      cluster: args.cluster,
      transaction: tx,
    };

    const outputPath = path.join(__dirname, "../.channels", `${channelId.toString("hex")}.json`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(channelInfo, null, 2));

    console.log(`Channel info saved to: ${outputPath}`);
    console.log("");
    console.log("Next steps:");
    console.log("1. Share channel ID and server pubkey with the server");
    console.log("2. Create signed payment authorizations for API calls");
    console.log("3. Server can claim payments with: ts-node scripts/claim-payment.ts");
    console.log("4. Close channel when done with: ts-node scripts/close-channel.ts");
  } catch (error) {
    console.error("❌ Error opening channel:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });