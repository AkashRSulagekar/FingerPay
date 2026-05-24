const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fingerpaydb';
const JWT_SECRET = process.env.JWT_SECRET || 'fingerpay2026';
const PORT = process.env.PORT || 3030;

function hashPasskey(passkey) {
  if (!passkey) return '';
  return crypto.createHash('sha256').update(passkey).digest('hex');
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to DB');

  const senderPhone = '9000000001';
  const receiverPhone = '9000000002';

  // Clear previous test users if any (safely)
  await mongoose.connection.db.collection('users').deleteMany({
    phone: { $in: [senderPhone, receiverPhone] }
  });
  
  const passwordHash = await bcrypt.hash('password123', 10);
  const secretCodeHash = await bcrypt.hash('AB12CD', 10);
  const hashedFp = hashPasskey('senderpass');

  // Create Sender (Guest User)
  const senderInsert = await mongoose.connection.db.collection('users').insertOne({
    fpUserId: 'FP-SENDER',
    name: 'Guest Sender User',
    email: 'guestsender@test.com',
    phone: senderPhone,
    passwordHash,
    fpHash: hashedFp,
    secretCodeHash,
    walletBalance: 500,
    linkedBanks: [
      {
        bankName: 'HDFC Bank',
        accountNumber: '111122223333',
        ifscCode: 'HDFC0000123',
        accountHolderName: 'Guest Sender User',
        isPrimary: true,
        balance: 1000
      }
    ],
    createdAt: new Date()
  });

  // Create Receiver (Current Logged In User)
  const receiverInsert = await mongoose.connection.db.collection('users').insertOne({
    fpUserId: 'FP-RECEIVER',
    name: 'Guest Receiver User',
    email: 'guestreceiver@test.com',
    phone: receiverPhone,
    passwordHash,
    fpHash: hashPasskey('receiverpass'),
    secretCodeHash,
    walletBalance: 200,
    linkedBanks: [],
    createdAt: new Date()
  });

  console.log('Seeded test users');

  // Generate JWT token for Receiver
  const token = jwt.sign({ userId: receiverInsert.insertedId.toString() }, JWT_SECRET);

  // 1. Test /api/guest/linked-banks
  console.log('Testing /api/guest/linked-banks...');
  const lookupResp = await fetch(`http://localhost:${PORT}/api/guest/linked-banks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fpHash: 'senderpass' })
  });
  const lookupData = await lookupResp.json();
  console.log('Lookup Response Status:', lookupResp.status);
  console.log('Lookup Response Data:', lookupData);

  if (lookupResp.status !== 200 || !lookupData.linkedBanks || lookupData.linkedBanks.length === 0) {
    throw new Error('Lookup failed or returned no banks');
  }

  // 2. Test /api/guest/pay (Wallet option)
  console.log('Testing /api/guest/pay (Wallet)...');
  const payWalletResp = await fetch(`http://localhost:${PORT}/api/guest/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      fpHash: 'senderpass',
      secretCode: '  ab12cd  ',
      amount: 100,
      payFrom: 'Wallet'
    })
  });
  const payWalletData = await payWalletResp.json();
  console.log('Pay Wallet Status:', payWalletResp.status);
  console.log('Pay Wallet Data:', payWalletData);

  if (payWalletResp.status !== 200 || !payWalletData.success) {
    throw new Error('Pay Wallet failed');
  }

  // 3. Test /api/guest/pay (Bank option - to make sure multiple payments work!)
  console.log('Testing /api/guest/pay (Bank Account)...');
  const payBankResp = await fetch(`http://localhost:${PORT}/api/guest/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      fpHash: 'senderpass',
      secretCode: 'ab12cd',
      amount: 250,
      payFrom: '111122223333'
    })
  });
  const payBankData = await payBankResp.json();
  console.log('Pay Bank Status:', payBankResp.status);
  console.log('Pay Bank Data:', payBankData);

  if (payBankResp.status !== 200 || !payBankData.success) {
    throw new Error('Pay Bank failed');
  }

  // 4. Verify balances
  const updatedSender = await mongoose.connection.db.collection('users').findOne({ _id: senderInsert.insertedId });
  const updatedReceiver = await mongoose.connection.db.collection('users').findOne({ _id: receiverInsert.insertedId });

  console.log('Updated balances in DB:');
  console.log('Sender Wallet:', updatedSender.walletBalance); // 500 - 100 = 400
  console.log('Sender Bank Account Balance:', updatedSender.linkedBanks[0].balance); // 1000 - 250 = 750
  console.log('Receiver Wallet:', updatedReceiver.walletBalance); // 200 + 100 + 250 = 550

  if (updatedSender.walletBalance !== 400) throw new Error('Sender wallet balance mismatch');
  if (updatedSender.linkedBanks[0].balance !== 750) throw new Error('Sender bank balance mismatch');
  if (updatedReceiver.walletBalance !== 550) throw new Error('Receiver wallet balance mismatch');

  // Verify Transactions in DB
  const txs = await mongoose.connection.db.collection('transactions').find({
    userId: { $in: [senderInsert.insertedId, receiverInsert.insertedId] }
  }).toArray();
  console.log(`Found ${txs.length} transactions in DB for test users:`, txs.map(t => ({
    txnId: t.txnId,
    userId: t.userId.toString(),
    amount: t.amount,
    type: t.type
  })));

  if (txs.length !== 4) {
    throw new Error(`Expected 4 transactions (2 debits + 2 credits), found ${txs.length}`);
  }

  // Clean up
  await mongoose.connection.db.collection('users').deleteMany({
    phone: { $in: [senderPhone, receiverPhone] }
  });
  await mongoose.connection.db.collection('transactions').deleteMany({
    userId: { $in: [senderInsert.insertedId, receiverInsert.insertedId] }
  });
  console.log('Test passed successfully and cleaned up!');
  process.exit(0);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
