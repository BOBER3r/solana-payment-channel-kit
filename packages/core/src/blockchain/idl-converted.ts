/**
 * IDL converted from new format (spec 0.1.0) to old format for Anchor 0.31.0 compatibility
 * This merges the account type from the types array into the accounts array
 */

const rawIDL = require('../../../../programs/payment-channel/target/idl/payment_channel.json');

// Find the PaymentChannel type definition from the types array
const paymentChannelType = rawIDL.types.find((t: any) => t.name === 'PaymentChannel');

console.log('[DEBUG] Raw IDL accounts:', JSON.stringify(rawIDL.accounts, null, 2));
console.log('[DEBUG] PaymentChannel type found:', !!paymentChannelType);
if (paymentChannelType) {
  console.log('[DEBUG] PaymentChannel type structure:', JSON.stringify(paymentChannelType, null, 2));
}

// Create the old format IDL by merging the type into accounts
export const IDL_CONVERTED = {
  ...rawIDL,
  accounts: rawIDL.accounts.map((acc: any) => {
    if (acc.name === 'PaymentChannel' && paymentChannelType) {
      const converted = {
        name: acc.name,
        type: paymentChannelType.type,
      };
      console.log('[DEBUG] Converted account:', JSON.stringify(converted, null, 2));
      return converted;
    }
    return acc;
  }),
};

console.log('[DEBUG] Final converted IDL accounts:', JSON.stringify(IDL_CONVERTED.accounts, null, 2));
