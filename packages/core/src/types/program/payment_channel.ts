/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/payment_channel.json`.
 */
export type PaymentChannel = {
  "address": "H8SsYx7Z8qp12AvaX8oEWDCHWo8JYmEK21zWLWcfW4Zc",
  "metadata": {
    "name": "paymentChannel",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Payment channel program for x402 protocol with off-chain micropayments"
  },
  "instructions": [
    {
      "name": "addFunds",
      "docs": [
        "Add more funds to an existing channel",
        "Allows client to top up the channel without closing and reopening",
        "",
        "# Arguments",
        "* `amount` - Amount of USDC to add (in micro USDC)",
        "",
        "# Security",
        "- Only the channel client can add funds",
        "- Channel must be in Open status"
      ],
      "discriminator": [
        132,
        237,
        76,
        57,
        80,
        10,
        179,
        138
      ],
      "accounts": [
        {
          "name": "channel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "channelTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "client",
          "writable": true,
          "signer": true
        },
        {
          "name": "clientTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimPayment",
      "docs": [
        "Server claims payment with client's signed authorization",
        "This is the KEY operation that happens after many off-chain payments accumulate",
        "",
        "# Arguments",
        "* `amount` - Total cumulative amount server is claiming (not incremental)",
        "* `nonce` - Monotonically increasing nonce for replay protection",
        "* `client_signature` - Ed25519 signature from client authorizing this claim",
        "",
        "# Off-chain Flow",
        "1. Client creates signed payment authorization for each API call (off-chain)",
        "2. Server verifies signature and provides service (off-chain)",
        "3. Periodically, server submits latest authorization on-chain to claim funds",
        "",
        "# Security",
        "- Signature verification ensures client authorized this payment",
        "- Nonce must be strictly increasing to prevent replay attacks",
        "- Amount cannot exceed deposited funds",
        "- Only the designated server can claim"
      ],
      "discriminator": [
        69,
        112,
        250,
        167,
        37,
        156,
        200,
        30
      ],
      "accounts": [
        {
          "name": "channel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "channelTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "server",
          "writable": true,
          "signer": true
        },
        {
          "name": "serverTokenAccount",
          "writable": true
        },
        {
          "name": "instructionSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "clientSignature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "closeChannel",
      "docs": [
        "Close channel and return remaining funds to client",
        "Can be called by either party after expiry, or by client anytime if fully settled",
        "",
        "# Security",
        "- Can only close if expired OR client has no remaining balance",
        "- Remaining funds always go back to client",
        "- Channel is marked as Closed to prevent further operations",
        "- Closes both accounts and returns rent to client (rent reclamation)"
      ],
      "discriminator": [
        0,
        104,
        36,
        1,
        66,
        0,
        103,
        157
      ],
      "accounts": [
        {
          "name": "channel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "channelTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "closer",
          "docs": [
            "Party closing the channel (client, server, or anyone if expired)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "clientTokenAccount",
          "docs": [
            "Client's token account to receive remaining funds"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "disputeChannel",
      "docs": [
        "Dispute channel - initiate dispute resolution process",
        "Freezes the channel for manual review",
        "",
        "# Use Cases",
        "- Client believes server overcharged",
        "- Server believes client is attempting fraud",
        "- Either party suspects account compromise",
        "",
        "# Security",
        "- Can only be called by client or server",
        "- Changes status to Disputed, preventing further claims",
        "- Requires manual resolution or time-based auto-close"
      ],
      "discriminator": [
        62,
        30,
        173,
        35,
        100,
        219,
        251,
        118
      ],
      "accounts": [
        {
          "name": "channel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "disputer",
          "docs": [
            "Party initiating the dispute (must be client or server)"
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "disputeClose",
      "docs": [
        "Emergency close with latest signed state",
        "Server can use this to close immediately with the latest authorization",
        "Useful if client disappears or channel needs immediate settlement",
        "",
        "# Arguments",
        "* `latest_amount` - Latest cumulative amount from client's signature",
        "* `latest_nonce` - Latest nonce from client's signature",
        "* `client_signature` - Client's signature authorizing this amount",
        "",
        "# Security",
        "- Must provide valid signature from client",
        "- Nonce must be >= current nonce (accepts latest state)",
        "- Only server can call this",
        "- Settles based on client's signed authorization"
      ],
      "discriminator": [
        238,
        219,
        107,
        139,
        243,
        19,
        45,
        225
      ],
      "accounts": [
        {
          "name": "channel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "channelTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "server",
          "writable": true,
          "signer": true
        },
        {
          "name": "serverTokenAccount",
          "writable": true
        },
        {
          "name": "clientTokenAccount",
          "writable": true
        },
        {
          "name": "instructionSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "latestAmount",
          "type": "u64"
        },
        {
          "name": "latestNonce",
          "type": "u64"
        },
        {
          "name": "clientSignature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "openChannel",
      "docs": [
        "Open a new payment channel",
        "Client locks up USDC, server can claim incrementally with signed authorizations",
        "",
        "# Arguments",
        "* `channel_id` - Unique identifier for this channel (32 bytes)",
        "* `initial_deposit` - Amount of USDC to deposit (in micro USDC, 6 decimals)",
        "* `expiry` - Unix timestamp when channel expires and can be closed",
        "",
        "# Security",
        "- Only the client who signs can open the channel",
        "- Funds are locked in a PDA controlled by the program",
        "- Channel ID must be unique (account init will fail if it exists)"
      ],
      "discriminator": [
        91,
        45,
        253,
        71,
        140,
        166,
        107,
        109
      ],
      "accounts": [
        {
          "name": "channel",
          "docs": [
            "Channel state account (PDA)",
            "Seeds: [b\"channel\", channel_id]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "channelId"
              }
            ]
          }
        },
        {
          "name": "channelTokenAccount",
          "docs": [
            "Channel's token account for holding USDC escrow",
            "Seeds: [b\"channel_token\", channel_id]",
            "Authority is the channel PDA itself"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "channelId"
              }
            ]
          }
        },
        {
          "name": "client",
          "docs": [
            "Client who is opening and funding the channel"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "server",
          "docs": [
            "Server who will receive payments from this channel"
          ]
        },
        {
          "name": "clientTokenAccount",
          "docs": [
            "Client's USDC token account (source of funds)"
          ],
          "writable": true
        },
        {
          "name": "usdcMint",
          "docs": [
            "USDC mint (or any SPL token mint)"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "channelId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "initialDeposit",
          "type": "u64"
        },
        {
          "name": "expiry",
          "type": "i64"
        },
        {
          "name": "creditLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resolveDispute",
      "docs": [
        "Resolve a disputed channel",
        "BUG FIX 5: Provides manual dispute resolution mechanism",
        "Allows an authorized resolver (multisig) to settle disputed channels",
        "",
        "# Arguments",
        "* `to_client` - Amount to transfer to client",
        "* `to_server` - Amount to transfer to server",
        "",
        "# Security",
        "- Only works on disputed channels",
        "- Amounts must sum to available balance",
        "- Requires authority signature (should be multisig in production)"
      ],
      "discriminator": [
        231,
        6,
        202,
        6,
        96,
        103,
        12,
        230
      ],
      "accounts": [
        {
          "name": "channel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "Authority that can resolve disputes (should be multisig)"
          ],
          "signer": true
        },
        {
          "name": "channelTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "channel.channel_id",
                "account": "paymentChannel"
              }
            ]
          }
        },
        {
          "name": "clientTokenAccount",
          "writable": true
        },
        {
          "name": "serverTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "toClient",
          "type": "u64"
        },
        {
          "name": "toServer",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "paymentChannel",
      "discriminator": [
        53,
        102,
        116,
        128,
        150,
        23,
        170,
        138
      ]
    }
  ],
  "events": [
    {
      "name": "channelClosed",
      "discriminator": [
        119,
        198,
        23,
        254,
        216,
        124,
        84,
        16
      ]
    },
    {
      "name": "channelDisputeClosed",
      "discriminator": [
        199,
        81,
        255,
        108,
        111,
        26,
        54,
        237
      ]
    },
    {
      "name": "channelOpened",
      "discriminator": [
        253,
        213,
        255,
        96,
        31,
        188,
        47,
        170
      ]
    },
    {
      "name": "debtIncurred",
      "discriminator": [
        177,
        246,
        83,
        93,
        14,
        158,
        217,
        138
      ]
    },
    {
      "name": "debtSettled",
      "discriminator": [
        97,
        100,
        219,
        145,
        25,
        187,
        48,
        219
      ]
    },
    {
      "name": "disputeInitiated",
      "discriminator": [
        150,
        109,
        93,
        252,
        198,
        4,
        183,
        153
      ]
    },
    {
      "name": "disputeResolved",
      "discriminator": [
        121,
        64,
        249,
        153,
        139,
        128,
        236,
        187
      ]
    },
    {
      "name": "fundsAdded",
      "discriminator": [
        87,
        171,
        7,
        127,
        147,
        121,
        99,
        75
      ]
    },
    {
      "name": "paymentClaimed",
      "discriminator": [
        238,
        86,
        136,
        254,
        229,
        217,
        63,
        80
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "missingEd25519Instruction",
      "msg": "Ed25519 verification instruction not found - must be immediately before this instruction"
    },
    {
      "code": 6001,
      "name": "invalidEd25519Program",
      "msg": "Invalid Ed25519 program ID - instruction must use Ed25519Program"
    },
    {
      "code": 6002,
      "name": "invalidEd25519Data",
      "msg": "Invalid Ed25519 instruction data - malformed or insufficient data"
    },
    {
      "code": 6003,
      "name": "signatureMismatch",
      "msg": "Signature does not match expected value"
    },
    {
      "code": 6004,
      "name": "publicKeyMismatch",
      "msg": "Public key does not match expected value"
    },
    {
      "code": 6005,
      "name": "messageMismatch",
      "msg": "Message does not match expected value"
    }
  ],
  "types": [
    {
      "name": "channelClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "remainingReturned",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "channelDisputeClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "toServer",
            "type": "u64"
          },
          {
            "name": "toClient",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "channelOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "client",
            "type": "pubkey"
          },
          {
            "name": "server",
            "type": "pubkey"
          },
          {
            "name": "deposit",
            "type": "u64"
          },
          {
            "name": "expiry",
            "type": "i64"
          },
          {
            "name": "creditLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "channelStatus",
      "docs": [
        "Channel status enum"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          },
          {
            "name": "disputed"
          }
        ]
      }
    },
    {
      "name": "debtIncurred",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "overdraftAmount",
            "type": "u64"
          },
          {
            "name": "totalDebt",
            "type": "u64"
          },
          {
            "name": "creditLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "debtSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amountSettled",
            "type": "u64"
          },
          {
            "name": "remainingDebt",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "disputeInitiated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "disputer",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "disputeResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "toClient",
            "type": "u64"
          },
          {
            "name": "toServer",
            "type": "u64"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "fundsAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "debtSettled",
            "type": "u64"
          },
          {
            "name": "netDeposit",
            "type": "u64"
          },
          {
            "name": "remainingDebt",
            "type": "u64"
          },
          {
            "name": "newBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "paymentChannel",
      "docs": [
        "Payment channel state",
        "Stores all information about an open payment channel between client and server"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "docs": [
              "Unique identifier for this channel"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "client",
            "docs": [
              "Client's public key (the one funding the channel)"
            ],
            "type": "pubkey"
          },
          {
            "name": "server",
            "docs": [
              "Server's public key (the one receiving payments)"
            ],
            "type": "pubkey"
          },
          {
            "name": "clientDeposit",
            "docs": [
              "Total amount deposited by client (in micro-tokens, e.g., micro-USDC)"
            ],
            "type": "u64"
          },
          {
            "name": "serverClaimed",
            "docs": [
              "Total amount claimed by server on-chain so far"
            ],
            "type": "u64"
          },
          {
            "name": "nonce",
            "docs": [
              "Monotonic nonce for replay protection",
              "Each new off-chain payment must have a higher nonce"
            ],
            "type": "u64"
          },
          {
            "name": "expiry",
            "docs": [
              "Unix timestamp when channel expires and can be closed"
            ],
            "type": "i64"
          },
          {
            "name": "status",
            "docs": [
              "Current status of the channel"
            ],
            "type": {
              "defined": {
                "name": "channelStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix timestamp when channel was created"
            ],
            "type": "i64"
          },
          {
            "name": "lastUpdate",
            "docs": [
              "Unix timestamp of last state update"
            ],
            "type": "i64"
          },
          {
            "name": "debtOwed",
            "docs": [
              "Amount client owes to server (overdraft/negative balance)",
              "When client uses more than deposited, this tracks the debt"
            ],
            "type": "u64"
          },
          {
            "name": "creditLimit",
            "docs": [
              "Maximum overdraft allowed (set by server at channel creation)",
              "Server can set this based on client's credit history, tier, etc."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA derivation"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "paymentClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "overdraftIncurred",
            "type": "u64"
          },
          {
            "name": "remainingDebt",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
