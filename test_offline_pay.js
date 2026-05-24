const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fingerpaydb';
const JWT_SECRET = process.env.JWT_SECRET || 'fingerpay2026';
const PORT = process.env.PORT || 3030;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to DB');

  // Safely clear only previous test users and their transactions
  const testPhones = ['9876543210', '8765432109'];
  const existingUsers = await mongoose.connection.db.collection('users').find({
    phone: { $in: testPhones }
  }).toArray();
  const existingIds = existingUsers.map(u => u._id);

  if (existingIds.length > 0) {
    await mongoose.connection.db.collection('transactions').deleteMany({
      userId: { $in: existingIds }
    });
  }

  await mongoose.connection.db.collection('users').deleteMany({
    phone: { $in: testPhones }
  });

  const passwordHash = await bcrypt.hash('password123', 10);
  const secretCodeHash = await bcrypt.hash('AB12CD', 10);

  // Create User A (Sender)
  const userA = await mongoose.connection.db.collection('users').insertOne({
    fpUserId: 'FP-USERAA',
    name: 'Sender User',
    email: 'sender@test.com',
    phone: '9876543210',
    passwordHash,
    fpHash: 'sender_fp_hash',
    secretCodeHash,
    walletBalance: 1000,
    linkedBanks: [],
    createdAt: new Date()
  });

  // Create User B (Receiver)
  const userB = await mongoose.connection.db.collection('users').insertOne({
    fpUserId: 'FP-USERBB',
    name: 'Receiver User',
    email: 'receiver@test.com',
    phone: '8765432109',
    passwordHash,
    fpHash: 'receiver_fp_hash',
    secretCodeHash,
    walletBalance: 200,
    linkedBanks: [],
    createdAt: new Date()
  });

  console.log('Seeded users:', { senderId: userA.insertedId, receiverId: userB.insertedId });

  // Generate JWT token for User A
  const token = jwt.sign({ userId: userA.insertedId.toString() }, JWT_SECRET);
  console.log('Generated token for User A:', token);

  const response = await fetch(`http://localhost:${PORT}/api/wallet/offline-pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      recipientPhone: '8765432109',
      amount: 150,
      secretCode: 'AB12CD'
    })
  });

  console.log('First Payment Response Status:', response.status);
  console.log('First Payment Response Data:', await response.json());

  // Second payment
  const response2 = await fetch(`http://localhost:${PORT}/api/wallet/offline-pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      recipientPhone: '8765432109',
      amount: 100,
      secretCode: 'AB12CD'
    })
  });

  console.log('Second Payment Response Status:', response2.status);
  console.log('Second Payment Response Data:', await response2.json());

  // Let's verify the transactions in DB
  const txs = await mongoose.connection.db.collection('transactions').find({}).toArray();
  console.log('Transactions in DB:', txs);

  // Check balances
  const updatedA = await mongoose.connection.db.collection('users').findOne({ _id: userA.insertedId });
  const updatedB = await mongoose.connection.db.collection('users').findOne({ _id: userB.insertedId });
  console.log('Updated Wallet Balances:', {
    sender: updatedA.walletBalance,
    receiver: updatedB.walletBalance
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
