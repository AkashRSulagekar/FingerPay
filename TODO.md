# TODO

## Demo bank + linking + wallet topup (ledger)
- [x] Track remaining steps in TODO
- [x] Add backend endpoint `GET /api/banks/demo`
- [x] Add backend endpoint `POST /api/banks/link-demo`


- [ ] Add backend logic in `POST /api/wallet/topup` to debit selected bank:
      - if user has exactly 1 linked bank (any? or primary) => debit it
      - if user has multiple linked banks => require `fromBankAccountNumber` and debit that bank
- [x] If top-up was debited and payment fails/never succeeds, provide a safe retry/rollback strategy (for demo: only credit-once)

- [ ] Update frontend:
      - add dropdown to choose which bank to top up from when multiple linked banks exist
      - call `GET /api/banks/demo` and show demo banks on dashboard
      - add button to link demo bank preset
- [ ] Update UI balances after linking/topup
- [ ] Manual test checklist:
      1. register 2 users
      2. link demo banks
      3. do topup -> verify bank balance decreased and wallet increased
      4. do phone transfer -> verify bank balance moved

