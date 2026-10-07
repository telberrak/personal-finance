# Native apps (iOS and Android)

The App Store and Google Play apps are the same web app inside a native shell ([Capacitor](https://capacitorjs.com)). One codebase; the native projects live in [`android/`](../android) and [`ios/`](../ios).

**Releasing to the stores, step by step: [MOBILE_RELEASE.md](MOBILE_RELEASE.md).**

## What the native apps add

| Feature                                 | How                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Face ID / Touch ID / fingerprint unlock | The data key is stored in the iOS Keychain or Android Keystore-backed storage, **this device only** (`whenPasscodeSetThisDeviceOnly`, never in iCloud Keychain), and read after biometric authentication. Settings → Security → _Unlock with Face ID or fingerprint_. Passkeys are web-only. |
| Reminders                               | Scheduled as **local notifications** on the device (up to 60 ahead), with their full text. No push server or Firebase account is needed.                                                                                                                                                     |
| Notification taps                       | Open the right screen.                                                                                                                                                                                                                                                                       |
| Android back button                     | Goes back, or closes the app on the first screen.                                                                                                                                                                                                                                            |
| Receipts shared from other apps         | The installed web app (PWA) accepts shared photos and PDFs (Web Share Target): they arrive on a new expense. In the native apps this needs a share extension, see below.                                                                                                                     |

Everything else (sync, bank connections, OCR) works unchanged: the app is served from `https://localhost` inside the shell, a secure context.

## Build

Requirements: Node 24; Android Studio for Android; a Mac with Xcode 16+ for iOS.

```bash
npm run native:sync      # build the web app, set the native version from package.json, copy it into both projects
npm run native:android   # open Android Studio, then Run or Build > Generate Signed Bundle
npm run native:ios       # open Xcode, then Product > Archive
```

To use sync and bank connections from the native apps, build them with the API's full origin, since they are not served by your web host:

```bash
VITE_API_ORIGIN=https://mizan.tarikelberrak.com npm run native:sync
```

The server already allows `capacitor://localhost` and `https://localhost` (its `APP_ORIGINS`, which also controls CORS).

**Sign-in in the native apps:** use the emailed code. Sign-in **passkeys** are tied to the web domain, and the apps run from `capacitor://localhost`, so they only work in the browser version (making them work natively needs Associated Domains on iOS and Digital Asset Links on Android). Unlocking the app with Face ID or a fingerprint works natively.

### Icons and splash screens

The projects have Capacitor's placeholder icons. Generate them from [`public/icon.svg`](../public/icon.svg):

```bash
npx @capacitor/assets generate --iconBackgroundColor '#14161A' --splashBackgroundColor '#F4F5F2'
```

## Before the first store upload

1. **App id:** `app.mizan.money` in [`capacitor.config.ts`](../capacitor.config.ts), `android/app/build.gradle` (`applicationId`) and the Xcode bundle identifier. It cannot change after the first upload; register the same id in App Store Connect and Google Play Console.
2. **Accounts:** an Apple Developer Program membership (£79/year) and a Google Play developer account (one-off $25). These are yours to create; nothing in the code can do it.
3. **Signing:** Android: create an upload key and enable Play App Signing. iOS: let Xcode manage signing with your team.
4. **Version:** keep `versionName` / `CFBundleShortVersionString` in step with `package.json`, and increase `versionCode` / build number on every upload.

## Store listings and privacy labels

Data the app handles, for Apple's App Privacy and Google's Data safety forms:

| Data                                    | Collected by the developer?                                                                     | Notes                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Financial info (transactions, balances) | **No** without sync. With sync: stored on our server **end-to-end encrypted**, unreadable by us | Bank connections pass transactions through the server in memory (not stored) |
| Email address                           | Only with sync (sign-in)                                                                        | Account management; not used for marketing                                   |
| Photos (receipts)                       | No                                                                                              | Stay on the device, or synced end-to-end encrypted                           |
| Device identifiers, location, contacts  | No                                                                                              |                                                                              |
| Tracking / advertising                  | No                                                                                              | No third-party SDKs                                                          |
| Data encrypted in transit               | Yes                                                                                             | HTTPS everywhere                                                             |
| Users can request deletion              | Yes                                                                                             | Settings → Sync and devices → Delete sync account                            |

Review notes for Apple and Google: the app needs no login to use (sync is optional); give reviewers demo steps: _Welcome → Explore with demo data_. Mention that bank connections use an authorised provider (see [OPEN_BANKING.md](OPEN_BANKING.md)) and that no payments are made.

## Not done yet (needs native code)

- **Home-screen widgets** ("safe to spend"): a WidgetKit extension (Swift) and an Android App Widget (Kotlin). The app would write a small, non-sensitive summary (amount rounded, or hidden when the lock is on) to an App Group / SharedPreferences for the widget to read.
- **Share extension** for the native apps: an iOS Share Extension and an Android `ACTION_SEND` intent filter that hand the file to the web app (for example with a share-intent plugin). The PWA already supports sharing.
- **Native push** for reminders computed on the server: not needed while reminders are scheduled locally.
