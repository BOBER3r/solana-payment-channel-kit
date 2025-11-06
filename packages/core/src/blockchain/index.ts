/**
 * Blockchain integration module for x402 payment channels
 * Exports all blockchain-related functionality
 */

export { IDL } from './idl';
export type { PaymentChannelIDL } from './idl';
export type { BlockchainConfig } from './transactions';
export {
  getChannelPDA,
  getChannelTokenAccount,
  sendOpenChannelTransaction,
  sendAddFundsTransaction,
  sendCloseChannelTransaction,
  fetchChannelStateFromChain,
  sendClaimPaymentTransaction,
  simulateTransaction,
  getRecentBlockhashWithRetry,
} from './transactions';
