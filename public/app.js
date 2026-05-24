// ==================== FINGERPAY - WebAuthn Upgraded ====================

const state = {
  currentUser: null,
  authToken: localStorage.getItem('fp_token') || null,
  selectedAccount: null,
  guestFPScanned: false,
  registrationData: {},
  walletBalance: parseFloat(localStorage.getItem('fp_wallet') || '1200'),
  webAuthnCredentialId: localStorage.getItem('fp_credentialId') || null,
};

const API_BASE = (window.location.protocol === 'file:' || !['3000', '3030'].includes(window.location.port))
  ? 'http://localhost:3000'
  : '';

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.authToken) headers.Authorization = 'Bearer ' + state.authToken;
  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function saveSession(token, user) {
  state.authToken = token;
  state.currentUser = user;
  localStorage.setItem('fp_token', token);
  localStorage.setItem('fp_user', JSON.stringify(user));
}

function logoutUser() {
  state.currentUser = null;
  state.authToken = null;
  localStorage.removeItem('fp_token');
  localStorage.removeItem('fp_user');
  showPage('page-landing');
  showToast('Logged out successfully');
}

// ==================== WEBAUTHN HELPERS ====================

function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function isWebAuthnSupported() {
  return window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential === 'function';
}

async function isPlatformAuthAvailable() {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ==================== WEBAUTHN REGISTER ====================
async function registerFingerprint() {
  const secretCode = await showPasskeyModal({
    title: "Register Fingerprint",
    message: "Enter your unique secret code for registration:",
    placeholder: "Enter secret code",
    validate: (val) => {
      if (!val) return "Secret code is required.";
      return null;
    }
  });

  if (!secretCode) {
    showToast("⚠️ Registration cancelled. Secret code is required.");
    return;
  }

  // You can store the code locally or send it to your backend registration handler
  localStorage.setItem("userSecretCode", secretCode);

  showToast("🎉 Fingerprint registration simulated! Your secret code has been saved.");
}

// ==================== WEBAUTHN AUTHENTICATE ====================
async function authenticateFingerprint(credentialId = null) {
  const storedCode = localStorage.getItem("userSecretCode");
  if (!storedCode) {
    showToast('⚠️ No secret code found. Please register first.');
    return false;
  }

  const enteredCode = await showPasskeyModal({
    title: "Authenticate",
    message: "Enter your secret code to authenticate:",
    placeholder: "Enter secret code",
    validate: (val) => {
      if (!val) return "Secret code is required.";
      return null;
    }
  });

  if (enteredCode === storedCode) {
    showToast('✓ Authentication successful!');
    return true;
  } else {
    showToast('❌ Incorrect secret code.');
    return false;
  }
}

// ==================== PAGE NAVIGATION ====================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'page-guest-pay') {
    resetGuestPaymentState();
  }
}

function showDash(section) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('dash-' + section).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes(section))
      n.classList.add('active');
  });
  if (section === 'wallet') {
    resetOfflinePaymentState();
  }
}

// ==================== TOAST & MODAL ====================
function showToast(msg, duration = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}
function showModal(id) {
  document.getElementById(id).classList.add('active');
  if (id === 'modal-add-bank') {
    switchModalTab('demo');
  }
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (id === 'modal-success') {
    const guestPage = document.getElementById('page-guest-pay');
    if (guestPage && guestPage.classList.contains('active')) {
      resetGuestPaymentState();
    }
  }
}

function showPasskeyModal({ title, message, placeholder = "Enter alphanumeric passkey", validate }) {
  return new Promise((resolve) => {
    const modalEl = document.getElementById('modal-passkey');
    const titleEl = document.getElementById('passkey-title');
    const messageEl = document.getElementById('passkey-message');
    const inputEl = document.getElementById('passkey-input');
    const errorEl = document.getElementById('passkey-error');
    const saveBtn = document.getElementById('passkey-save-btn');
    const cancelBtn = document.getElementById('passkey-cancel-btn');

    titleEl.textContent = title;
    messageEl.textContent = message;
    inputEl.placeholder = placeholder;
    inputEl.value = "";
    errorEl.style.display = "none";
    errorEl.textContent = "";

    modalEl.classList.add('active');
    inputEl.focus();

    const handleCancel = () => {
      modalEl.classList.remove('active');
      resolve(null);
    };

    const handleSave = () => {
      const val = inputEl.value.trim();
      if (validate) {
        const errorMsg = validate(val);
        if (errorMsg) {
          errorEl.textContent = errorMsg;
          errorEl.style.display = "block";
          inputEl.focus();
          return;
        }
      }
      modalEl.classList.remove('active');
      resolve(val);
    };

    cancelBtn.onclick = handleCancel;
    saveBtn.onclick = handleSave;
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    };
  });
}


function switchModalTab(tab) {
  const demoBtn = document.getElementById('btn-tab-demo');
  const manualBtn = document.getElementById('btn-tab-manual');
  const demoContent = document.getElementById('modal-tab-demo');
  const manualContent = document.getElementById('modal-tab-manual');

  if (!demoBtn || !manualBtn || !demoContent || !manualContent) return;

  if (tab === 'demo') {
    demoBtn.classList.add('active');
    manualBtn.classList.remove('active');
    demoContent.classList.add('active');
    manualContent.classList.remove('active');
    loadDemoBanks();
  } else {
    manualBtn.classList.add('active');
    demoBtn.classList.remove('active');
    manualContent.classList.add('active');
    demoContent.classList.remove('active');
  }
}

async function loadDemoBanks() {
  const container = document.getElementById('demo-banks-list');
  if (!container) return;

  try {
    const resp = await apiRequest('/api/banks/demo');
    if (!resp.success || !resp.demoBanks) throw new Error('Failed to load demo banks');

    container.innerHTML = resp.demoBanks.map(bank => `
      <div class="demo-bank-card" onclick="linkDemoPreset('${bank.accountNumber}')">
        <div class="demo-bank-name">${bank.bankName}</div>
        <div class="demo-bank-balance">Balance: ₹${Number(bank.defaultBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        <div class="demo-bank-acc">Acc: ${maskAccount(bank.accountNumber)}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div style="grid-column: span 2; text-align: center; color: var(--danger); font-size: 0.85rem; padding: 1rem 0;">⚠️ ${err.message}</div>`;
  }
}

async function linkDemoPreset(demoAccountNumber) {
  try {
    showToast('⏳ Linking demo bank...');
    const resp = await apiRequest('/api/banks/link-demo', {
      method: 'POST',
      body: JSON.stringify({ demoAccountNumber, isPrimary: true })
    });
    closeModal('modal-add-bank');
    showToast('✓ Demo bank linked successfully!');
    await loadDashboardData();
  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

// ==================== REGISTRATION ====================
function goToStep(n) {
  if (n === 2) {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const pass = document.getElementById('reg-password').value.trim();
    if (!name || !email || !phone || !pass) { showToast('⚠️ Please fill all fields'); return; }
    if (!email.includes('@')) { showToast('⚠️ Invalid email'); return; }
    if (phone.replace(/\D/g, '').length < 10) { showToast('⚠️ Invalid phone number'); return; }
    if (pass.length < 6) { showToast('⚠️ Password too short'); return; }
    state.registrationData = { name, email, phone, password: pass };
  }
  if (n === 3 && !localStorage.getItem("userSecretCode")) { showToast('⚠️ Please register your fingerprint first'); return; }
  document.querySelectorAll('.reg-step').forEach(s => s.classList.remove('active'));
  document.getElementById('reg-step' + n).classList.add('active');
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i < n));
}

async function simulateFingerprint() {
  const status = document.getElementById('fp-status-reg');
  const area = document.getElementById('fp-register-area');
  const progress = document.getElementById('fp-progress');
  const bar = document.getElementById('fp-bar');
  const nextBtn = document.getElementById('fp-next-btn');

  status.textContent = '👆 Scanning finger...';
  area.style.borderColor = 'var(--accent)';
  progress.style.display = 'block';
  bar.style.width = '0%';

  // Animate the progress bar from 0% to 100% to simulate fingerprint scan
  let p = 0;
  await new Promise((resolve) => {
    const fakeProgress = setInterval(() => {
      p = Math.min(p + 10, 100);
      bar.style.width = p + '%';
      if (p >= 100) {
        clearInterval(fakeProgress);
        resolve();
      }
    }, 50);
  });

  const passkey = await showPasskeyModal({
    title: "Create Passkey",
    message: "Create a unique passkey for your account (alphanumeric):",
    placeholder: "e.g., ArjunPass123",
    validate: (val) => {
      if (!val) {
        return "Passkey cannot be empty.";
      }
      if (!/^[a-zA-Z0-9]+$/.test(val)) {
        return "Passkey must be alphanumeric (letters and numbers only).";
      }
      return null;
    }
  });

  if (passkey === null) {
    // User cancelled
    status.textContent = 'Click / Tap to scan fingerprint';
    status.style.color = '';
    area.style.borderColor = '';
    progress.style.display = 'none';
    bar.style.width = '0%';
    return;
  }


  localStorage.setItem("userSecretCode", passkey);

  status.textContent = '✓ Passkey Created!';
  status.style.color = 'var(--accent3)';
  area.style.borderStyle = 'solid';
  area.style.borderColor = 'var(--accent3)';
  nextBtn.disabled = false;
  showToast('🫆 Passkey saved for registration!');
}

// ==================== SECRET CODE ====================
function moveCode(i) {
  const ids = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
  const box = document.getElementById(ids[i]);
  box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (box.value && i < 5) document.getElementById(ids[i + 1]).focus();
  validateCodeRules();
}
function moveConfirm(i) {
  const ids = ['cc0', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5'];
  const box = document.getElementById(ids[i]);
  box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (box.value && i < 5) document.getElementById(ids[i + 1]).focus();
}
function getCodeValue(prefix) {
  let val = '';
  for (let i = 0; i < 6; i++) { const el = document.getElementById(prefix + i); if (el) val += (el.value || ''); }
  return val.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function validateCodeRules() {
  const code = getCodeValue('c');
  const setRule = (id, pass, label) => {
    const el = document.getElementById(id);
    el.classList.toggle('pass', pass);
    el.textContent = (pass ? '✓ ' : '✗ ') + label;
  };
  setRule('rule-len', code.length === 6, '6 characters');
  setRule('rule-letter', /[A-Z]/.test(code), 'Has letters');
  setRule('rule-num', /[0-9]/.test(code), 'Has numbers');
}

async function completeRegistration() {
  const code = getCodeValue('c');
  const confirm = getCodeValue('cc');
  if (code.length < 6) { showToast('⚠️ Enter 6-character code'); return; }
  if (!/[A-Z]/.test(code)) { showToast('⚠️ Code must include letters'); return; }
  if (!/[0-9]/.test(code)) { showToast('⚠️ Code must include numbers'); return; }
  if (code !== confirm) { showToast('⚠️ Codes do not match'); return; }

  if (!localStorage.getItem("userSecretCode")) {
    showToast('⚠️ Please register your fingerprint first');
    return;
  }

  try {
    const data = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: state.registrationData.name,
        email: state.registrationData.email,
        phone: state.registrationData.phone,
        password: state.registrationData.password,
        fpHash: localStorage.getItem("userSecretCode"),
        secretCode: code,
      }),
    });
    saveSession(data.token, data.user);
    showToast('🎉 Account created successfully!');
    loginSuccessful(data.user);
  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

// ==================== LOGIN ====================
function switchLoginTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && tab === 'creds') || (i === 1 && tab === 'fp')));
  document.getElementById('login-creds').style.display = tab === 'creds' ? 'block' : 'none';
  document.getElementById('login-fp').style.display = tab === 'fp' ? 'block' : 'none';
}

async function loginUser() {
  const emailOrPhone = document.getElementById('login-identifier').value.trim();
  const password = document.getElementById('login-password').value.trim();
  if (!emailOrPhone || !password) {
    showToast('⚠️ Enter email/phone and password');
    return;
  }
  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ emailOrPhone, password }),
    });
    saveSession(data.token, data.user);
    loginSuccessful(data.user);
  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

async function loginWithFP() {
  const status = document.querySelector('#login-fp p');
  const area = document.querySelector('#login-fp .fp-register-area');

  if (status) status.textContent = '👆 Scanning finger...';
  if (area) area.style.borderColor = 'var(--accent)';
  showToast('🫆 Scanning fingerprint...');

  // Wait a short duration to simulate the fingerprint scan animation
  await new Promise(resolve => setTimeout(resolve, 600));

  const passkey = await showPasskeyModal({
    title: "Enter Passkey",
    message: "Enter your unique passkey to login:",
    placeholder: "Enter your passkey",
    validate: (val) => {
      if (!val) {
        return "Passkey cannot be empty.";
      }
      return null;
    }
  });

  if (!passkey) {
    if (status) status.textContent = 'Tap to login with fingerprint';
    if (area) area.style.borderColor = '';
    return;
  }


  try {
    const data = await apiRequest('/api/auth/login/fp', {
      method: 'POST',
      body: JSON.stringify({ fpHash: passkey.trim() }),
    });
    if (status) {
      status.textContent = '✓ Passkey verified!';
      status.style.color = 'var(--accent3)';
    }
    if (area) {
      area.style.borderColor = 'var(--accent3)';
    }
    saveSession(data.token, data.user);
    loginSuccessful(data.user);
  } catch (err) {
    if (status) {
      status.textContent = 'Tap to login with fingerprint';
      status.style.color = '';
    }
    if (area) {
      area.style.borderColor = 'var(--danger)';
    }
    showToast('⚠️ ' + err.message);
  }
}

function loginSuccessful(user) {
  const firstName = user.name.split(' ')[0];
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('dash-username').textContent = user.name;
  const userIdEl = document.getElementById('dash-fpuserid');
  if (userIdEl) userIdEl.textContent = user.fpUserId || 'N/A';
  document.getElementById('greet-name').textContent = firstName;
  document.querySelectorAll('.user-avatar').forEach(el => el.textContent = initials);
  showPage('page-dashboard');
  showDash('home');
  showToast('Welcome back, ' + firstName + '! 👋');
  // load fresh data from server (do NOT force bank linking — allow user to explore)
  loadDashboardData().catch(() => { });
}

function maskAccount(accountNumber = '') {
  const str = String(accountNumber);
  return '****' + str.slice(-4);
}

function renderBankAccounts(linkedBanks = []) {
  const container = document.querySelector('#dash-bank .bank-list');
  if (!container) return;

  const cards = linkedBanks.map((bank) => `
    <div class="bank-card">
      <div class="bank-logo">${(bank.bankName || 'BANK').slice(0, 4).toUpperCase()}</div>
      <div class="bank-info">
        <b>${bank.bankName} - Account</b>
        <span>Account: ${maskAccount(bank.accountNumber)}</span>
        <span>IFSC: ${bank.ifscCode || '-'}</span>
        <span>Balance: ₹${Number(bank.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="bank-badge${bank.isPrimary ? ' primary' : ''}">${bank.isPrimary ? 'Primary' : 'Linked'}</div>
    </div>
  `).join('');

  container.innerHTML = `${cards}<button class="add-bank-btn" onclick="showModal('modal-add-bank')">+ Link New Bank Account</button>`;
}

function renderTransactions(transactions = []) {
  const txList = document.getElementById('tx-list');
  const fullTxList = document.getElementById('full-tx-list');
  if (!txList || !fullTxList) return;

  if (!transactions.length) {
    txList.innerHTML = '<div class="tx-item"><div class="tx-info"><b>No transactions yet</b><span>Make your first payment</span></div></div>';
    fullTxList.innerHTML = txList.innerHTML;
    return;
  }

  const toRow = (tx) => {
    const isWalletTopup = tx.type === 'wallet-topup' || tx.type === 'wallet_topup';
    const isOfflinePay = tx.type === 'offline-payment' || tx.type === 'offline_payment';
    const isDebit = isWalletTopup ? false : Number(tx.amount) > 0;

    // Determine Type (wallet/bank)
    let payMethodType = 'Wallet';
    if (isWalletTopup) {
      payMethodType = 'Bank ➔ Wallet';
    } else if (tx.type === 'phone') {
      payMethodType = 'Bank ➔ Bank';
    } else if (isOfflinePay) {
      payMethodType = 'Wallet ➔ Wallet';
    } else if (tx.type === 'qr') {
      const from = tx.meta?.payFrom || 'Wallet';
      payMethodType = from === 'Wallet' ? 'Wallet' : 'Bank';
    }

    // Determine Sender/Receiver info and label
    let partyInfo = '';
    let label = '';
    let icon = '💳';

    if (isWalletTopup) {
      icon = '👛';
      label = 'Wallet Top-up';
      const rawAcct = tx.meta?.fromBankAccountNumber || '';
      const acct = rawAcct ? `****${String(rawAcct).slice(-4)}` : 'Bank';
      partyInfo = `From Bank Account: ${acct}`;
    } else if (tx.type === 'qr') {
      icon = '📷';
      label = tx.meta?.merchantName || 'QR Merchant';
      partyInfo = `Paid via ${payMethodType}`;
    } else if (tx.type === 'phone') {
      icon = '📞';
      if (isDebit) {
        label = `Sent to ${tx.meta?.receiver || 'User'}`;
        partyInfo = `To Phone: ${tx.meta?.toPhone || ''} | ${payMethodType}`;
      } else {
        label = `Received from ${tx.meta?.sender || 'User'}`;
        partyInfo = `From Phone: ${tx.meta?.fromPhone || ''} | ${payMethodType}`;
      }
    } else if (isOfflinePay) {
      icon = '📴';
      if (isDebit) {
        label = `Offline Pay to ${tx.meta?.receiver || 'User'}`;
        partyInfo = `To Phone: ${tx.meta?.toPhone || ''} | ${payMethodType}`;
      } else {
        label = `Offline Received from ${tx.meta?.sender || 'User'}`;
        partyInfo = `From Phone: ${tx.meta?.fromPhone || ''} | ${payMethodType}`;
      }
    } else {
      label = tx.type || 'Payment';
      partyInfo = payMethodType;
    }

    const dateStr = new Date(tx.createdAt || Date.now()).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    return `
        <div class="tx-item">
          <div class="tx-icon">${icon}</div>
          <div class="tx-info">
            <b>${label}</b>
            <span style="display: block; font-size: 0.75rem; color: var(--text2); margin-top: 2px;">${partyInfo}</span>
            <span style="display: block; font-size: 0.7rem; color: var(--text3); margin-top: 1px;">${dateStr}</span>
          </div>
          <div class="tx-amt ${isDebit ? 'debit' : 'credit'}">
            ${isDebit ? '-' : '+'}₹${Math.abs(Number(tx.amount)).toFixed(2)}
          </div>
        </div>
      `;
  };

  txList.innerHTML = transactions.slice(0, 5).map(toRow).join('');
  fullTxList.innerHTML = transactions.map(toRow).join('');
}

function populateBankDropdowns(linkedBanks = []) {
  const selectors = ['wallet-bank', 'qr-bank', 'p2p-bank'];
  selectors.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;

    sel.innerHTML = '';

    // Create disabled placeholder
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    if (id === 'wallet-bank') {
      placeholder.textContent = 'Choose bank account...';
    } else if (id === 'p2p-bank') {
      placeholder.textContent = 'Choose bank account...';
    } else {
      placeholder.textContent = 'Choose payment source...';
    }
    sel.appendChild(placeholder);

    if (!Array.isArray(linkedBanks) || linkedBanks.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.textContent = 'No linked bank';
      sel.appendChild(opt);
      return;
    }

    linkedBanks.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = String(b.accountNumber || '');
      const masked = maskAccount(b.accountNumber);
      opt.textContent = `${b.bankName || 'Bank'} – ${masked}`;
      sel.appendChild(opt);
    });

    // For qr-bank, we can also add 'Wallet' as an option!
    if (id === 'qr-bank') {
      const opt = document.createElement('option');
      opt.value = 'Wallet';
      opt.textContent = `Wallet Balance (₹${Number(state.walletBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })})`;
      sel.appendChild(opt);
    }
  });
}

async function loadDashboardData() {
  if (!state.authToken) return;
  try {
    // backend /api/dashboard returns user object
    const resp = await apiRequest('/api/dashboard');
    const profile = resp.user || resp;


    // save to state
    state.currentUser = profile;
    localStorage.setItem('fp_user', JSON.stringify(profile));

    const userIdEl = document.getElementById('dash-fpuserid');
    if (userIdEl) userIdEl.textContent = profile.fpUserId || 'N/A';

    if (typeof profile.walletBalance === 'number') {
      state.walletBalance = profile.walletBalance;
      // update wallet amount on dashboard
      const staticWc = document.getElementById('wc-static-amount');
      if (staticWc) staticWc.textContent = '₹ ' + Number(state.walletBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const walletCardWc = document.querySelector('.wallet-card .wc-amount');
      if (walletCardWc) walletCardWc.textContent = '₹ ' + Number(state.walletBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    }

    // Populate dashboard bank selector with linked banks and show default bank balance
    const bankSel = document.getElementById('dash-bank-selector');
    if (bankSel) {
      bankSel.innerHTML = '';
      const linkedBanks = profile.linkedBanks || [];
      if (linkedBanks.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No Bank Linked';
        bankSel.appendChild(opt);

        const tb = document.getElementById('tb-amount');
        if (tb) tb.textContent = '₹ 0.00';
        const sub = document.getElementById('dash-bank-sub');
        if (sub) sub.textContent = 'Link a bank account';
        const label = document.getElementById('dash-bank-label');
        if (label) label.textContent = 'Bank Balance';
      } else {
        // Find default bank (primary, or fallback to the first linked bank)
        let defaultBank = linkedBanks.find(b => b.isPrimary);
        if (!defaultBank) defaultBank = linkedBanks[0];

        linkedBanks.forEach(b => {
          const opt = document.createElement('option');
          opt.value = String(b.accountNumber);
          opt.textContent = `${b.bankName} (****${String(b.accountNumber).slice(-4)})`;
          if (defaultBank && String(b.accountNumber) === String(defaultBank.accountNumber)) {
            opt.selected = true;
          }
          bankSel.appendChild(opt);
        });

        // Set default bank balance and labels
        if (defaultBank) {
          const tb = document.getElementById('tb-amount');
          if (tb) tb.textContent = '₹ ' + Number(defaultBank.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
          const sub = document.getElementById('dash-bank-sub');
          if (sub) sub.textContent = defaultBank.isPrimary ? 'Primary Account' : 'Linked Account';
          const label = document.getElementById('dash-bank-label');
          if (label) label.textContent = `${defaultBank.bankName} Balance`;
        }
      }
    }
    renderBankAccounts(profile.linkedBanks || []);

    // Update all bank dropdowns (top-up, QR, P2P phone transfer)
    if (typeof populateBankDropdowns === 'function') {
      populateBankDropdowns(profile.linkedBanks || []);
    }

    // Render transactions dynamically from DB
    if (resp.recentTransactions) {
      renderTransactions(resp.recentTransactions);
    }

    // Hide or show balance overview cards and transaction history dynamically
    const hasLinkedBanks = Array.isArray(profile.linkedBanks) && profile.linkedBanks.length > 0;
    const balanceCards = document.querySelector('.balance-cards');
    const recentTx = document.querySelector('.recent-tx');

    if (balanceCards) {
      balanceCards.style.display = hasLinkedBanks ? 'grid' : 'none';
    }
    if (recentTx) {
      recentTx.style.display = hasLinkedBanks ? 'block' : 'none';
    }

  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

window.switchDashBankBalance = function (accountNumber) {
  if (!state.currentUser || !state.currentUser.linkedBanks) return;
  const bank = state.currentUser.linkedBanks.find(b => String(b.accountNumber) === String(accountNumber));
  if (bank) {
    const tb = document.getElementById('tb-amount');
    if (tb) tb.textContent = '₹ ' + Number(bank.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const sub = document.getElementById('dash-bank-sub');
    if (sub) sub.textContent = bank.isPrimary ? 'Primary Account' : 'Linked Account';
    const label = document.getElementById('dash-bank-label');
    if (label) label.textContent = `${bank.bankName} Balance`;
  }
};

function resetOfflinePaymentState() {
  const offlineRecipient = document.getElementById('offline-recipient');
  if (offlineRecipient) offlineRecipient.value = '';
  const offlineAmt = document.getElementById('offline-amt');
  if (offlineAmt) offlineAmt.value = '';
  clearCodeBoxes('oc', 6);

  const offlineCard = document.getElementById('offline-recipient-card');
  if (offlineCard) {
    offlineCard.style.display = 'none';
    const recName = document.getElementById('offline-rec-name');
    if (recName) recName.textContent = 'Account Holder';
    const recAvatar = document.getElementById('offline-rec-avatar');
    if (recAvatar) recAvatar.textContent = '??';
    const recStatus = document.getElementById('offline-rec-status');
    if (recStatus) recStatus.textContent = 'FingerPay User ✓';
  }

  const offlineErr = document.getElementById('offline-rec-error');
  if (offlineErr) {
    offlineErr.style.display = 'none';
    offlineErr.textContent = '';
  }
}

function resetGuestPaymentState() {
  const gsPasskey = document.getElementById('gs-passkey');
  if (gsPasskey) gsPasskey.value = '';
  const gsAmt = document.getElementById('gs-amount');
  if (gsAmt) gsAmt.value = '';
  clearCodeBoxes('gc', 6);

  state.guestPasskey = '';
  state.guestPayFrom = '';
  selectedAccName = '';

  const verifiedName = document.getElementById('gs-verified-name');
  if (verifiedName) verifiedName.textContent = 'Guest';
  const gsAvatar = document.querySelector('#gs-step2 .gs-avatar');
  if (gsAvatar) gsAvatar.textContent = '??';

  const accOptions = document.getElementById('account-options');
  if (accOptions) {
    accOptions.innerHTML = '<div class="tx-item"><div class="tx-info"><b>Loading...</b><span>Reading banks from DB</span></div></div>';
  }

  const gsSumAmt = document.getElementById('gs-sum-amt');
  if (gsSumAmt) gsSumAmt.textContent = '–';
  const gsSumAcc = document.getElementById('gs-sum-acc');
  if (gsSumAcc) gsSumAcc.textContent = '–';

  document.querySelectorAll('.acc-option').forEach(o => o.classList.remove('selected'));
  gotoGuestStep(1);
}

function guestBack() {
  const step1 = document.getElementById('gs-step1');
  const step2 = document.getElementById('gs-step2');
  const step3 = document.getElementById('gs-step3');

  if (step1 && step1.classList.contains('active')) {
    showPage('page-dashboard');
  } else if (step2 && step2.classList.contains('active')) {
    resetGuestPaymentState();
  } else if (step3 && step3.classList.contains('active')) {
    gotoGuestStep(2);
  } else {
    showPage('page-dashboard');
  }
}

// ==================== GUEST PAY ====================
let selectedAccName = '';

async function submitGuestPasskey() {
  const passkeyInput = document.getElementById('gs-passkey');
  if (!passkeyInput) return;
  const passkey = passkeyInput.value.trim();
  if (!passkey) {
    showToast('⚠️ Please enter a passkey');
    return;
  }

  showToast('🔑 Identifying guest...');

  try {
    const resp = await fetch(API_BASE + '/api/guest/linked-banks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fpHash: passkey }),
    }).then(r => r.json().then(d => ({ ok: r.ok, data: d })));

    if (!resp.ok) throw new Error(resp.data.error || 'Guest lookup failed');

    state.guestPasskey = passkey;

    // Populate guest name
    const verifiedNameEl = document.getElementById('gs-verified-name');
    if (verifiedNameEl) {
      verifiedNameEl.textContent = resp.data.userName || 'Guest User';
    }

    const initials = (resp.data.userName || 'Guest').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const avatarEl = document.querySelector('#gs-step2 .gs-avatar');
    if (avatarEl) avatarEl.textContent = initials;

    // Build guest account cards from DB
    const container = document.getElementById('account-options');
    if (!container) throw new Error('Missing guest account container');

    const linkedBanks = resp.data.linkedBanks || [];
    const walletBalance = resp.data.walletBalance || 0;

    const cards = [];
    linkedBanks.forEach(b => {
      const masked = maskAccount(b.accountNumber || '');
      cards.push(`
          <div class="acc-option" onclick="selectAccount(this, '${(b.bankName || 'BANK').replace(/'/g, "\\'")} – ${masked}', '${b.accountNumber}')">
            <div class="acc-bank">${(b.bankName || 'BANK').slice(0, 4).toUpperCase()}</div>
            <div class="acc-details"><b>${b.bankName}</b><span>${masked} • ₹${Number(b.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            <div class="acc-radio"></div>
          </div>
        `);
    });

    // Wallet option
    cards.push(`
        <div class="acc-option" onclick="selectAccount(this, 'FingerPay Wallet', 'Wallet')">
          <div class="acc-bank">👛</div>
          <div class="acc-details"><b>FingerPay Wallet</b><span>Balance: ₹${Number(walletBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
          <div class="acc-radio"></div>
        </div>
      `);

    container.innerHTML = cards.join('');

    // Reset selected states
    selectedAccName = '';
    state.guestPayFrom = '';

    showToast('✓ Guest account verified!');
    gotoGuestStep(2);
  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

function gotoGuestStep(n) {
  document.querySelectorAll('.guest-step').forEach(s => s.classList.remove('active'));
  document.getElementById('gs-step' + n).classList.add('active');
}

function selectAccount(el, name, val) {
  document.querySelectorAll('.acc-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedAccName = name;
  state.guestPayFrom = val;
}

function guestGoToCode() {
  const amt = document.getElementById('gs-amount').value;
  if (!amt || parseFloat(amt) <= 0) { showToast('⚠️ Enter amount'); return; }
  if (!selectedAccName || !state.guestPayFrom) { showToast('⚠️ Choose an account'); return; }
  document.getElementById('gs-sum-amt').textContent = parseFloat(amt).toFixed(2);
  document.getElementById('gs-sum-acc').textContent = selectedAccName;
  gotoGuestStep(3);
}

async function processGuestPayment() {
  const code = getCodeValue('gc');
  const amt = document.getElementById('gs-sum-amt').textContent;
  if (code.length < 6) { showToast('⚠️ Enter your 6-character secret code'); return; }
  if (!/[A-Z]/.test(code)) { showToast('⚠️ Code must have letters'); return; }
  if (!/[0-9]/.test(code)) { showToast('⚠️ Code must have numbers'); return; }

  showToast('🔐 Processing payment...');
  try {
    const resp = await apiRequest('/api/guest/pay', {
      method: 'POST',
      body: JSON.stringify({
        fpHash: state.guestPasskey,
        secretCode: code,
        amount: parseFloat(amt),
        payFrom: state.guestPayFrom
      })
    });

    document.getElementById('success-msg').textContent = 'Guest payment of ₹' + parseFloat(amt).toFixed(2) + ' was successful!';
    document.getElementById('success-details').innerHTML = `
        <b>Transaction ID:</b> ${resp.txnId}<br>
        <b>Amount:</b> ₹${parseFloat(amt).toFixed(2)}<br>
        <b>From Guest:</b> ${document.getElementById('gs-verified-name').textContent}<br>
        <b>Source:</b> ${selectedAccName}<br>
        <b>Status:</b> <span style="color:var(--accent3)">✓ Confirmed</span>
      `;

    showModal('modal-success');
    clearCodeBoxes('gc', 6);

    setTimeout(() => {
      closeModal('modal-success');
    }, 4000);

    // Refresh merchant dashboard data
    await loadDashboardData();
  } catch (err) {
    clearCodeBoxes('gc', 6);
    const firstBox = document.getElementById('gc0');
    if (firstBox) firstBox.focus();
    showToast('⚠️ ' + err.message);
  }
}


// ==================== QR + PHONE + PAYMENTS ====================
function simulateQRScan() {
  const box = document.getElementById('qr-scan-box');
  box.style.borderColor = 'var(--accent)';
  box.innerHTML = '<div class="qr-frame"><div class="qr-corner tl"></div><div class="qr-corner tr"></div><div class="qr-corner bl"></div><div class="qr-corner br"></div></div><p style="color:var(--accent)">Scanning...</p>';
  setTimeout(() => {
    box.style.display = 'none';
    document.getElementById('qr-pay-form').style.display = 'block';
    const merchants = ['Cafe Coffee Day', 'Swiggy', 'Zomato', 'BigBasket', 'D-Mart', 'McDonald\'s'];
    const m = merchants[Math.floor(Math.random() * merchants.length)];
    document.getElementById('qr-merchant').textContent = m;
    document.getElementById('qr-mid').textContent = 'MID: ' + Math.floor(Math.random() * 9000000 + 1000000);
    showToast('✓ QR scanned: ' + m);
  }, 1500);
}

let phoneTimer;
function lookupPhone() {
  clearTimeout(phoneTimer);
  const val = document.getElementById('p2p-phone').value.trim();
  const card = document.getElementById('recipient-card');
  if (!card) return;

  if (val.replace(/\D/g, '').length < 10) {
    card.style.display = 'none';
    return;
  }

  phoneTimer = setTimeout(async () => {
    try {
      const resp = await apiRequest(`/api/users/lookup?phone=${encodeURIComponent(val)}`);
      card.style.display = 'flex';
      const name = resp.name || 'FingerPay User';
      const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      card.querySelector('b').textContent = name;
      card.querySelector('.rec-avatar').textContent = initials;
    } catch (err) {
      card.style.display = 'none';
    }
  }, 600);
}

let offlinePhoneTimer;
function lookupOfflinePhone() {
  clearTimeout(offlinePhoneTimer);
  const val = document.getElementById('offline-recipient').value.trim();
  const card = document.getElementById('offline-recipient-card');
  const errDiv = document.getElementById('offline-rec-error');
  if (!card || !errDiv) return;

  if (val.replace(/\D/g, '').length < 10) {
    card.style.display = 'none';
    errDiv.style.display = 'none';
    return;
  }

  offlinePhoneTimer = setTimeout(async () => {
    try {
      const resp = await apiRequest(`/api/users/lookup?phone=${encodeURIComponent(val)}`);
      card.style.display = 'flex';
      errDiv.style.display = 'none';
      const name = resp.name || 'FingerPay User';
      const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      document.getElementById('offline-rec-name').textContent = name;
      document.getElementById('offline-rec-avatar').textContent = initials;
      document.getElementById('offline-rec-status').textContent = 'FingerPay User ✓';
    } catch (err) {
      card.style.display = 'none';
      errDiv.textContent = '⚠️ ' + err.message;
      errDiv.style.display = 'block';
    }
  }, 600);
}

function movePay(prefix, i, total) {
  const box = document.getElementById(prefix + i);
  box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (box.value && i < total - 1) { const next = document.getElementById(prefix + (i + 1)); if (next) next.focus(); }
}

function getPaymentInput(type) {
  let amount, codePrefix;
  let recipientPhone = null;
  let note = null;

  if (type === 'QR') {
    amount = document.getElementById('qr-amount').value;
    codePrefix = 'qc';
    note = null;
  } else if (type === 'Phone') {
    amount = document.getElementById('p2p-amount').value;
    codePrefix = 'pc';
    recipientPhone = document.getElementById('p2p-phone').value.trim();
    note = document.getElementById('p2p-note')?.value?.trim() || null;
  } else if (type === 'Offline') {
    amount = document.getElementById('offline-amt').value;
    codePrefix = 'oc';
    recipientPhone = document.getElementById('offline-recipient').value.trim();
    note = null;
  }

  return { amount, codePrefix, recipientPhone, note };
}

async function processPayment(type) {
  // NEW: For Phone transfers, use internal wallet transfer endpoint.
  if (type === 'Phone') {
    const toPhone = document.getElementById('p2p-phone').value.trim();
    const amount = document.getElementById('p2p-amount').value;
    const note = document.getElementById('p2p-note')?.value?.trim() || null;
    const code = getCodeValue('pc');

    if (!toPhone) { showToast('⚠️ Enter recipient phone number'); return; }
    if (!amount || parseFloat(amount) <= 0) { showToast('⚠️ Enter a valid amount'); return; }
    if (code.length < 6) { showToast('⚠️ Enter your 6-character secret code'); return; }
    if (!/[A-Z]/.test(code)) { showToast('⚠️ Invalid code'); return; }
    if (!/[0-9]/.test(code)) { showToast('⚠️ Invalid code'); return; }
    if (!state.authToken) { showToast('⚠️ Please login first'); return; }

    const fromBankAccountNumber = document.getElementById('p2p-bank').value;
    if (!fromBankAccountNumber) {
      showToast('⚠️ Please select a bank account to pay from');
      return;
    }

    try {
      const resp = await apiRequest('/api/bank/transfer', {
        method: 'POST',
        body: JSON.stringify({ toPhone, amount: parseFloat(amount), fromBankAccountNumber, note, secretCode: code }),
      });

      document.getElementById('success-msg').textContent = `Transfer successful!`;
      document.getElementById('success-details').innerHTML = `
        <b>To:</b> ${toPhone}<br>
        <b>Out Txn ID:</b> ${resp.txnId || 'N/A'}<br>
        <b>Amount:</b> ₹${parseFloat(amount).toFixed(2)}<br>
        <b>Time:</b> ${new Date().toLocaleString()}
      `;
      showModal('modal-success');
      clearCodeBoxes('pc', 6);
      await loadDashboardData();
      return;
    } catch (err) {
      clearCodeBoxes('pc', 6);
      const firstBox = document.getElementById('pc0');
      if (firstBox) firstBox.focus();
      showToast('⚠️ ' + err.message);
      return;
    }
  }

  if (type === 'Offline') {
    const toPhone = document.getElementById('offline-recipient').value.trim();
    const amount = document.getElementById('offline-amt').value;
    const code = getCodeValue('oc');

    if (!toPhone) { showToast('⚠️ Enter recipient phone number'); return; }

    const card = document.getElementById('offline-recipient-card');
    if (!card || card.style.display === 'none') {
      showToast('⚠️ Please enter a valid registered user phone number');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) { showToast('⚠️ Enter a valid amount'); return; }
    if (code.length < 6) { showToast('⚠️ Enter your 6-character secret code'); return; }
    if (!/[A-Z]/.test(code)) { showToast('⚠️ Invalid code'); return; }
    if (!/[0-9]/.test(code)) { showToast('⚠️ Invalid code'); return; }
    if (!state.authToken) { showToast('⚠️ Please login first'); return; }

    try {
      const resp = await apiRequest('/api/wallet/offline-pay', {
        method: 'POST',
        body: JSON.stringify({ recipientPhone: toPhone, amount: parseFloat(amount), secretCode: code }),
      });

      document.getElementById('success-msg').textContent = `Offline payment successful!`;
      document.getElementById('success-details').innerHTML = `
          <b>Recipient Phone:</b> ${toPhone}<br>
          <b>Transaction ID:</b> ${resp.txnId}<br>
          <b>Amount:</b> ₹${parseFloat(amount).toFixed(2)}<br>
          <b>Time:</b> ${new Date().toLocaleString()}
        `;
      showModal('modal-success');

      // Clear fields and reset state
      resetOfflinePaymentState();

      await loadDashboardData();
      return;
    } catch (err) {
      clearCodeBoxes('oc', 6);
      const firstBox = document.getElementById('oc0');
      if (firstBox) firstBox.focus();
      showToast('⚠️ ' + err.message);
      return;
    }
  }

  if (type === 'QR') {
    const amount = document.getElementById('qr-amount').value;
    const code = getCodeValue('qc');
    const bankEl = document.getElementById('qr-bank');
    const payFrom = bankEl ? bankEl.value : null;
    const merchantName = document.getElementById('qr-merchant')?.textContent || 'QR Payment';

    if (!amount || parseFloat(amount) <= 0) { showToast('⚠️ Enter a valid amount'); return; }
    if (!payFrom) { showToast('⚠️ Please select a payment source'); return; }
    if (code.length < 6) { showToast('⚠️ Enter your 6-character secret code'); return; }
    if (!/[A-Z]/.test(code)) { showToast('⚠️ Invalid code'); return; }
    if (!/[0-9]/.test(code)) { showToast('⚠️ Invalid code'); return; }
    if (!state.authToken) { showToast('⚠️ Please login first'); return; }

    try {
      const resp = await apiRequest('/api/pay', {
        method: 'POST',
        body: JSON.stringify({ amount: parseFloat(amount), payFrom, merchantName, secretCode: code }),
      });

      document.getElementById('success-msg').textContent = `Payment of ₹${parseFloat(amount).toFixed(2)} successful!`;
      document.getElementById('success-details').innerHTML = `
          <b>Merchant:</b> ${merchantName}<br>
          <b>Transaction ID:</b> ${resp.txnId}<br>
          <b>Amount:</b> ₹${parseFloat(amount).toFixed(2)}<br>
          <b>Time:</b> ${new Date().toLocaleString()}
        `;
      showModal('modal-success');

      // Reset QR fields
      document.getElementById('qr-amount').value = '';
      if (bankEl) bankEl.selectedIndex = 0;
      clearCodeBoxes('qc', 6);
      document.getElementById('qr-pay-form').style.display = 'none';
      document.getElementById('qr-scan-box').style.display = 'block';
      document.getElementById('qr-scan-box').innerHTML = `
          <div class="qr-frame">
            <div class="qr-corner tl"></div><div class="qr-corner tr"></div>
            <div class="qr-corner bl"></div><div class="qr-corner br"></div>
            <div class="qr-line"></div>
          </div>
          <p>Tap to simulate QR scan</p>
        `;
      document.getElementById('qr-scan-box').style.borderColor = '';

      await loadDashboardData();
      return;
    } catch (err) {
      clearCodeBoxes('qc', 6);
      const firstBox = document.getElementById('qc0');
      if (firstBox) firstBox.focus();
      showToast('⚠️ ' + err.message);
      return;
    }
  }
}


function clearCodeBoxes(prefix, n) {
  for (let i = 0; i < n; i++) { const el = document.getElementById(prefix + i); if (el) el.value = ''; }
}

function setWalletAmt(val) { document.getElementById('wallet-add-amt').value = val; }

async function addToWallet() {

  const amt = parseFloat(document.getElementById('wallet-add-amt').value);
  if (!amt || amt <= 0) { showToast('⚠️ Enter a valid amount'); return; }
  if (!state.authToken) { showToast('⚠️ Please login first'); return; }

  try {
    // If only 1 bank is linked, backend will auto-select.
    // If multiple banks are linked, backend expects fromBankAccountNumber.
    const walletBankSel = document.getElementById('wallet-bank');
    const fromBankAccountNumber = walletBankSel?.value || null;

    if (!fromBankAccountNumber) {
      showToast('⚠️ Please select a bank account');
      return;
    }

    await apiRequest('/api/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({ amount: amt, fromBankAccountNumber }),
    });

    showToast('✓ Wallet topped up successfully!');
    document.getElementById('wallet-add-amt').value = '';
    await loadDashboardData();

  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

async function linkBankAccount() {
  if (!state.authToken) { showToast('⚠️ Please login first'); return; }

  const bankName = document.getElementById('bank-name').value.trim();
  let accountNumber = document.getElementById('bank-account-number').value.trim();
  let ifscCode = document.getElementById('bank-ifsc').value.trim();
  let accountHolderName = document.getElementById('bank-holder-name').value.trim();
  const isPrimary = true; // when user links via modal, make it primary by default

  if (!bankName) {
    showToast('⚠️ Please select a bank');
    return;
  }

  // Auto-generate dummy data if not filled by user
  if (!accountNumber) {
    accountNumber = '999' + Math.floor(100000000 + Math.random() * 900000000); // 12-digit dummy account number
  }
  if (!ifscCode) {
    const code = bankName.slice(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X');
    const padCode = code.padEnd(4, 'X');
    ifscCode = padCode + '0000' + Math.floor(100 + Math.random() * 900); // e.g. HDFC0000123
  }
  if (!accountHolderName) {
    accountHolderName = (state.currentUser && state.currentUser.name) ? state.currentUser.name : 'FingerPay Demo';
  }

  try {
    const resp = await apiRequest('/api/banks/link', {
      method: 'POST',
      body: JSON.stringify({ bankName, accountNumber, ifscCode, accountHolderName, isPrimary }),
    });
    closeModal('modal-add-bank');
    showToast('Bank account linked successfully!');
    document.getElementById('bank-account-number').value = '';
    document.getElementById('bank-ifsc').value = '';
    document.getElementById('bank-holder-name').value = '';
    // refresh dashboard / state
    await loadDashboardData();
  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => { document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); });
});

// ==================== INIT: CHECK WEBAUTHN STATUS ====================
// Always start from landing/login page (no auto-login) to avoid landing directly on dashboard.
(async function init() {
  const supported = isWebAuthnSupported();
  const platformAvail = supported ? await isPlatformAuthAvailable() : false;
  if (!supported) console.warn('WebAuthn not supported on this browser');
  else if (!platformAvail) console.warn('No fingerprint sensor found on device');
  else console.log('✅ WebAuthn + Fingerprint sensor ready!');
})();
