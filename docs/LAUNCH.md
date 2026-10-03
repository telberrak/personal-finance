# Launch readiness

What is ready in the code, and what only you can do before a public launch.

## 1. Name and brand: decide first

**"Ledger" is a risky name.** Ledger SAS (the hardware crypto-wallet company) holds trademarks for "Ledger" in software and financial services in the UK and EU, and an app called Ledger in finance invites confusion and a legal challenge. Choose a final name before spending on a domain, store listings or marketing.

- Check candidates on the UK IPO and EUIPO registers (classes 9 and 36), app stores and domains.
- Ideas in the spirit of the app (check availability yourself): _Payday_, _Saferoom_, _Tally_, _Pennywise_ (taken in several places), _Kept_, _Daybook_.
- Renaming is cheap in the code: change `APP_NAME` in [`src/brand.ts`](../src/brand.ts), `app.name` in the three locale files, the PWA `manifest` in [`vite.config.ts`](../vite.config.ts), `appName`/`appId` in [`capacitor.config.ts`](../capacitor.config.ts), the icon in `public/`, and the [`site/`](../site) pages.

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
