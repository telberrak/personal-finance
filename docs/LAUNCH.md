# Launch readiness

What is ready in the code, and what only you can do before a public launch.

## 1. Name and brand: decide first

**The app is called Mizan** (ميزان, "balance" or "scales"), chosen in October 2026 to replace the working name "Ledger", which clashed with Ledger SAS's trademarks. Mizan reads the same in English, French and Arabic.

- Before spending on a domain, store listings or marketing, check "Mizan" on the UK IPO and EUIPO registers (classes 9 and 36), the App Store, Google Play and domains. Watch for confusion with Meezan Bank (Pakistan).
- Internal identifiers keep the old name on purpose: the browser database (`ledger`), encryption labels (`ledger-vault`, `ledger-dek`, ...), backup format ids and `LEDGER_*` environment variables. Changing them would make existing data, backups and vaults unreadable.
- Renaming again is cheap in the code: change `APP_NAME` in [`src/brand.ts`](../src/brand.ts), the locale files, the PWA `manifest` in [`vite.config.ts`](../vite.config.ts), `appName`/`appId` in [`capacitor.config.ts`](../capacitor.config.ts) (and the Android/iOS projects), the icon in `public/`, and the [`site/`](../site) pages. The store app id (`app.mizan.money`) cannot change after the first upload.

## 2. Operator details and support

Set at build time:

| Variable             | Used for                                                   |
| -------------------- | ---------------------------------------------------------- |
| `VITE_OPERATOR_NAME` | The legal entity or person in the privacy policy and terms |
| `VITE_SUPPORT_EMAIL` | Contact links, help, privacy policy                        |

Create the support mailbox and reply-to address before launch. Feedback sent from Settings → About is stored in the server's `feedback` table:

```sql
SELECT created_at, language, version, email, message FROM feedback ORDER BY created_at DESC;
```

## 3. Legal (needs a professional review)

Drafts in English, French and Arabic: [`src/content/privacy.*.md`](../src/content), [`terms.*.md`](../src/content). They describe the real data flows (see [SECURITY.md](SECURITY.md)), but **have them reviewed by a lawyer** before launch, in particular:

- UK GDPR and EU GDPR: controller identity, ICO registration (and the data protection fee), records of processing, data processing agreements with your host, Resend and GoCardless;
- Open Banking: the provider's terms and whether you operate as its agent (see [OPEN_BANKING.md](OPEN_BANKING.md));
- consumer law for the terms; a cookie notice is not needed while the app sets no cookies and analytics stay opt-in and cookie-free.

## 4. Analytics (opt-in, cookie-free)

Settings → About → _Share anonymous usage counts_ (off by default). The server keeps daily totals per event name only:

```sql
SELECT day, name, count FROM event_counts ORDER BY day DESC, name;
```

Event names are fixed in [`server/feedback.ts`](../server/feedback.ts) and [`src/lib/usage.ts`](../src/lib/usage.ts).

## 5. Status page and monitoring

- In-app: Settings → About shows whether the sync service answers.
- Public: point a status service (Better Stack, UptimeRobot, Instatus) at `https://<your-domain>/api/health` and link it from the website footer.
- See [SERVER.md](SERVER.md) for logs, backups and releases.

## 6. Beta programme

1. Deploy staging (`fly.staging.toml`) and a web build that points at it.
2. Invite 20–50 testers: the web app needs only the link; native builds go through TestFlight (iOS) and Google Play internal testing (see [NATIVE.md](NATIVE.md)).
3. Ask testers to send feedback from Settings → About; watch `feedback` and error logs.
4. Run at least one full cycle of: payday, bills, a CSV import, sync on two devices, a backup restore.

## 7. Website

[`site/`](../site) is a static, script-free marketing page in English, French and Arabic. Before publishing, replace `https://app.example.com` and `support@example.com`, then deploy the folder to any static host (it has no build step).

## 8. Public changelog and versions

[CHANGELOG.md](../CHANGELOG.md) is shown in the app (Settings → About → What's new). Bump `version` in `package.json` for each release; the app and `/api/health` report it. Tag releases `vX.Y.Z`.

## Go-live checklist

- [ ] Final name cleared (trademark search) and domain bought
- [ ] Operator name and support email set; mailbox working
- [ ] Privacy policy and terms reviewed by a lawyer, in all three languages
- [ ] French and Arabic UI reviewed by native speakers (see [TRANSLATING.md](TRANSLATING.md))
- [ ] Production API deployed with Postgres, Resend and (if offered) GoCardless; secrets set
- [ ] `/api` proxied from the web host; CSP and HSTS verified on the live domain
- [ ] Status monitor on `/api/health`
- [ ] Beta feedback addressed; backup and restore tested on real devices
- [ ] App Store and Google Play listings, privacy labels and review notes (if shipping native apps)
- [ ] Website published with correct links
