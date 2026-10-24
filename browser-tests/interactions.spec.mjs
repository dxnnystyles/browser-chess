import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { Chess } from 'chess.js';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const canLaunch = executablePath ? existsSync(executablePath) : existsSync(chromium.executablePath());
let server; let browser; let baseUrl;

before(async () => {
  if (!canLaunch) return;
  server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(process.env.BROWSER_CHESS_SCREENSHOT ? { colorScheme: process.env.BROWSER_CHESS_COLOR_SCHEME ?? 'dark' } : {}), ...options });
  const page = await context.newPage();
  await page.goto(baseUrl);
  return { page, context };
}

test('pointer moves a legal pawn and a reload restores the position', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  assert.equal(await page.locator('#board [data-square]').count(), 64);
  if (process.env.BROWSER_CHESS_SCREENSHOT) await page.screenshot({ path: process.env.BROWSER_CHESS_SCREENSHOT, fullPage: true });
  await page.locator('#board [data-square="e2"]').click();
  await page.locator('#board [data-square="e4"]').click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  await page.reload();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.match(await page.locator('#board [data-square="e4"]').getAttribute('aria-label'), /White pawn/);
  await context.close();
});

test('keyboard selects a piece and completes a legal move', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  const e2 = page.locator('#board [data-square="e2"]'); await e2.focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.square), 'e4');
  await context.close();
});

test('promotion offers four choices and applies the selected piece', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const setup = new Chess();
  for (const san of ['b4','a5','bxa5','Nc6','a6','Rb8','a7','g6']) setup.move(san);
  const seed = { version: 1, moves: setup.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, ...(promotion ? { promotion } : {}) })) };
  const { page, context } = await newPage();
  await page.evaluate((value) => localStorage.setItem('dxnnystyles.browser-chess.v1', JSON.stringify(value)), seed);
  await page.reload();
  await page.locator('#board [data-square="a7"]').click();
  await page.locator('#board [data-square="b8"]').click();
  assert.equal(await page.locator('#promotion-options button').count(), 4);
  await page.locator('#promotion-options button').filter({ hasText: 'Knight' }).click();
  assert.match(await page.locator('#board [data-square="b8"]').getAttribute('aria-label'), /White knight/);
  await context.close();
});

test('Opera replay is separate and leaves the saved match intact', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  await page.locator('#board [data-square="e2"]').click(); await page.locator('#board [data-square="e4"]').click();
  const before = await page.evaluate(() => localStorage.getItem('dxnnystyles.browser-chess.v1'));
  await page.getByRole('button', { name: 'Replay the Opera Game' }).click();
  assert.match(await page.locator('#replay-title').textContent(), /Opera Game/);
  assert.match(await page.locator('#replay-progress').textContent(), /Starting position/);
  await page.locator('#replay-next').click();
  assert.equal(await page.locator('#replay-board [data-square]').count(), 64);
  await page.getByRole('button', { name: 'Return to your game' }).click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.equal(await page.evaluate(() => localStorage.getItem('dxnnystyles.browser-chess.v1')), before);
  await context.close();
});

test('mobile board reflows without horizontal scrolling and supports touch play', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  if (process.env.BROWSER_CHESS_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.BROWSER_CHESS_MOBILE_SCREENSHOT, fullPage: true });
  await page.locator('#board [data-square="e2"]').tap();
  await page.locator('#board [data-square="e4"]').tap();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await context.close();
});

test('browser storage write failure preserves playable in-memory state', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('Blocked', 'QuotaExceededError'); }; });
  const page = await context.newPage(); await page.goto(baseUrl);
  await page.locator('#board [data-square="e2"]').click(); await page.locator('#board [data-square="e4"]').click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.match(await page.locator('#save-state').textContent(), /Reload recovery unavailable/);
  await context.close();
});

test('invalid saved state blocks play until a fresh game is chosen', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('dxnnystyles.browser-chess.v1', '{broken'));
  const page = await context.newPage(); await page.goto(baseUrl);
  assert.equal(await page.locator('#recovery-dialog').evaluate((el) => el.open), true);
  await page.locator('#recovery-new').click();
  assert.match(await page.locator('#turn-copy').textContent(), /White to move/);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')).moves), []);
  await context.close();
});

test('new game confirmation preserves an active position until confirmed', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  await page.locator('#board [data-square="e2"]').click(); await page.locator('#board [data-square="e4"]').click();
  await page.locator('#new-game').click();
  assert.equal(await page.locator('#new-game-dialog').evaluate((el) => el.open), true);
  await page.locator('#new-game-dialog button[value="cancel"]').click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  await page.locator('#new-game').click(); await page.locator('#confirm-new').click();
  assert.match(await page.locator('#turn-copy').textContent(), /White to move/);
  await context.close();
});

test('checkmate and agreed-draw outcomes are visible and can be followed by a fresh game', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const mate = new Chess(); for (const san of ['f3','e5','g4','Qh4#']) mate.move(san);
  const seed = { version: 1, moves: mate.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, ...(promotion ? { promotion } : {}) })) };
  const { page, context } = await newPage();
  await page.evaluate((value) => localStorage.setItem('dxnnystyles.browser-chess.v1', JSON.stringify(value)), seed);
  await page.reload();
  assert.match(await page.locator('#result').textContent(), /Black wins by checkmate/);
  await page.locator('#new-game').click();
  assert.match(await page.locator('#turn-copy').textContent(), /White to move/);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#draw-agreement').click();
  assert.match(await page.locator('#result').textContent(), /Draw by agreement/);
  await context.close();
});
