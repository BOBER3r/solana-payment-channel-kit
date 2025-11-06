import { PaymentRequirement, ServerCapabilities, Network } from '../types';

/**
 * Creates headers for payment channel authorization
 *
 * @param channelId - Channel ID (hex string)
 * @param nonce - Payment nonce
 * @param amount - Payment amount
 * @param signature - Payment authorization signature
 * @returns Headers object with payment authorization
 *
 * @example
 * ```typescript
 * const headers = createChannelPaymentHeaders(
 *   channelId,
 *   BigInt(1),
 *   BigInt(1_000_000),
 *   signatureBuffer
 * );
 * ```
 */
export function createChannelPaymentHeaders(
  channelId: string,
  nonce: bigint,
  amount: bigint,
  signature: Buffer
): Headers {
  const headers = new Headers();

  headers.set('X-Payment-Method', 'channel');
  headers.set('X-Payment-Channel-Id', channelId);
  headers.set('X-Payment-Amount', amount.toString());
  headers.set('X-Payment-Nonce', nonce.toString());
  headers.set('X-Payment-Signature', signature.toString('base64'));

  return headers;
}

/**
 * Creates headers for x402 protocol payment
 *
 * @param txSignature - Solana transaction signature
 * @param amount - Payment amount
 * @returns Headers object with x402 payment proof
 *
 * @example
 * ```typescript
 * const headers = createX402PaymentHeaders(
 *   signature,
 *   BigInt(1_000_000)
 * );
 * ```
 */
export function createX402PaymentHeaders(
  txSignature: string,
  amount: bigint
): Headers {
  const headers = new Headers();

  headers.set('X-Payment-Method', 'x402');
  headers.set('X-Payment-Signature', txSignature);
  headers.set('X-Payment-Amount', amount.toString());

  return headers;
}

/**
 * Parses payment requirements from a 402 response
 *
 * @param response - HTTP response with 402 status
 * @returns Parsed payment requirement information
 * @throws Error if response is not 402 or lacks required headers
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * if (response.status === 402) {
 *   const requirement = parsePaymentRequirements(response);
 *   console.log(`Payment required: ${requirement.amount} ${requirement.currency}`);
 * }
 * ```
 */
export function parsePaymentRequirements(response: Response): PaymentRequirement {
  if (response.status !== 402) {
    throw new Error(`Expected 402 status, got ${response.status}`);
  }

  // Parse amount from header
  const amountHeader = response.headers.get('X-Payment-Amount');
  if (!amountHeader) {
    throw new Error('Missing X-Payment-Amount header in 402 response');
  }

  const amount = BigInt(amountHeader);

  // Parse recipient
  const recipient = response.headers.get('X-Payment-Recipient');
  if (!recipient) {
    throw new Error('Missing X-Payment-Recipient header in 402 response');
  }

  // Parse currency (default to USDC)
  const currency = response.headers.get('X-Payment-Currency') || 'USDC';

  // Parse optional memo
  const memo = response.headers.get('X-Payment-Memo') || undefined;

  // Parse optional deadline
  const deadlineHeader = response.headers.get('X-Payment-Deadline');
  const deadline = deadlineHeader ? new Date(deadlineHeader) : undefined;

  // Parse supported methods
  const methodsHeader = response.headers.get('X-Payment-Methods');
  let supportedMethods: ('channel' | 'x402')[] = ['x402']; // Default to x402

  if (methodsHeader) {
    const methods = methodsHeader.split(',').map(m => m.trim().toLowerCase());
    supportedMethods = methods.filter(
      m => m === 'channel' || m === 'x402'
    ) as ('channel' | 'x402')[];
  }

  return {
    amount,
    currency,
    recipient,
    memo,
    deadline,
    supportedMethods,
  };
}

/**
 * Extracts server capabilities from response headers
 *
 * Some servers may advertise their capabilities in response headers
 * instead of or in addition to the /.well-known/x402-capabilities endpoint.
 *
 * @param response - HTTP response
 * @returns Partial server capabilities from headers
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * const capabilities = extractServerCapabilities(response);
 *
 * if (capabilities.supportsChannels) {
 *   console.log('Server supports payment channels!');
 * }
 * ```
 */
export function extractServerCapabilities(response: Response): Partial<ServerCapabilities> {
  const capabilities: Partial<ServerCapabilities> = {};

  // Check for channel support header
  const supportsChannels = response.headers.get('X-Payment-Channels-Supported');
  if (supportsChannels !== null) {
    capabilities.supportsChannels = supportsChannels.toLowerCase() === 'true';
  }

  // Check for x402 support
  const supportsX402 = response.headers.get('X-Payment-X402-Supported');
  if (supportsX402 !== null) {
    capabilities.supportsX402 = supportsX402.toLowerCase() === 'true';
  }

  // Check for program ID
  const programId = response.headers.get('X-Payment-Program-Id');
  if (programId) {
    capabilities.programId = programId;
  }

  // Check for recipient wallet
  const recipientWallet = response.headers.get('X-Payment-Recipient');
  if (recipientWallet) {
    capabilities.recipientWallet = recipientWallet;
  }

  // Check for minimum channel amount
  const minChannelAmount = response.headers.get('X-Payment-Min-Channel-Amount');
  if (minChannelAmount) {
    capabilities.minChannelAmount = BigInt(minChannelAmount);
  }

  // Check for max channel expiry
  const maxChannelExpiry = response.headers.get('X-Payment-Max-Channel-Expiry');
  if (maxChannelExpiry) {
    capabilities.maxChannelExpiry = parseInt(maxChannelExpiry, 10);
  }

  // Check for supported networks
  const networks = response.headers.get('X-Payment-Networks');
  if (networks) {
    const networkList = networks.split(',').map(n => n.trim()) as Network[];
    capabilities.supportedNetworks = networkList.filter(
      n => n === 'devnet' || n === 'mainnet-beta'
    );
  }

  return capabilities;
}

/**
 * Merges headers from multiple sources
 *
 * @param base - Base headers object
 * @param additional - Additional headers to merge
 * @returns Merged headers object
 *
 * @example
 * ```typescript
 * const baseHeaders = new Headers({ 'Content-Type': 'application/json' });
 * const paymentHeaders = createChannelPaymentHeaders(...);
 * const merged = mergeHeaders(baseHeaders, paymentHeaders);
 * ```
 */
export function mergeHeaders(...headerSets: (Headers | HeadersInit)[]): Headers {
  const merged = new Headers();

  for (const headerSet of headerSets) {
    if (headerSet instanceof Headers) {
      headerSet.forEach((value, key) => {
        merged.set(key, value);
      });
    } else if (Array.isArray(headerSet)) {
      // HeadersInit as array
      for (const [key, value] of headerSet) {
        merged.set(key, value);
      }
    } else if (headerSet) {
      // HeadersInit as object
      for (const [key, value] of Object.entries(headerSet)) {
        merged.set(key, value);
      }
    }
  }

  return merged;
}

/**
 * Checks if a response indicates payment is required
 *
 * @param response - HTTP response to check
 * @returns True if payment is required (402 status)
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * if (isPaymentRequired(response)) {
 *   const requirement = parsePaymentRequirements(response);
 *   // Handle payment...
 * }
 * ```
 */
export function isPaymentRequired(response: Response): boolean {
  return response.status === 402;
}

/**
 * Validates payment authorization headers
 *
 * @param headers - Headers to validate
 * @returns True if headers contain valid payment authorization
 *
 * @example
 * ```typescript
 * const headers = createChannelPaymentHeaders(...);
 * if (hasValidPaymentHeaders(headers)) {
 *   // Proceed with payment
 * }
 * ```
 */
export function hasValidPaymentHeaders(headers: Headers): boolean {
  const method = headers.get('X-Payment-Method');

  if (method === 'channel') {
    return (
      headers.has('X-Payment-Channel-Id') &&
      headers.has('X-Payment-Amount') &&
      headers.has('X-Payment-Nonce') &&
      headers.has('X-Payment-Signature')
    );
  }

  if (method === 'x402') {
    return (
      headers.has('X-Payment-Signature') &&
      headers.has('X-Payment-Amount')
    );
  }

  return false;
}

/**
 * Extracts error information from response headers
 *
 * @param response - HTTP response
 * @returns Error information if present
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * if (!response.ok) {
 *   const error = extractErrorInfo(response);
 *   console.error(`Error: ${error?.message}`);
 * }
 * ```
 */
export function extractErrorInfo(
  response: Response
): { code: string; message: string } | null {
  const code = response.headers.get('X-Error-Code');
  const message = response.headers.get('X-Error-Message');

  if (code || message) {
    return {
      code: code || 'UNKNOWN_ERROR',
      message: message || response.statusText || 'Unknown error occurred',
    };
  }

  return null;
}

/**
 * Creates a WWW-Authenticate header value for 402 responses
 *
 * This is useful for servers implementing the x402 protocol.
 *
 * @param amount - Required payment amount
 * @param recipient - Recipient wallet address
 * @param methods - Supported payment methods
 * @returns WWW-Authenticate header value
 *
 * @example
 * ```typescript
 * const authHeader = createWWWAuthenticateHeader(
 *   BigInt(1_000_000),
 *   'recipient_address',
 *   ['channel', 'x402']
 * );
 * ```
 */
export function createWWWAuthenticateHeader(
  amount: bigint,
  recipient: string,
  methods: ('channel' | 'x402')[]
): string {
  const methodsStr = methods.join(',');
  return `X402 realm="payment", amount="${amount}", recipient="${recipient}", methods="${methodsStr}"`;
}

/**
 * Parses WWW-Authenticate header
 *
 * @param headerValue - WWW-Authenticate header value
 * @returns Parsed authentication challenge
 *
 * @example
 * ```typescript
 * const challenge = parseWWWAuthenticateHeader(response.headers.get('WWW-Authenticate'));
 * console.log(`Payment required: ${challenge.amount}`);
 * ```
 */
export function parseWWWAuthenticateHeader(
  headerValue: string | null
): {
  realm: string;
  amount: bigint;
  recipient: string;
  methods: ('channel' | 'x402')[];
} | null {
  if (!headerValue || !headerValue.startsWith('X402 ')) {
    return null;
  }

  const parts = headerValue.slice(5); // Remove 'X402 '
  const params: Record<string, string> = {};

  // Parse key="value" pairs
  const regex = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(parts)) !== null) {
    params[match[1]] = match[2];
  }

  if (!params.amount || !params.recipient) {
    return null;
  }

  const methodsStr = params.methods || 'x402';
  const methods = methodsStr.split(',').map(m => m.trim()) as ('channel' | 'x402')[];

  return {
    realm: params.realm || 'payment',
    amount: BigInt(params.amount),
    recipient: params.recipient,
    methods,
  };
}

/**
 * Converts headers to a plain object for logging/debugging
 *
 * @param headers - Headers object
 * @returns Plain object representation
 *
 * @example
 * ```typescript
 * const headers = new Headers({ 'Content-Type': 'application/json' });
 * console.log(headersToObject(headers));
 * // { 'content-type': 'application/json' }
 * ```
 */
export function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {};

  headers.forEach((value, key) => {
    obj[key] = value;
  });

  return obj;
}