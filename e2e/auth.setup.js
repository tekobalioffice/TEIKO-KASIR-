import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';

const ADMIN_FILE = 'e2e/.auth/admin.json';
const BRANCH_FILE = 'e2e/.auth/branch.json';
const GUDANG_FILE = 'e2e/.auth/gudang.json';
const HAS_BRANCH = !!(process.env.E2E_BRANCH_USER && process.env.E2E_BRANCH_PASS);
const HAS_GUDANG = !!(process.env.E2E_GUDANG_USER && process.env.E2E_GUDANG_PASS);

fs.mkdirSync('e2e/.auth', { recursive: true });

async function loginAndSave(page, user, pass, file, expectPath) {
  await page.goto('/login');
  await page.getByPlaceholder(/bagastya atau admin/i).fill(user);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.getByRole('button', { name: /sign in/i }).click();
  // App redirect via HomeRedirect setelah profil ke-fetch.
  await page.waitForURL((url) => url.pathname.startsWith(expectPath), { timeout: 20_000 });
  await page.context().storageState({ path: file });
}

setup('authenticate admin', async ({ page }) => {
  const user = process.env.E2E_ADMIN_USER;
  const pass = process.env.E2E_ADMIN_PASS;
  expect(user && pass, 'Isi E2E_ADMIN_USER & E2E_ADMIN_PASS di .env.test.local').toBeTruthy();
  await loginAndSave(page, user, pass, ADMIN_FILE, '/admin');
});

// Cuma daftarkan kalau ada kredensial cabang → tak launch browser sia-sia (hemat
// memori, tak crash pas RAM mepet).
if (HAS_BRANCH) {
  setup('authenticate branch', async ({ page }) => {
    await loginAndSave(page, process.env.E2E_BRANCH_USER, process.env.E2E_BRANCH_PASS, BRANCH_FILE, '/branch');
  });
}

if (HAS_GUDANG) {
  setup('authenticate gudang', async ({ page }) => {
    await loginAndSave(page, process.env.E2E_GUDANG_USER, process.env.E2E_GUDANG_PASS, GUDANG_FILE, '/gudang');
  });
}
