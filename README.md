## FingerPay (Final Year Project)

Fingerprint-based payment web app utilizing an internal database-backed ledger simulation for secure, offline-ready payments.

---

## Folder Structure

- `server.js` - Express + MongoDB backend API (simulated bank and wallet transactions)
- `public/` - Frontend files served statically
  - `index.html`
  - `style.css`
  - `app.js`
- `config/` - App settings and configurations
- `docs/` - Project documentation and API notes
- `.env` - Environment variables (private: MONGO_URI, JWT_SECRET, PORT)
- `package.json` - Node.js scripts and dependencies

---

## Run Project

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start backend server:
   ```bash
   npm start
   ```
3. Development mode:
   ```bash
   npm run dev
   ```

---

## Simulated Ledger Architecture (Demo Mode)

This project does not require external payment gateway subscriptions (such as Cashfree or Razorpay). Instead, it runs on an internal simulated ledger:

- **Demo Bank Presets**: Users can link pre-funded demo bank accounts from the linking modal to fund their actions.
- **Wallet Top-ups**: Instantly debit funds from any of the user's linked bank accounts and credit their internal FingerPay Wallet.
- **Bank-to-Bank Transfers**: Move money directly between registered users' bank accounts using their phone number.
- **Offline Wallet Payments**: Transact wallet-to-wallet securely using client-verified credentials without requiring internet connectivity.
- **QR Payment Flow**: Pay simulated merchants using either the FingerPay Wallet or any linked bank account.
- **Dual-Entry Transaction Logs**: Every transfer logs positive/negative entry records for both senders and receivers, rendering detailed interactive transaction history cards on their dashboards.
