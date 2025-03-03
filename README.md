# ARC55-TS: On-chain Multisignature Implementation

This project provides a TypeScript implementation of [ARC-55](https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0055.md), the Algorand standard for on-chain multisignature transaction coordination and gathering.

## Overview

ARC-55 defines a standard for aggregating multi-party signatures for multisignature transactions on the Algorand blockchain. This implementation allows a multisignature wallet to manage transaction signing and execution fully on-chain, improving the coordination process compared to traditional off-chain multisig approaches.

## Key Features

- **On-chain signature collection**: Store and manage multisig transaction signatures directly on the Algorand blockchain
- **Flexible threshold settings**: Configure custom signer threshold requirements
- **Transaction grouping**: Manage groups of related transactions
- **Large transaction support**: Handle transactions that exceed box storage limits through transaction chunking
- **Signature revocation**: Allow signers to clear their signatures if needed
- **Event logging**: Track all signature and transaction operations through Algorand events

## Project Structure

```
arc55-ts/
├── projects/
│   └── arc55-ts/
│       └── contracts/
│           ├── Arc55.algo.ts        # Base ARC-55 contract implementation 
│           ├── msig-app.algo.ts     # Multisig application contract
│           ├── msig-app.demo.ts     # Demo script showing contract usage
│           └── clients/             # Generated TypeScript clients
```

## Technical Details

### Core Components

1. **Arc55 Base Contract** (`Arc55.algo.ts`)
   - Implements the fundamental ARC-55 functionality
   - Manages contract state, box storage, and transaction coordination
   - Handles signature storage and threshold validation

2. **Multisig Application** (`msig-app.algo.ts`)
   - Extends the base Arc55 contract
   - Provides deployment, update, and destruction methods
   - Manages administrative functions

### Storage Model

The implementation uses Algorand's box storage for transaction data and signatures:

- **Transaction Storage**: Stores transaction data in boxes keyed by `(transaction_group, index)`
- **Signature Storage**: Stores signatures in boxes keyed by `(transaction_group, address)`
- **Signer Registry**: Uses global state to maintain a registry of authorized signers

### Usage Flow

1. **Deploy** the multisig application
2. **Setup** the multisig with signers and threshold
3. **Create** a transaction group
4. **Add** transactions to the group
5. **Collect** signatures from required signers
6. **Execute** the transaction once threshold is met
7. **Clean up** by removing transactions and signatures

## Getting Started

### Prerequisites

- Node.js (v20+)
- Algorand development environment
- AlgoKit CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/SatishGAXL/arc55-ts.git
cd arc55-ts/projects/arc55-ts/

# Install dependencies
npm install
```

### Usage Example

The `msig-app.demo.ts` file provides a comprehensive example of how to use the ARC-55 implementation:

```typescript
// Initialize client and deploy the application
const appClient = new MsigAppClient({ resolveBy: 'id', id: 0 }, algod);
const deployment = await appClient.create.deploy({ admin: ALGORAND_ZERO_ADDRESS_STRING });

// Setup the multisig with signers and threshold
await appClient.arc55Setup({
  threshold: 2,
  addresses: [accounts[0].addr, accounts[1].addr, accounts[2].addr]
});

// Create a transaction group
const transaction_group = await appClient.arc55NewTransactionGroup();

// Add a transaction to the group
await appClient.arc55AddTransaction({
  costs: paymentTxn,
  transactionGroup: transaction_group,
  index: 0,
  transaction: yourTransaction.toByte()
});

// Sign the transaction
await appClient.arc55SetSignatures({
  costs: sigMbrPayment,
  transactionGroup: transaction_group,
  signatures: [signature]
});
```

## Advanced Features

### Handling Large Transactions

For transactions larger than the box storage limit (2KB per box):

```typescript
// First chunk
await appClient.arc55AddTransaction({
  costs: payment,
  transactionGroup: group,
  index: 0,
  transaction: largeTransaction.toByte().slice(0, 2000)
});

// Remaining chunks
for (let n = 1; n < txnSize / 2000; n++) {
  await appClient.arc55AddTransactionContinued({
    transaction: largeTransaction.toByte().slice(2000 * n, 2000 * (n + 1))
  });
}
```

### Signature Management

```typescript
// Add a signature
await appClient.arc55SetSignatures({
  costs: payment,
  transactionGroup: group,
  signatures: [signatureBytes]
});

// Clear a signature if needed
await appClient.arc55ClearSignatures({
  transactionGroup: group,
  address: signer
});
```

## Development

### Compilation (Optional)
Make sure to start localnet using `algokit localnet start`, before doing the compilation step.
```bash
npm run build
```

### Running Demo Script
Demo Script is intended to be run in localnet, make sure to start localnet using `algokit localnet start`.
```bash
npx tsx contracts/msig-app.demo.ts
```

## Acknowledgments

- [Algorand Foundation](https://algorand.foundation/) for the ARC-55 standard
- [TEALScript](https://github.com/algorandfoundation/tealscript) for the smart contract language
- [AlgoKit](https://github.com/algorandfoundation/algokit-utils) for Algorand development utilities