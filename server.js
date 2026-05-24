// ==================== FingerPay Backend — HTTP (Mobile Working) ====================

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
dotenv.config();
const app = express();

// Use body-parser so we can access raw body for webhook signature verification
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public'))); // serve frontend

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const JWT_SECRET = process.env.JWT_SECRET || 'fingerpay-secret-change-in-prod';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fingerpaydb';
const PORT = process.env.PORT || 2000;



// ==================== GET LOCAL IP ====================
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ==================== CONNECT MONGODB ====================
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB error:', err));

// ==================== SCHEMAS ====================
const BankSchema = new mongoose.Schema({
  bankName: String,
  accountNumber: String,
  ifscCode: String,
  accountHolderName: String,
  isPrimary: { type: Boolean, default: false },
  balance: { type: Number, default: 0 },
});

// ===== Helpers for ledger updates =====
function findPrimaryBank(user) {
  return (user.linkedBanks || []).find(b => b.isPrimary);
}

function findUserByPhone(phone) {
  return User.findOne({ phone: phone });
}

async function generateUniqueFPUserId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let isUnique = false;
  let customId = '';
  while (!isUnique) {
    customId = 'FP-';
    for (let i = 0; i < 6; i++) {
      customId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const existing = await User.findOne({ fpUserId: customId });
    if (!existing) {
      isUnique = true;
    }
  }
  return customId;
}

const UserSchema = new mongoose.Schema({
  fpUserId: { type: String, unique: true, sparse: true },
  name: String,
  email: { type: String, unique: true, sparse: true },
  phone: { type: String, unique: true, sparse: true },
  passwordHash: String,
  fpHash: String,
  secretCodeHash: String,
  walletBalance: { type: Number, default: 0 }, // switched to 0 for real payment flows
  linkedBanks: [BankSchema],
  createdAt: { type: Date, default: Date.now },
});

const TransactionSchema = new mongoose.Schema({
  txnId: String,
  userId: mongoose.Schema.Types.ObjectId,
  type: String,
  amount: Number,
  // credited is used for wallet top-ups to prevent double-crediting
  credited: { type: Boolean, default: false },
  meta: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

// ==================== AUTH ====================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ==================== BANK HELPERS ====================
function getPrimaryBank(user) {
  return (user.linkedBanks || []).find(b => b.isPrimary);
}

function maskPhone(phone) {
  const s = String(phone || '');
  return s.length > 4 ? s.slice(-4) : s;
}

function normalizeSecretCode(code) {
  if (!code) return '';
  return String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashPasskey(passkey) {
  if (!passkey) return '';
  const normalized = String(passkey).trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ==================== WALLET TRANSFERS (ACCOUNT TO ACCOUNT) ====================

// POST /api/wallet/transfer
// body: { toPhone, amount }
// internal ledger move wallet -> wallet between registered users
app.post('/api/wallet/transfer', authMiddleware, async (req, res) => {

  try {

    const {
      toPhone,
      amount,
      note
    } = req.body;

    const amt = Number(amount);

    if (!toPhone) {
      return res.status(400).json({
        error: 'Missing toPhone'
      });
    }

    if (!amt || amt <= 0) {
      return res.status(400).json({
        error: 'Invalid amount'
      });
    }

    const sender =
      await User.findById(req.userId);

    const receiver =
      await User.findOne({
        phone: toPhone
      });

    if (!sender || !receiver) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    if (sender.walletBalance < amt) {
      return res.status(400).json({
        error: 'Insufficient wallet balance'
      });
    }

    // ==================== TRANSFER ====================

    sender.walletBalance -= amt;

    receiver.walletBalance += amt;

    await sender.save();

    await receiver.save();

    const txnId =
      `wallet-transfer-${Date.now()}`;

    await Transaction.create({

      txnId,

      userId: sender._id,

      type: 'wallet-transfer',

      amount: amt,

      meta: {

        toPhone,

        receiver:
          receiver.name,

        note: note || ''

      }

    });

    res.json({

      success: true,

      txnId,

      senderWallet:
        sender.walletBalance,

      receiverWallet:
        receiver.walletBalance

    });

  } catch (err) {

    console.error(
      'wallet transfer error:',
      err
    );

    res.status(500).json({
      error: 'Wallet transfer failed'
    });

  }

});



// REGISTER (improved: check duplicates and return user info)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, fpHash, secretCode } = req.body;
    console.log('📝 Registration attempt:', { name, email, phone, fpHash });

    if (!name || (!email && !phone) || !password) {
      console.warn('⚠️ Missing fields in registration request');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!fpHash) {
      return res.status(400).json({ error: 'Passkey is required' });
    }

    const hashedFp = hashPasskey(fpHash);

    // Verify that the passkey is unique
    const existingPasskey = await User.findOne({ fpHash: hashedFp });
    if (existingPasskey) {
      return res.status(409).json({ error: 'This passkey is already in use by another user' });
    }

    const existing = await User.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      console.warn('⚠️ Duplicate registration attempt for email/phone');
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const normalizedCode = normalizeSecretCode(secretCode);
    const secretCodeHash = normalizedCode ? await bcrypt.hash(normalizedCode, 10) : undefined;
    const fpUserId = await generateUniqueFPUserId();

    const user = await User.create({
      fpUserId,
      name,
      email,
      phone,
      passwordHash,
      fpHash: hashedFp,
      secretCodeHash,
    });

    console.log('✅ User saved to MongoDB:', user._id);

    const token = jwt.sign({ userId: user._id }, JWT_SECRET);

    res.json({ token, user: { id: user._id, fpUserId: user.fpUserId, name: user.name, email: user.email, phone: user.phone, walletBalance: user.walletBalance, linkedBanks: user.linkedBanks || [] } });

  } catch (err) {
    console.error('❌ Register error:', err);
    res.status(500).json({ error: 'Register failed' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { emailOrPhone, password } = req.body;

  const user = await User.findOne({
    $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Wrong password' });

  if (!user.fpUserId) {
    user.fpUserId = await generateUniqueFPUserId();
    await user.save();
  }

  const token = jwt.sign({ userId: user._id }, JWT_SECRET);
  res.json({ token, user: { id: user._id, fpUserId: user.fpUserId, name: user.name, email: user.email, phone: user.phone, walletBalance: user.walletBalance, linkedBanks: user.linkedBanks || [] } });
});

// GET current user
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId).select('-passwordHash -secretCodeHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.fpUserId) {
    user.fpUserId = await generateUniqueFPUserId();
    await user.save();
  }
  res.json({ user });
});

// LOGIN WITH PASSKEY (Replaces fingerprint scan)
app.post('/api/auth/login/fp', async (req, res) => {
  try {
    const { fpHash } = req.body; // plain text passkey from frontend
    if (!fpHash) return res.status(400).json({ error: 'Missing passkey' });

    const hashedFp = hashPasskey(fpHash);
    const user = await User.findOne({ fpHash: hashedFp }).select('-passwordHash -secretCodeHash');
    if (!user) return res.status(404).json({ error: 'Invalid passkey or user not registered' });

    if (!user.fpUserId) {
      user.fpUserId = await generateUniqueFPUserId();
      await user.save();
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET);
    res.json({
      token,
      user: {
        id: user._id,
        fpUserId: user.fpUserId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        walletBalance: user.walletBalance,
        linkedBanks: user.linkedBanks || [],
      },
    });
  } catch (err) {
    console.error('Passkey login error:', err);
    res.status(500).json({ error: 'Passkey login failed' });
  }
});


// LINK BANK
// -------------------- DEMO BANK PRESETS --------------------
const DEMO_BANKS = [
  {
    bankName: 'HDFC Bank',
    accountNumber: '4821000004821',
    ifscCode: 'HDFC00004821',
    accountHolderName: 'FingerPay Demo',
    defaultBalance: 10000,
  },
  {
    bankName: 'SBI',
    accountNumber: '7734000007734',
    ifscCode: 'SBIN00007734',
    accountHolderName: 'FingerPay Demo',
    defaultBalance: 10000,
  },
  {
    bankName: 'ICICI Bank',
    accountNumber: '1052000001052',
    ifscCode: 'ICIC00001052',
    accountHolderName: 'FingerPay Demo',
    defaultBalance: 10000,
  },
  {
    bankName: 'Axis Bank',
    accountNumber: '9106000009106',
    ifscCode: 'UTIB00009106',
    accountHolderName: 'FingerPay Demo',
    defaultBalance: 10000,
  },
];

app.get('/api/banks/demo', authMiddleware, async (req, res) => {
  // return only preset metadata (no user balances)
  res.json({
    success: true, demoBanks: DEMO_BANKS.map(b => ({
      bankName: b.bankName,
      accountNumber: b.accountNumber,
      ifscCode: b.ifscCode,
      accountHolderName: b.accountHolderName,
      defaultBalance: b.defaultBalance,
    }))
  });
});

app.post('/api/banks/link-demo', authMiddleware, async (req, res) => {
  try {
    const { demoAccountNumber, isPrimary } = req.body;
    if (!demoAccountNumber) return res.status(400).json({ error: 'Missing demoAccountNumber' });

    const demo = DEMO_BANKS.find(b => String(b.accountNumber) === String(demoAccountNumber));
    if (!demo) return res.status(404).json({ error: 'Demo bank account not found' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // prevent duplicates by accountNumber
    const already = (user.linkedBanks || []).some(b => String(b.accountNumber) === String(demo.accountNumber));
    if (already) {
      return res.status(409).json({ error: 'Demo bank already linked to this user' });
    }

    if (isPrimary) {
      user.linkedBanks.forEach(b => (b.isPrimary = false));
    }

    user.linkedBanks.push({
      bankName: demo.bankName,
      accountNumber: demo.accountNumber,
      ifscCode: demo.ifscCode,
      accountHolderName: demo.accountHolderName,
      isPrimary: !!isPrimary,
      balance: demo.defaultBalance,
    });

    await user.save();
    return res.json({ success: true, linkedBanks: user.linkedBanks });
  } catch (err) {
    console.error('link-demo error:', err);
    return res.status(500).json({ error: 'Failed to link demo bank' });
  }
});

// LINK BANK (manual)
app.post('/api/banks/link', authMiddleware, async (req, res) => {
  const { bankName, accountNumber, ifscCode, accountHolderName, isPrimary } = req.body;
  if (!bankName || !accountNumber || !ifscCode || !accountHolderName) return res.status(400).json({ error: 'Missing bank details' });

  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (isPrimary) {
    user.linkedBanks.forEach(b => (b.isPrimary = false));
  }

  // Demo: auto-seed every newly linked bank with sufficient balance.
  const DEMO_BANK_START_BALANCE = 10000;

  // Ensure linkedBanks stored in the expected format for later top-up debit selection
  user.linkedBanks.push({
    bankName,
    accountNumber: String(accountNumber),
    ifscCode,
    accountHolderName,
    isPrimary: !!isPrimary,
    balance: DEMO_BANK_START_BALANCE,
  });

  await user.save();

  res.json({ success: true, linkedBanks: user.linkedBanks });
});


// DASHBOARD — return user info + recent transactions
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.fpUserId) {
    user.fpUserId = await generateUniqueFPUserId();
    await user.save();
  }

  const recentTransactions = await Transaction.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const bankBalancesSum = (user.linkedBanks || []).reduce((sum, b) => sum + Number(b.balance || 0), 0);
  const totalBalance = bankBalancesSum + (Number(user.walletBalance) || 0);

  res.json({
    user: {
      id: user._id,
      fpUserId: user.fpUserId,
      name: user.name,
      walletBalance: user.walletBalance,
      totalBalance,
      linkedBanks: user.linkedBanks,
    },
    recentTransactions,
  });
});


// GUEST: get linked banks by passkey (replaces fingerprint)
// body: { fpHash, secretCode }
// returns: { linkedBanks: [...] }
app.post('/api/guest/linked-banks', async (req, res) => {
  try {
    const { fpHash } = req.body; // plain text passkey from frontend
    if (!fpHash) return res.status(400).json({ error: 'Missing passkey' });

    const hashedFp = hashPasskey(fpHash);
    const user = await User.findOne({ fpHash: hashedFp }).select('linkedBanks walletBalance name');
    if (!user) return res.status(404).json({ error: 'Invalid passkey or user not registered' });

    // Return banks + wallet as an extra pseudo-account so UI can list wallet option.
    // Also ensure bank balances show up (default 0 if not stored).
    return res.json({
      linkedBanks: (user.linkedBanks || []).map(b => ({
        bankName: b.bankName,
        accountNumber: b.accountNumber,
        ifscCode: b.ifscCode,
        accountHolderName: b.accountHolderName,
        isPrimary: !!b.isPrimary,
        balance: Number(b.balance || 0),
      })),
      walletBalance: Number(user.walletBalance || 0),
      userName: user.name,
    });

  } catch (err) {
    console.error('Guest linked-banks error:', err);
    res.status(500).json({ error: 'Failed to lookup linked banks' });
  }
});

// POST /api/guest/pay
// Deduct from guest user's bank account or wallet, add to current user's wallet.
app.post('/api/guest/pay', authMiddleware, async (req, res) => {
  try {
    const { fpHash, secretCode, amount, payFrom } = req.body;
    const amt = Number(amount);

    if (!fpHash) return res.status(400).json({ error: 'Guest passkey is required' });
    if (!secretCode) return res.status(400).json({ error: 'Guest secret code is required' });
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!payFrom) return res.status(400).json({ error: 'Payment source is required' });

    // 1. Fetch current user (receiver)
    const receiver = await User.findById(req.userId);
    if (!receiver) return res.status(404).json({ error: 'Current user (receiver) not found' });

    // 2. Fetch guest user (sender)
    const hashedFp = hashPasskey(fpHash);
    const sender = await User.findOne({ fpHash: hashedFp }).select('+secretCodeHash');
    if (!sender) return res.status(404).json({ error: 'Guest user not found' });

    // Prevent self-payment
    if (String(sender._id) === String(receiver._id)) {
      return res.status(400).json({ error: 'Cannot pay to yourself' });
    }

    // 3. Verify guest secret code
    if (!sender.secretCodeHash) {
      return res.status(400).json({ error: 'Guest user has no secret code set' });
    }
    const normalizedCode = normalizeSecretCode(secretCode);
    const match = await bcrypt.compare(normalizedCode, sender.secretCodeHash);
    if (!match) return res.status(401).json({ error: 'Wrong secret code' });

    // 4. Perform payment
    if (payFrom === 'Wallet') {
      if (sender.walletBalance < amt) return res.status(400).json({ error: 'Insufficient guest wallet balance' });
      sender.walletBalance -= amt;
    } else {
      const bank = sender.linkedBanks.find(b => String(b.accountNumber) === String(payFrom));
      if (!bank) return res.status(403).json({ error: 'Linked guest bank account not found' });
      if (bank.balance < amt) return res.status(400).json({ error: 'Insufficient bank balance' });
      bank.balance -= amt;
    }

    // Credit current user's wallet
    receiver.walletBalance = (receiver.walletBalance || 0) + amt;

    await sender.save();
    await receiver.save();

    // 5. Store transactions in database for both
    const txnId = `guest_pay_${Date.now()}`;

    // Sender (guest user - debit)
    await Transaction.create({
      txnId: `${txnId}-dr`,
      userId: sender._id,
      type: 'offline-payment',
      amount: amt,
      meta: {
        receiver: receiver.name,
        payFrom
      }
    });

    // Receiver (current user - credit)
    await Transaction.create({
      txnId: `${txnId}-cr`,
      userId: receiver._id,
      type: 'offline-payment',
      amount: -amt,
      meta: {
        sender: sender.name,
        payFrom
      }
    });

    res.json({ success: true, txnId });
  } catch (err) {
    console.error('Guest payment error:', err);
    res.status(500).json({ error: 'Guest payment failed' });
  }
});

// ==================== INTERNAL PAYMENT SYSTEM ====================

app.post('/api/pay', authMiddleware, async (req, res) => {
  try {
    const { amount, payFrom, merchantName, secretCode } = req.body; // payFrom can be 'Wallet' or a bank account number
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!payFrom) return res.status(400).json({ error: 'Payment source is required' });
    if (!secretCode) return res.status(400).json({ error: 'Secret code is required' });

    const user = await User.findById(req.userId).select('+secretCodeHash');
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify secret code
    if (!user.secretCodeHash) {
      return res.status(400).json({ error: 'User has no secret code set' });
    }
    const normalizedCode = normalizeSecretCode(secretCode);
    const match = await bcrypt.compare(normalizedCode, user.secretCodeHash);
    if (!match) return res.status(401).json({ error: 'Wrong secret code' });

    const txnId = `fp_pay_${Date.now()}`;

    if (payFrom === 'Wallet') {
      if (user.walletBalance < amt) return res.status(400).json({ error: 'Insufficient wallet balance' });
      user.walletBalance -= amt;
    } else {
      const bank = user.linkedBanks.find(b => String(b.accountNumber) === String(payFrom));
      if (!bank) return res.status(403).json({ error: 'Linked bank account not found' });
      if (bank.balance < amt) return res.status(400).json({ error: 'Insufficient bank balance' });
      bank.balance -= amt;
    }

    await user.save();

    const txn = await Transaction.create({
      txnId,
      userId: user._id,
      type: 'qr',
      amount: amt,
      meta: { payFrom, merchantName: merchantName || 'QR Payment' },
    });

    res.json({ success: true, txnId: txn.txnId });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ error: 'Payment failed' });
  }
});

// WALLET TOPUP (Internal Simulation)
app.post('/api/wallet/topup', authMiddleware, async (req, res) => {
  try {
    const { amount, fromBankAccountNumber } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let bank;
    if (fromBankAccountNumber) {
      bank = user.linkedBanks.find(b => String(b.accountNumber) === String(fromBankAccountNumber));
      if (!bank) return res.status(404).json({ error: 'Bank account not found' });
    } else {
      if (!user.linkedBanks || user.linkedBanks.length === 0) {
        return res.status(400).json({ error: 'No linked bank accounts found. Please link a bank first.' });
      } else if (user.linkedBanks.length === 1) {
        bank = user.linkedBanks[0];
      } else {
        return res.status(400).json({ error: 'Multiple bank accounts found. Please select which bank to debit.' });
      }
    }

    if (bank.balance < amt) {
      return res.status(400).json({ error: 'Insufficient balance in bank account' });
    }

    bank.balance -= amt;
    user.walletBalance = (user.walletBalance || 0) + amt;
    await user.save();

    const txnId = `wallet_topup_${Date.now()}`;
    await Transaction.create({
      txnId,
      userId: user._id,
      type: 'wallet-topup',
      amount: amt,
      meta: { fromBankAccountNumber: bank.accountNumber },
    });

    res.json({ success: true, txnId, walletBalance: user.walletBalance, bankBalance: bank.balance });
  } catch (err) {
    console.error('Topup error:', err);
    res.status(500).json({ error: 'Topup failed' });
  }
});

// POST /api/bank/transfer
app.post('/api/bank/transfer', authMiddleware, async (req, res) => {
  try {
    const { toPhone, amount, fromBankAccountNumber, note, secretCode } = req.body;
    const amt = Number(amount);

    if (!toPhone) return res.status(400).json({ error: 'Recipient phone number is required' });
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!secretCode) return res.status(400).json({ error: 'Secret code is required' });

    // 1. Fetch sender
    const sender = await User.findById(req.userId).select('+secretCodeHash');
    if (!sender) return res.status(404).json({ error: 'Sender not found' });

    // Verify secret code
    if (!sender.secretCodeHash) {
      return res.status(400).json({ error: 'Sender has no secret code set' });
    }
    const normalizedCode = normalizeSecretCode(secretCode);
    const match = await bcrypt.compare(normalizedCode, sender.secretCodeHash);
    if (!match) return res.status(401).json({ error: 'Wrong secret code' });

    // 2. Fetch receiver
    const receiver = await User.findOne({ phone: toPhone });
    if (!receiver) return res.status(404).json({ error: 'No account found' });

    // Prevent self-transfer
    if (sender.phone === toPhone) {
      return res.status(400).json({ error: 'Cannot transfer to your own phone number' });
    }

    // 3. Determine which bank of receiver to credit
    if (!receiver.linkedBanks || receiver.linkedBanks.length === 0) {
      return res.status(400).json({ error: 'Recipient has no linked bank accounts to receive funds' });
    }
    const receiverBank = receiver.linkedBanks.find(b => b.isPrimary) || receiver.linkedBanks[0];

    // 4. Determine which bank of sender to debit
    let senderBank;
    if (fromBankAccountNumber) {
      senderBank = sender.linkedBanks.find(b => String(b.accountNumber) === String(fromBankAccountNumber));
      if (!senderBank) return res.status(404).json({ error: 'Selected bank account not found' });
    } else {
      if (!sender.linkedBanks || sender.linkedBanks.length === 0) {
        return res.status(400).json({ error: 'No linked bank accounts found. Please link a bank first.' });
      }
      senderBank = sender.linkedBanks.find(b => b.isPrimary);
      if (!senderBank) {
        if (sender.linkedBanks.length === 1) {
          senderBank = sender.linkedBanks[0];
        } else {
          return res.status(400).json({ error: 'Multiple linked banks found. Please select which bank to debit.' });
        }
      }
    }

    // 5. Balance check
    if (senderBank.balance < amt) {
      return res.status(400).json({ error: 'Insufficient balance in bank account' });
    }

    // 6. Deduct and Credit
    senderBank.balance -= amt;
    receiverBank.balance = (receiverBank.balance || 0) + amt;

    // Save both
    await sender.save();
    await receiver.save();

    // 7. Store Transaction in database for sender (debit)
    const txnId = `bank_transfer_${Date.now()}`;
    await Transaction.create({
      txnId: `${txnId}-dr`,
      userId: sender._id,
      type: 'phone',
      amount: amt,
      meta: {
        toPhone,
        receiver: receiver.name,
        fromBankAccountNumber: senderBank.accountNumber,
        toBankAccountNumber: receiverBank.accountNumber,
        note: note || ''
      }
    });

    // Store Transaction in database for receiver (credit)
    await Transaction.create({
      txnId: `${txnId}-cr`,
      userId: receiver._id,
      type: 'phone',
      amount: -amt,
      meta: {
        fromPhone: sender.phone,
        sender: sender.name,
        fromBankAccountNumber: senderBank.accountNumber,
        toBankAccountNumber: receiverBank.accountNumber,
        note: note || ''
      }
    });

    res.json({
      success: true,
      txnId,
      senderBankBalance: senderBank.balance
    });

  } catch (err) {
    console.error('Bank transfer error:', err);
    res.status(500).json({ error: 'Transfer failed' });
  }
});


// GET /api/users/lookup?phone=...
app.get('/api/users/lookup', authMiddleware, async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    const user = await User.findOne({ phone: phone });
    if (!user) {
      return res.status(404).json({ error: 'No account found' });
    }

    res.json({ success: true, name: user.name });
  } catch (err) {
    console.error('User lookup error:', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// POST /api/wallet/offline-pay
app.post('/api/wallet/offline-pay', authMiddleware, async (req, res) => {
  try {
    const { recipientPhone, amount, secretCode } = req.body;
    const amt = Number(amount);

    if (!recipientPhone) return res.status(400).json({ error: 'Recipient phone number is required' });
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!secretCode) return res.status(400).json({ error: 'Secret code is required' });

    // 1. Fetch sender
    const sender = await User.findById(req.userId).select('+secretCodeHash');
    if (!sender) return res.status(404).json({ error: 'Sender not found' });

    // Verify secret code
    if (!sender.secretCodeHash) {
      return res.status(400).json({ error: 'Sender has no secret code set' });
    }
    const normalizedCode = normalizeSecretCode(secretCode);
    const match = await bcrypt.compare(normalizedCode, sender.secretCodeHash);
    if (!match) return res.status(401).json({ error: 'Wrong secret code' });

    // 2. Fetch receiver
    const receiver = await User.findOne({ phone: recipientPhone });
    if (!receiver) return res.status(404).json({ error: 'No account found' });

    // 3. Prevent self-payment
    if (sender.phone === recipientPhone) {
      return res.status(400).json({ error: 'Cannot pay to your own phone number' });
    }

    // 4. Validate insufficient wallet balance
    if (sender.walletBalance < amt) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // 5. Transfer
    sender.walletBalance -= amt;
    receiver.walletBalance = (receiver.walletBalance || 0) + amt;

    await sender.save();
    await receiver.save();

    // 6. Create transaction record for the sender (debit)
    const txnId = `offline_pay_${Date.now()}`;

    await Transaction.create({
      txnId: `${txnId}-dr`,
      userId: sender._id,
      type: 'offline-payment',
      amount: amt,
      meta: {
        toPhone: recipientPhone,
        receiver: receiver.name,
      }
    });

    // Create transaction record for the receiver (credit)
    await Transaction.create({
      txnId: `${txnId}-cr`,
      userId: receiver._id,
      type: 'offline-payment',
      amount: -amt,
      meta: {
        fromPhone: sender.phone,
        sender: sender.name,
      }
    });

    res.json({
      success: true,
      txnId,
      walletBalance: sender.walletBalance
    });

  } catch (err) {
    console.error('Offline payment error:', err);
    res.status(500).json({ error: 'Offline payment failed' });
  }
});


// ==================== START SERVER ====================
const localIP = getLocalIP();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🚀 FingerPay Server Running');
  console.log(`💻 Laptop → http://localhost:${PORT}`);
  console.log(`📱 Phone  → http://${localIP}:${PORT}`);
  console.log('');
});