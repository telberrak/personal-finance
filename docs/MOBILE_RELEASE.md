# Releasing on iOS and Android

Step by step: from nothing to Mizan in the App Store and on Google Play, then every update after that. What the native apps add, and the privacy answers for the stores, are in [NATIVE.md](NATIVE.md).

**Do you need the stores?** Mizan already installs from the website as an app (iPhone: Safari → Share → **Add to Home Screen**; Android: Chrome → **Install app**), works offline and sends notifications. The store apps add Face ID / fingerprint unlock, reminders as native notifications, and being found in the stores.

## 1. What you need

|                   | Google Play (Android)                                                                                                       | App Store (iOS and iPad)                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Developer account | [Google Play Console](https://play.google.com/console), one-off **$25**                                                     | [Apple Developer Program](https://developer.apple.com/programs/), about **£79 a year**   |
| Computer          | Windows, macOS or Linux, with **Android Studio**                                                                            | **A Mac with Xcode 16 or later** (or a cloud Mac, see [section 6](#6-ios-without-a-mac)) |
| Test device       | Any Android 7.0+ phone, or the emulator                                                                                     | An iPhone with iOS 15+, or the simulator                                                 |
| First review      | Hours to a few days (new personal accounts: a closed test first, see [4.5](#45-new-personal-accounts-closed-testing-first)) | Usually 1–2 days                                                                         |

Fixed values (already set in the projects):

|                    | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| App id / bundle id | `app.mizan.money` (cannot change after the first upload)      |
| Store name         | **Mizan: Safe to Spend** (the home-screen name stays "Mizan") |
| Category           | Finance                                                       |
| Privacy policy     | https://mizan.tarikelberrak.com/privacy                       |
| Support            | https://mizan.tarikelberrak.com/help                          |
| Android            | min. Android 7.0 (API 24), target API 36                      |
| iOS                | iOS 15+, iPhone and iPad                                      |

## 2. Once, before the first release

### 2.1 Icons and splash screens

The native projects still have Capacitor's placeholder icons. Generate them from the app icon:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#14161A' --splashBackgroundColor '#F4F5F2'
```

The Android status-bar icon for reminders is already in the project (`res/drawable/ic_stat_mizan.xml`).

### 2.2 Screenshots

Take them from the app with demo data (Welcome → **Explore with demo data**), in each store language you list (English, French, Arabic). Good screens: Home (safe to spend), Bills, Budgets, Reports, Net worth.

| Store       | Sizes required                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| App Store   | iPhone 6.9" (1320 × 2868) and **iPad 13" (2064 × 2752)**, because the app supports iPad. 3 to 10 each       |
| Google Play | Phone screenshots (at least 2, 1080 × 1920 or larger), a **feature graphic** 1024 × 500, the icon 512 × 512 |

The simulator (Xcode) and the emulator (Android Studio) take screenshots at exactly these sizes.

### 2.3 Store texts

Short description (Google Play, 80 characters) / subtitle (App Store, 30 characters):

- **EN:** Know what is safe to spend until payday / Safe to spend, until payday
- **FR:** Sachez ce que vous pouvez dépenser jusqu’à la paie / Votre reste à vivre
- **AR:** اعرف ما يمكنك إنفاقه حتى يوم الراتب / المتاح للإنفاق حتى الراتب

Full description (adapt freely):

> Mizan tells you what is safe to spend until payday: your balance, minus the bills still to come, minus what you save. Track spending, direct debits, subscriptions and budgets; see a calendar of bills and paydays, reports, goals and your net worth. Import bank statements or connect your bank. Share chosen accounts with your partner and split costs with friends. Private by design: your data stays on your phone, sync is optional and end-to-end encrypted, and there are no adverts or trackers. In English, French and Arabic, in any currency.

Keywords (App Store, 100 characters): `budget,money,bills,payday,spending,savings,expense tracker,finance,subscriptions,net worth`

### 2.4 Review notes (both stores)

> No account is needed to use the app. To try it: on the first screen, tap "Explore with demo data". Sync (optional) signs in with a code sent by email. Bank connections use an authorised account information provider (GoCardless) and are read-only: the app makes no payments. Data is stored on the device and, with sync, end-to-end encrypted on our server.

## 3. Build for a release (every time)

1. Set the release version in `package.json` (and add it to [CHANGELOG.md](../CHANGELOG.md)). Each store upload needs a new version: to upload again, bump the patch number.
2. Build the app for the live server and copy it into both native projects. This also sets the native version and build number from `package.json` ([`scripts/native-version.mjs`](../scripts/native-version.mjs): 0.20.1 → build 2001):

   ```bash
   VITE_API_ORIGIN=https://mizan.tarikelberrak.com npm run native:sync
   ```

   (In PowerShell: `$env:VITE_API_ORIGIN='https://mizan.tarikelberrak.com'; npm run native:sync`.)

Without `VITE_API_ORIGIN`, the native apps cannot reach the sync server: everything else works, but sync, bank connections and news by email do not.

## 4. Android: Google Play

### 4.1 Android Studio

Install [Android Studio](https://developer.android.com/studio) (it includes the Java JDK and the Android SDK). Then:

```bash
npm run native:android
```

Android Studio opens the `android/` project. Let it finish "Gradle sync" the first time (a few minutes).

### 4.2 Try it

- **Emulator:** Device Manager → create a phone (e.g. Pixel 8, latest Android) → press **Run** ▶.
- **Your phone:** turn on Developer options and USB debugging, connect it by USB, choose it in the device list, press **Run**.

Check: demo data, adding a transaction, a receipt photo, the app lock with fingerprint (Settings → Security), a reminder (Settings → Notifications → Send a test notification), and sync sign-in with an emailed code.

### 4.3 The upload key (once)

**Build → Generate Signed App Bundle or APK → Android App Bundle → Create new…** keystore:

- Save the keystore file (e.g. `mizan-upload.jks`) **outside the project folder** and back it up; keep its passwords in your password manager. `*.jks` must never be committed.
- Google Play keeps the real app signing key (**Play App Signing**, the default); this upload key only proves uploads are yours. If it is lost, Google can reset it after a support request.

Then choose **release** and finish: the bundle is written to `android/app/release/app-release.aab`.

### 4.4 Play Console

1. **Create app:** name "Mizan: Safe to Spend", default language, App, Free.
2. **Set up your app** (the dashboard lists each task):
   - **Privacy policy:** https://mizan.tarikelberrak.com/privacy
   - **App access:** all functionality is available without special access (or paste the review notes from 2.4).
   - **Ads:** no ads.
   - **Content rating:** fill in the questionnaire (no objectionable content) → usually "Everyone" / PEGI 3.
   - **Target audience:** 18 and over.
   - **Data safety:** use the table in [NATIVE.md](NATIVE.md#store-listings-and-privacy-labels): email address (only with sync, for account management), financial info stored end-to-end encrypted, no data shared with third parties, encrypted in transit, users can ask for deletion.
   - **Financial features:** declare "personal finance: budgeting / tracking"; the app is not a bank, lender or payment service. Bank connections are read-only through a regulated provider.
   - **Government apps, news, health:** no.
3. **Store listing:** texts from 2.3 in each language, the icon, the feature graphic, screenshots.
4. **Testing → Internal testing → Create release:** upload `app-release.aab`, add testers (email addresses), roll out. Testers get a link to install from Google Play within minutes.

### 4.5 New personal accounts: closed testing first

Google requires **new personal developer accounts** to run a **closed test with at least 12 testers who stay opted in for 14 days** before production access is granted (organisation accounts are exempt). Create a **Closed testing** track, invite friends and family by email or a Google Group, keep it running two weeks, then apply for production access from the dashboard.

### 4.6 Production

**Production → Create release**, upload the bundle (or promote the tested one), choose the countries (e.g. United Kingdom, France, and the Arabic-speaking countries you target), and send for review.

## 5. iOS: App Store

### 5.1 Xcode

On a Mac: install Xcode from the Mac App Store, open it once to install its components, clone the repository, then `npm ci` and the build from section 3. Open the project:

```bash
npm run native:ios
```

The iOS project uses Swift Package Manager: no CocoaPods to install.

### 5.2 Signing (once)

Select the **App** target → **Signing & Capabilities**:

- **Team:** your Apple Developer team (sign in under Xcode → Settings → Accounts).
- **Automatically manage signing:** on. The bundle identifier is `app.mizan.money`.

### 5.3 Try it

Choose an iPhone simulator, or your iPhone connected by cable (enable Developer Mode on the phone when asked), and press **Run** ▶. Check the same things as on Android, plus Face ID unlock and taking a receipt photo (the app asks for camera permission with the text in `Info.plist`).

### 5.4 App Store Connect

1. [App Store Connect](https://appstoreconnect.apple.com) → **Apps → +** → New App: platform iOS, name "Mizan: Safe to Spend", primary language, bundle id `app.mizan.money`, SKU `mizan`.
2. **App Information:** category Finance, privacy policy URL, age rating questionnaire (no objectionable content: 4+).
3. **App Privacy:** answer with the table in [NATIVE.md](NATIVE.md#store-listings-and-privacy-labels). Data linked to the user: email address (only with sync, app functionality). No tracking.
4. **Encryption:** the app uses standard encryption (HTTPS, and AES-256-GCM to protect the user's own data). Answer Apple's export compliance questions accordingly when you upload; standard algorithms used for data protection usually qualify for an exemption, but check Apple's guidance for your situation.

### 5.5 Upload and test

In Xcode: choose **Any iOS Device (arm64)** as the destination → **Product → Archive** → the Organizer opens → **Distribute App → App Store Connect → Upload**. After processing (10–30 minutes) the build appears in **TestFlight**: add yourself and testers, install with the TestFlight app.

### 5.6 Submit

In App Store Connect → the app → **iOS App → version 1.0** (the version shown is from `package.json`): screenshots (iPhone and iPad), description, keywords, support URL, the build from TestFlight, review notes from 2.4 → **Add for Review → Submit**.

## 6. iOS without a Mac

Any of these builds and uploads the iOS app from the cloud (you still need the Apple Developer account):

- **Codemagic** or **Ionic Appflow:** connect the GitHub repository, give them App Store Connect API access, and they build and upload to TestFlight.
- **GitHub Actions** on a macOS runner: a workflow can run `npm run native:sync` and `xcodebuild` with your signing certificate and an App Store Connect API key stored as secrets.
- **Renting a Mac** in the cloud (e.g. MacinCloud) and following section 5 over remote desktop.

## 7. Updates

1. Bump `version` in `package.json`, update the changelog, push (the web app and server deploy as usual).
2. `VITE_API_ORIGIN=https://mizan.tarikelberrak.com npm run native:sync` (version and build numbers follow).
3. **Android:** Generate Signed App Bundle with the same upload key → Play Console → Production (or a testing track first) → Create release.
4. **iOS:** Product → Archive → Upload → in App Store Connect, add a new version with the build → submit.

Web-only changes (most fixes) reach the website at once, but reach the store apps only with a new store release: the app's code is inside the store build.

## 8. Troubleshooting

| Problem                                                   | Cause and fix                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Sync says "Cannot reach the sync server" in the store app | Built without `VITE_API_ORIGIN`: rebuild as in section 3                                                                       |
| "Sign in with a passkey" fails in the store app           | Expected: passkeys are tied to the web domain; use the emailed code (Face ID / fingerprint still unlock the app)               |
| Upload refused: version code / build already used         | Bump the patch version in `package.json` and run `npm run native:sync` again                                                   |
| Play Console: "You need to complete closed testing"       | New personal account rule, see [4.5](#45-new-personal-accounts-closed-testing-first)                                           |
| Apple rejects for missing iPad screenshots                | The app supports iPad: add 13" iPad screenshots                                                                                |
| Reminders do not appear on Android 13+                    | The user must allow notifications when Mizan asks (Settings → Notifications in the app)                                        |
| Gradle or Xcode errors after updating Capacitor           | `npx cap sync`, then in Android Studio File → Sync Project with Gradle Files; in Xcode, File → Packages → Reset Package Caches |

## 9. Checklist

- [ ] Apple Developer and Google Play accounts
- [ ] Icons generated (2.1), screenshots (2.2), texts in each language (2.3)
- [ ] `package.json` version set; `VITE_API_ORIGIN=… npm run native:sync`
- [ ] Android: upload key backed up; internal test; closed test with 12 testers for 14 days (new personal accounts); data safety and financial features forms; production
- [ ] iOS: signing team; TestFlight; App Privacy, age rating, export compliance; iPhone and iPad screenshots; submit
- [ ] Review notes pasted in both stores
