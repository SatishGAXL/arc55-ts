import algosdk, { Address } from 'algosdk';
import { ALGORAND_ZERO_ADDRESS_STRING } from 'algosdk/src/encoding/address';
import * as algokit from '@algorandfoundation/algokit-utils';
import { MsigAppClient } from './clients/MsigAppClient';

// Initialize Algorand client connections
// Note: These are development environment connections with placeholder API keys
const algod = new algosdk.Algodv2('a'.repeat(64), 'http://127.0.0.1', 4001);
const kmd = new algosdk.Kmd('a'.repeat(64), 'http://127.0.0.1', 4002);

/**
 * Combines a 64-bit integer and an 8-bit integer into a single buffer
 * Used for creating unique box names for ARC-55 transactions
 * @param uint64 - 64-bit integer (transaction group ID)
 * @param uint8 - 8-bit integer (typically an index)
 * @returns Combined buffer of both values
 */
function combineUint64AndUint8(uint64: number, uint8: number) {
  const uint64buffer = algosdk.bigIntToBytes(uint64, 8);
  const uint8buffer = algosdk.bigIntToBytes(uint8, 1);
  const combinedbuffer = new Uint8Array(9);
  combinedbuffer.set(uint64buffer, 0);
  combinedbuffer.set(uint8buffer, 8);
  return combinedbuffer;
}

/**
 * Combines an Algorand address and a 64-bit integer into a single buffer
 * Used for creating unique box names for ARC-55 signatures
 * @param address - Algorand address in string format
 * @param uint64 - 64-bit integer (transaction group ID)
 * @returns Combined buffer containing both values
 */
function combineAddressAndUint64(address: string, uint64: number) {
  console.log("address",address)
  const addressbuffer = algosdk.decodeAddress(address).publicKey;
  const uint64buffer = algosdk.bigIntToBytes(uint64, 8);
  const combinedbuffer = new Uint8Array(40);
  combinedbuffer.set(uint64buffer, 0);
  combinedbuffer.set(addressbuffer, 8);
  return combinedbuffer;
}

// Self-executing async function
(async () => {
  // Get available wallets from the Key Management Daemon (KMD)
  const wallets = await kmd.listWallets();
  const walletId = wallets.wallets[0].id;
  
  // Initialize wallet and get addresses
  const handle = await kmd.initWalletHandle(walletId, '');
  const { addresses } = await kmd.listKeys(handle.wallet_handle_token);
  
  // Load private keys for each address
  const accounts = [];
  for (const address of addresses) {
    accounts.push({
      addr: address,
      sk: (await kmd.exportKey(handle.wallet_handle_token, '', address))['private_key'],
    });
  }

  // Initialize the multisig application client
  const appClient = new MsigAppClient(
    {
      resolveBy: 'id',
      id: 0, // Will be updated with actual ID after deployment
    },
    algod
  );

  // Deploy the multisig application
  // Using zero-address as admin means no specific admin address controls the app
  const deployment = await appClient.create.deploy(
    {
      admin: ALGORAND_ZERO_ADDRESS_STRING,
    },
    {
      sender: accounts[0],
    }
  );

  // Setup the ARC-55 multisig with 3 signers and a threshold of 2
  // This means any 2 out of the 3 signers must sign for transactions to be valid
  const setup = await appClient.arc55Setup(
    {
      threshold: 2,
      addresses: [accounts[0].addr, accounts[1].addr, accounts[2].addr],
    },
    {
      sender: accounts[0],
    }
  );

  // Create the equivalent standard multisig address using algosdk
  // This address will be used as the sender for multisig transactions
  const msig_addr = algosdk.multisigAddress({
    version: 1,
    threshold: 2,
    addrs: [accounts[0].addr, accounts[1].addr, accounts[2].addr],
  });
  console.log(msig_addr);

  // Create a new transaction group in the ARC-55 contract
  // A transaction group is a collection of related transactions
  const new_transaction_group = await appClient.arc55NewTransactionGroup(
    {},
    {
      sender: accounts[0],
    }
  );
  const transaction_group = new_transaction_group.return as bigint;

  // Create a simple zero-amount payment transaction as a test
  // This transaction sends 0 ALGO from the multisig to itself with a note
  const zero_payment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: msig_addr,
    to: msig_addr,
    amount: 0,
    suggestedParams: await algod.getTransactionParams().do(),
    note: new Uint8Array(Buffer.from('Testing ARC-55 works')),
  });
  
  // Calculate the minimum balance requirement increase needed to store this transaction
  let txn_cost = await appClient.arc55MbrTxnIncrease(
    {
      transactionSize: zero_payment.toByte().length,
    },
    {
      sender: accounts[0],
    }
  );
  
  // Create a payment to cover the storage costs for the transaction
  const add_txn_mbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: accounts[0].addr,
    to: deployment.appAddress,
    amount: txn_cost.return as bigint,
    suggestedParams: await algod.getTransactionParams().do(),
  });
  
  // Define box references needed for the AddTransaction call
  // Boxes are Algorand's on-chain storage mechanism
  let boxes = Array.from({ length: 8 }, () => ({
    appIndex: 0,
    name: combineUint64AndUint8(Number(transaction_group), 0),
  }));
  
  // Add the zero-payment transaction to the transaction group
  const add_txn = await appClient.arc55AddTransaction(
    {
      costs: add_txn_mbr,
      transactionGroup: transaction_group,
      index: 0,
      transaction: zero_payment.toByte(),
    },
    {
      sender: accounts[0],
      boxes: boxes,
    }
  );

  // Replace the simple transaction with a more complex, larger transaction
  // This demonstrates handling transactions that exceed box size limits
  const large_transaction = algosdk.makeApplicationCallTxnFromObject({
    from: msig_addr,
    appIndex: 0,
    onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC,
    approvalProgram: new Uint8Array(
      Buffer.from(
        // This is a large dummy program (filled with "IkgiSCJI" bytes) to demonstrate
        // handling large transactions that need to be split across multiple boxes
        'CiABASJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJIIkgiSCJI',
        'base64'
      )
    ),
    clearProgram: new Uint8Array(Buffer.from('CiABASI=', 'base64')),
    extraPages: 3,
    suggestedParams: await algod.getTransactionParams().do(),
  });
  
  // Calculate the size of the large transaction
  const txn_size = large_transaction.toByte().length;
  
  // Calculate the minimum balance requirement increase for this larger transaction
  const add_txn_cost = await appClient.arc55MbrTxnIncrease(
    {
      transactionSize: large_transaction.toByte().length,
    },
    {
      sender: accounts[0],
    }
  );

  // Create a payment to cover the additional storage costs
  // Subtracting the previous cost since we're replacing the transaction
  const add_txn_mbr2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: accounts[0].addr,
    to: deployment.appAddress,
    amount: <bigint>add_txn_cost.return - <bigint>txn_cost.return + 100000n, // We subtract the previous cost, but keep the min 0.1 ALGO
    suggestedParams: await algod.getTransactionParams().do(),
  });
  
  // Set up box references for transaction replacement
  boxes = Array.from({ length: 8 }, () => ({ appIndex: 0, name: combineUint64AndUint8(Number(transaction_group), 0) }));
  
  // Start adding the large transaction in chunks
  // First chunk is added in a special way to establish the transaction
  const add_txn2 = await appClient.compose().arc55AddTransaction(
    {
      costs: add_txn_mbr2,
      transactionGroup: transaction_group,
      index: 0,
      transaction: large_transaction.toByte().slice(0, 2000), // First 2000 bytes
    },
    {
      sender: accounts[0],
      boxes: boxes,
    }
  );
  
  // Add the remaining chunks of the large transaction
  // This is necessary because Algorand has limits on box storage size
  for (let n = 1; n < txn_size / 2000; n++) {
    await add_txn2.arc55AddTransactionContinued(
      {
        transaction: large_transaction.toByte().slice(2000 * n, 2000 * (n + 1)),
      },
      {
        sender: accounts[0],
      }
    );
  }
  
  // Execute the transaction addition
  await add_txn2.execute();

  // Now we need to sign the transaction with one of the multisig accounts
  // Generate signature data for the first account
  const sig_data = new Uint8Array(large_transaction.rawSignTxn(accounts[0].sk));
  
  // Calculate the minimum balance requirement for storing signatures
  txn_cost = await appClient.arc55MbrSigIncrease(
    {
      signaturesSize: sig_data.length,
    },
    {
      sender: accounts[0],
    }
  );
  
  // Create a payment to cover the signature storage costs
  const set_sig_mbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: accounts[0].addr,
    to: deployment.appAddress,
    amount: txn_cost.return as bigint,
    suggestedParams: await algod.getTransactionParams().do(),
  });
  
  // Set up box references for signature storage
  // Note: These boxes are keyed by address+transaction_group
  const add = accounts[0].addr;
  boxes = Array.from({ length: 8 }, () => ({
    appIndex: 0,
    name: combineAddressAndUint64(add, Number(transaction_group)),
  }));
  
  // Add the signature to the contract
  const set_sig = await appClient.arc55SetSignatures(
    {
      costs: set_sig_mbr,
      transactionGroup: transaction_group,
      signatures: [sig_data],
    },
    {
      sender: accounts[0],
      boxes: boxes,
    }
  );

  // Demonstrating how to clear signatures
  // This might be needed if a signer wants to revoke their signature
  boxes = Array.from({ length: 8 }, () => ({
    appIndex: 0,
    name: combineAddressAndUint64(add, Number(transaction_group)),
  }));
  const clear_sig = await appClient.arc55ClearSignatures(
    {
      transactionGroup: transaction_group,
      address: accounts[0].addr,
    },
    {
      sender: accounts[0],
      boxes: boxes,
      sendParams: {
        fee: algokit.microAlgos(2000), // Specify a higher fee for this operation
      },
    }
  );

  // Remove the transaction from the group
  // This cleans up the storage used by the transaction
  boxes = Array.from({ length: 8 }, () => ({ appIndex: 0, name: combineUint64AndUint8(Number(transaction_group), 0) }));
  const remove_txn = await appClient.arc55RemoveTransaction(
    {
      transactionGroup: transaction_group,
      index: 0,
    },
    {
      sender: accounts[0],
      boxes: boxes,
      sendParams: {
        fee: algokit.microAlgos(2000), // Specify a higher fee
      },
    }
  );

  // Finally, destroy the multisig application
  // This cleans up all resources used by the application
  const destroy_txn = await appClient.delete.destroy(
    {},
    {
      sender: accounts[0],
      sendParams: {
        fee: algokit.microAlgos(2000), // Specify a higher fee
      },
    }
  );
})();