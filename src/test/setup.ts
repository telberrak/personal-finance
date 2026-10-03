// Gives Dexie a real IndexedDB implementation in tests, and adds DOM matchers (toBeInTheDocument…).
import 'fake-indexeddb/auto';
import '../i18n';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
