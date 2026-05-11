import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const payerPrivateKey = generatePrivateKey();
const payer = privateKeyToAccount(payerPrivateKey);

const recipientPrivateKey = generatePrivateKey();
const recipient = privateKeyToAccount(recipientPrivateKey);

console.log("Generated disposable Base Sepolia test wallets.");
console.log("");
console.log("Payer address:");
console.log(payer.address);
console.log("");
console.log("Payer private key for PK:");
console.log(payerPrivateKey);
console.log("");
console.log("Recipient address for PAY_TO_ADDRESS:");
console.log(recipient.address);
console.log("");
console.log("Use these only for testnet funds. Do not send mainnet assets here.");
