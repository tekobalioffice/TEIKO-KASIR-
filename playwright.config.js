import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Kredensial & nama outlet test dibaca dari .env.test.local (gitignored).
loadEnv({ path: '.env.test.local' });
loadEnv({ path: '.env.local' });

export default defineConfig({
  testDir: './e2e',
  // DB satu-satunya = produksi. Jangan paralel — transaksi harus berurutan
  // supaya stok tidak balapan dan assert-nya deterministik.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // "iterasi sampai hijau": retry sekali biar flaky UI (bukan bug data) ketahuan.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    // Download chromium Playwright (rev 1243) di-block di mesin ini. Pakai
    // chrome-headless-shell lama (rev 1234) langsung via executablePath — jauh lebih
    // ringan dari Google Chrome penuh (mesin RAM ketat). Fallback: hapus executablePath
    // & set `channel: 'chrome'`.
    ...(process.env.E2E_CHROME
      ? { channel: 'chrome' }
      : { launchOptions: { executablePath: process.env.HEADLESS_SHELL
          || `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe` } }),
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'id-ID',
    timezoneId: 'Asia/Makassar',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
  ],
  // E2E_BASE_URL di-set (mis. ke `npm run preview` di :4173 yg jauh lebih ringan dari
  // vite dev) → jangan spawn dev server sendiri.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
