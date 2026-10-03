# Open Banking

Ledger can read balances and transactions from banks through an account information service provider (AISP). It never initiates payments.

## How it works

1. You turn on sync (the connection is made by the server, which holds the provider's keys).
2. **Settings → Bank connections → Connect a bank:** choose a country and bank. The server creates a consent request at the provider and sends you to the bank to approve it.
3. The bank sends you back to Ledger, which lists the accounts you shared. Choose the Ledger account each one feeds.
4. Transactions come in at start-up and every 6 hours (or on **Get new transactions**). They go through the same pipeline as CSV imports: payee clean-up and renames, rules, category history, bill matching. The bank's transaction ids are kept, so nothing is imported twice.
5. When the bank's balance differs from Ledger's, a **Match the bank** button adjusts the account's opening balance.
6. Consent lasts 90 days. A notification reminds you a week before; **Reconnect** renews it.

## Providers

| Provider                                   | Status                          | Notes                                                                                                                                             |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox bank                               | Built in                        | Development and tests (`npm run server:dev`, or `BANKS_SANDBOX=1`). Realistic, deterministic transactions                                         |
| GoCardless Bank Account Data (ex-Nordigen) | Implemented (`server/banks.ts`) | Set `GOCARDLESS_SECRET_ID` and `GOCARDLESS_SECRET_KEY`. Covers UK and EU banks (2,300+). Free tier for personal/low volume; check current pricing |
| TrueLayer, Yapily                          | Not implemented                 | Same `BankProvider` interface; add an adapter if their coverage or terms suit better                                                              |

Morocco and most Middle-East markets are not covered by PSD2-style Open Banking; there, CSV import remains the way in.

## Regulation (UK and EU)

Reading account data for someone is a regulated activity (account information services). The simplest compliant route is to **use a provider that is itself authorised** and to operate under its licence as an agent or under its terms for apps that display data to the account holder only:

- GoCardless Bank Account Data is authorised by the FCA (UK) and the Bank of Spain (EU) as an AISP; its terms allow apps to show users their own data.
- If Ledger ever processes the data for other purposes (credit scoring, sharing with third parties) or offers it commercially at scale, get legal advice: you may need your own FCA registration as an AISP or agent.
- The privacy notice (P13) must name the provider and explain the data flow below.

**Before going live:** sign the provider's terms with your own (business) account, complete its onboarding, and have the privacy notice reviewed. None of this can be done from the code.

## Data flow and privacy

- The server stores only the connection: bank name, status, expiry and the provider's reference. It **does not store transactions or balances**.
- Transactions pass through the server in memory on their way to your device, so for this feature the server and the provider see your transactions. This is the one exception to end-to-end encryption, and it only applies to connected banks.
- On the device, imported transactions are encrypted at rest and synced end-to-end encrypted like everything else.
- **Disconnect** deletes the consent at the provider and the connection on the server. Deleting your sync account removes all connections.

## Configuration

| Variable                                        | Meaning                                      |
| ----------------------------------------------- | -------------------------------------------- |
| `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY` | From the GoCardless Bank Account Data portal |
| `BANKS_SANDBOX=1`                               | Offer the sandbox bank outside development   |
| `APP_ORIGINS`                                   | Banks may only send people back to these     |
