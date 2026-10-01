import { test, expect } from '@playwright/test';

test('guest play, pause, settings, persistence and empty/offline leaderboard', async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.url().includes('/rest/') && r.method() !== 'GET') writes.push(r.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play as guest', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'game');
  await page.locator('#maze').press('p');
  await expect(page.getByText('Take a breath.')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Move up: W', exact: true }).click();
  await page.keyboard.press('i');
  await expect(page.getByRole('button', { name: 'Move up: I', exact: true })).toBeVisible();
  await page.getByLabel('Mute sound', { exact: true }).last().check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move up: I', exact: true })).toBeVisible();
  await expect(page.getByLabel('Mute sound', { exact: true }).last()).toBeChecked();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'THE LIGHT LIST.' })).toBeVisible();
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('the production service worker supports offline reload and a playable run', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Prompt-mode workers control the next navigation, not the initial page.
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Play as guest', exact: true }).click();
  await expect(page.locator('#score')).not.toHaveText('000000', { timeout: 10000 });
  await expect(page.locator('#connection')).toHaveText('OFFLINE');
  await page.locator('#maze').press('Escape');
  await expect(page.getByText('Take a breath.')).toBeVisible();
});

test('mobile viewport has no horizontal overflow and accepts touch swipes', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play as guest', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const canvas = page.locator('#maze'), box = (await canvas.boundingBox())!;
  const touch = await context.newCDPSession(page), x = box.x + box.width / 2, y = box.y + box.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 50 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'game');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
