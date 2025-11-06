/**
 * Base error class for payment channel errors
 */
export class ChannelError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'ChannelError';
    Object.setPrototypeOf(this, ChannelError.prototype);
  }
}

/**
 * Thrown when channel has insufficient funds for an operation
 */
export class InsufficientFundsError extends ChannelError {
  constructor(
    message: string,
    public readonly required: bigint,
    public readonly available: bigint
  ) {
    super(message, 'INSUFFICIENT_FUNDS');
    this.name = 'InsufficientFundsError';
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}

/**
 * Thrown when channel is not found
 */
export class ChannelNotFoundError extends ChannelError {
  constructor(public readonly channelId: string) {
    super(`Channel not found: ${channelId}`, 'CHANNEL_NOT_FOUND');
    this.name = 'ChannelNotFoundError';
    Object.setPrototypeOf(this, ChannelNotFoundError.prototype);
  }
}

/**
 * Thrown when channel is closed
 */
export class ChannelClosedError extends ChannelError {
  constructor(public readonly channelId: string) {
    super(`Channel is closed: ${channelId}`, 'CHANNEL_CLOSED');
    this.name = 'ChannelClosedError';
    Object.setPrototypeOf(this, ChannelClosedError.prototype);
  }
}

/**
 * Thrown when channel has expired
 */
export class ChannelExpiredError extends ChannelError {
  constructor(public readonly channelId: string, public readonly expiry: Date) {
    super(
      `Channel expired at ${expiry.toISOString()}: ${channelId}`,
      'CHANNEL_EXPIRED'
    );
    this.name = 'ChannelExpiredError';
    Object.setPrototypeOf(this, ChannelExpiredError.prototype);
  }
}

/**
 * Thrown when signature verification fails
 */
export class InvalidSignatureError extends ChannelError {
  constructor(message: string = 'Invalid signature') {
    super(message, 'INVALID_SIGNATURE');
    this.name = 'InvalidSignatureError';
    Object.setPrototypeOf(this, InvalidSignatureError.prototype);
  }
}

/**
 * Thrown when nonce is invalid or out of sequence
 */
export class InvalidNonceError extends ChannelError {
  constructor(
    public readonly expected: bigint,
    public readonly received: bigint
  ) {
    super(
      `Invalid nonce. Expected: ${expected}, Received: ${received}`,
      'INVALID_NONCE'
    );
    this.name = 'InvalidNonceError';
    Object.setPrototypeOf(this, InvalidNonceError.prototype);
  }
}

/**
 * Thrown when transaction fails
 */
export class TransactionError extends ChannelError {
  constructor(message: string, public readonly signature?: string) {
    super(message, 'TRANSACTION_ERROR');
    this.name = 'TransactionError';
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}

/**
 * Thrown when configuration is invalid
 */
export class ConfigurationError extends ChannelError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}
