/**
 * Native apps (iOS and Android) wrap the same web app with Capacitor. Build the web app, then
 * copy it into the native projects: `npm run native:sync`. See docs/NATIVE.md.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Reverse-DNS id registered with Apple and Google. Change before the first store upload; it cannot change after.
  appId: 'app.ledger.money',
  appName: 'Ledger',
  webDir: 'dist',
  // Serve the app as https://localhost inside the app, so secure-context APIs (crypto.subtle) work.
  server: { androidScheme: 'https', iosScheme: 'capacitor' },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_ledger', iconColor: '#2B54E0' },
  },
};

export default config;
