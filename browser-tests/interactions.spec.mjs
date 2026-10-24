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
  assert.equal(await page.locator('.rules-disclosure').textContent(), 'Automatic insufficient-material draws are supported, but some positions where neither side can possibly checkmate may not be recognized.');
  assert.equal(await page.locator('#board [data-square]').count(), 64);
  if (process.env.BROWSER_CHESS_SCREENSHOT) await page.screenshot({ path: process.env.BROWSER_CHESS_SCREENSHOT, fullPage: true });
  await page.locator('#board [data-square="e2"]').click();
  await page.locator('#board [data-square="e4"]').click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.match(await page.locator('#board [data-square="e2"]').getAttribute('aria-label'), /last move origin/);
  assert.match(await page.locator('#board [data-square="e4"]').getAttribute('aria-label'), /last move destination/);
  assert.match(await page.locator('#board [data-square="e4"]').evaluate((el) => getComputedStyle(el).boxShadow), /5px inset.*7px inset/);
  assert.equal(await page.locator('#move-list [aria-current="step"]').textContent(), 'e4');
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
  assert.equal(await page.locator('#board [data-square="e4"]').evaluate((el) => el.matches(':focus-visible')), true);
  assert.equal(await page.locator('#board [data-square="e4"]').evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
  await context.close();
});

test('black chess-piece glyph fill keeps at least 3:1 contrast on dark squares', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  const measurement = await page.locator('#board [data-square="b8"]').evaluate((cell) => {
    const color = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (value) => {
      const [red, green, blue] = color(value).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const foreground = luminance(getComputedStyle(cell.querySelector('.black-piece')).color);
    const backgroundColor = getComputedStyle(cell).backgroundColor;
    const background = luminance(backgroundColor);
    return { isDarkSquare: cell.classList.contains('dark'), backgroundColor, ratio: (background + 0.05) / (foreground + 0.05) };
  });
  assert.equal(measurement.isDarkSquare, true);
  assert.equal(measurement.backgroundColor, 'rgb(121, 115, 104)');
  assert.ok(measurement.ratio >= 3, `expected at least 3:1 contrast on the dark square, got ${measurement.ratio.toFixed(2)}:1`);
  await context.close();
});

test('system light appearance uses its own warm palette with readable text and accent controls', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage({ colorScheme: 'light' });
  const values = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--page', '--ink', '--muted', '--accent', '--accent-ink'].map((key) => [key, style.getPropertyValue(key).trim()]));
  });
  const rgb = (value) => value.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = (value) => { const [r, g, b] = rgb(value); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (foreground, background) => { const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (high + 0.05) / (low + 0.05); };
  assert.notEqual(values['--page'], '#17191a');
  assert.ok(ratio(values['--ink'], values['--page']) >= 4.5);
  assert.ok(ratio(values['--muted'], values['--page']) >= 4.5);
  assert.ok(ratio(values['--accent-ink'], values['--accent']) >= 4.5);
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
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').textContent(), 'e4');
  assert.match(await page.locator('#replay-board [data-square="e2"]').getAttribute('aria-label'), /last move origin/);
  assert.match(await page.locator('#replay-board [data-square="e4"]').getAttribute('aria-label'), /last move destination/);
  await page.locator('#replay-next').click();
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').textContent(), 'e5');
  await page.getByRole('button', { name: 'Return to your game' }).click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.equal(await page.evaluate(() => localStorage.getItem('dxnnystyles.browser-chess.v1')), before);
  await context.close();
});

test('Opera replay play, pause, forward, back and restart preserve the active saved game', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  await page.locator('#board [data-square="e2"]').click(); await page.locator('#board [data-square="e4"]').click();
  const savedGame = await page.evaluate(() => localStorage.getItem('dxnnystyles.browser-chess.v1'));
  await page.getByRole('button', { name: 'Replay the Opera Game' }).click();

  await page.locator('#replay-start').click();
  await page.waitForFunction(() => document.querySelector('#replay-start')?.textContent === 'Pause' && document.querySelector('#replay-moves [aria-current="step"]')?.textContent === 'e4', null, { timeout: 5000 });
  await page.locator('#replay-start').click();
  assert.equal(await page.locator('#replay-start').textContent(), 'Play');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').textContent(), 'e4');

  await page.locator('#replay-next').click();
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').textContent(), 'e5');
  await page.locator('#replay-back').click();
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').textContent(), 'e4');
  await page.locator('#replay-reset').click();
  assert.match(await page.locator('#replay-progress').textContent(), /Starting position/);
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').count(), 0);
  assert.equal(await page.locator('#replay-back').isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('dxnnystyles.browser-chess.v1')), savedGame);

  await page.getByRole('button', { name: 'Return to your game' }).click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.match(await page.locator('#board [data-square="e4"]').getAttribute('aria-label'), /White pawn/);
  assert.equal(await page.evaluate(() => localStorage.getItem('dxnnystyles.browser-chess.v1')), savedGame);
  await context.close();
});

test('current threefold claim requires confirmation and leaves the position unchanged', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const setup = new Chess(); for (const san of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) setup.move(san);
  const seed = { version: 1, moves: setup.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, ...(promotion ? { promotion } : {}) })) };
  const { page, context } = await newPage();
  await page.evaluate((value) => localStorage.setItem('dxnnystyles.browser-chess.v1', JSON.stringify(value)), seed);
  await page.reload();
  assert.equal(await page.locator('#result').isVisible(), false);
  assert.equal(await page.locator('#claim-draw').isVisible(), true);
  assert.match(await page.locator('#claim-draw-help').textContent(), /threefold repetition/);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')));
  await page.locator('#claim-draw').click();
  assert.equal(await page.locator('#current-draw-dialog').evaluate((el) => el.open), true);
  await page.locator('#cancel-current-draw').click();
  assert.equal(await page.locator('#result').isVisible(), false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')).moves.length), before.moves.length);
  await page.locator('#claim-draw').click();
  await page.locator('#confirm-current-draw').click();
  assert.match(await page.locator('#result').textContent(), /Draw claimed by threefold repetition/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')));
  assert.equal(saved.drawClaim.basis, 'current');
  assert.deepEqual(saved.moves, before.moves);
  await page.reload();
  assert.match(await page.locator('#result').textContent(), /Draw claimed by threefold repetition/);
  await context.close();
});

test('intended threefold claim offers Claim draw or the exact intended move', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const setup = new Chess(); for (const san of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1']) setup.move(san);
  const seed = { version: 2, moves: setup.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, ...(promotion ? { promotion } : {}) })) };
  const { page, context } = await newPage();
  await page.evaluate((value) => localStorage.setItem('dxnnystyles.browser-chess.v1', JSON.stringify(value)), seed);
  await page.reload();
  await page.locator('#board [data-square="f6"]').click();
  await page.locator('#board [data-square="g8"]').click();
  assert.equal(await page.locator('#intended-draw-dialog').evaluate((el) => el.open), true);
  assert.match(await page.locator('#intended-draw-copy').textContent(), /Ng8.*threefold repetition/);
  assert.equal(await page.locator('#play-intended-move').textContent(), 'Play Ng8 instead');
  assert.equal(await page.locator('#move-list .move-row').count(), 4);
  assert.match(await page.locator('#board [data-square="f6"]').getAttribute('aria-label'), /Black knight/);
  const beforeFen = setup.fen();
  await page.locator('#claim-intended-draw').click();
  assert.match(await page.locator('#result').textContent(), /Draw claimed by threefold repetition/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')));
  assert.equal(saved.drawClaim.basis, 'intended');
  assert.deepEqual(saved.drawClaim.intendedMove, { from: 'f6', to: 'g8' });
  assert.deepEqual(saved.moves, seed.moves);
  assert.equal(saved.moves.length, 7);
  const after = new Chess(); for (const move of saved.moves) after.move(move);
  assert.equal(after.fen(), beforeFen, 'claiming the intended move must preserve the active position');
  assert.match(await page.locator('#board [data-square="f6"]').getAttribute('aria-label'), /Black knight/);
  assert.match(await page.locator('#board [data-square="g8"]').getAttribute('aria-label'), /Empty/);
  await page.reload();
  assert.match(await page.locator('#result').textContent(), /Draw claimed by threefold repetition/);
  await context.close();
});

test('playing the intended move applies it once and makes a current claim available', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const setup = new Chess(); for (const san of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1']) setup.move(san);
  const seed = { version: 1, moves: setup.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, ...(promotion ? { promotion } : {}) })) };
  const { page, context } = await newPage();
  await page.evaluate((value) => localStorage.setItem('dxnnystyles.browser-chess.v1', JSON.stringify(value)), seed);
  await page.reload();
  await page.locator('#board [data-square="f6"]').click(); await page.locator('#board [data-square="g8"]').click();
  await page.locator('#play-intended-move').click();
  assert.equal(await page.locator('#move-list .move-row').count(), 4);
  assert.match(await page.locator('#board [data-square="g8"]').getAttribute('aria-label'), /Black knight/);
  assert.equal(await page.locator('#result').isVisible(), false);
  assert.equal(await page.locator('#claim-draw').isVisible(), true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')));
  assert.equal(saved.moves.length, 8);
  assert.equal(saved.drawClaim, undefined);
  await context.close();
});

test('draw offers require both players to move, persist, and need explicit accept or decline', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  const offer = page.locator('#draw-agreement');
  assert.equal(await offer.isDisabled(), true);
  await page.locator('#board [data-square="e2"]').click(); await page.locator('#board [data-square="e4"]').click();
  assert.equal(await offer.isDisabled(), true);
  await page.locator('#board [data-square="e7"]').click(); await page.locator('#board [data-square="e5"]').click();
  assert.equal(await offer.isDisabled(), false);
  await offer.click();
  assert.match(await page.locator('#draw-offer-copy').textContent(), /Black offers a draw/);
  assert.equal(await page.locator('#accept-draw-offer').isVisible(), true);
  assert.equal(await page.locator('#decline-draw-offer').isVisible(), true);
  await page.reload();
  assert.match(await page.locator('#draw-offer-copy').textContent(), /Black offers a draw/);
  await page.locator('#decline-draw-offer').click();
  assert.equal(await page.locator('#draw-offer-response').isVisible(), false);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')))).drawOffer, undefined);
  await offer.click(); await page.locator('#accept-draw-offer').click();
  assert.match(await page.locator('#result').textContent(), /Draw by agreement/);
  await page.reload();
  assert.match(await page.locator('#result').textContent(), /Draw by agreement/);
  await context.close();
});

test('a board move clears an unanswered draw offer', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage();
  await page.locator('#board [data-square="e2"]').click(); await page.locator('#board [data-square="e4"]').click();
  await page.locator('#board [data-square="e7"]').click(); await page.locator('#board [data-square="e5"]').click();
  await page.locator('#draw-agreement').click();
  await page.locator('#board [data-square="g1"]').click(); await page.locator('#board [data-square="f3"]').click();
  assert.equal(await page.locator('#draw-offer-response').isVisible(), false);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('dxnnystyles.browser-chess.v1')))).drawOffer, undefined);
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  await context.close();
});

test('mobile board reflows without horizontal scrolling and supports touch play', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  if (process.env.BROWSER_CHESS_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.BROWSER_CHESS_MOBILE_SCREENSHOT, fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.locator('#board [data-square="a8"]').evaluate((square) => ({ cell: square.getBoundingClientRect().width, piece: parseFloat(getComputedStyle(square.querySelector('.piece')).fontSize) }));
    assert.ok(geometry.piece <= geometry.cell * 0.75, `${width}px board pieces should leave clear space for coordinate labels`);
    const rankOutsideBoard = await page.locator('#board [data-square="a8"] .rank-coord').evaluate((label) => label.getBoundingClientRect().right <= label.closest('[data-square]').getBoundingClientRect().left);
    const fileOutsideBoard = await page.locator('#board [data-square="a1"] .file-coord').evaluate((label) => label.getBoundingClientRect().top >= label.closest('[data-square]').getBoundingClientRect().bottom);
    assert.equal(rankOutsideBoard, true, 'rank coordinates should sit in the board frame gutter');
    assert.equal(fileOutsideBoard, true, 'file coordinates should sit in the board frame gutter');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  }
  await page.setViewportSize({ width: 375, height: 812 });
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
  assert.equal(await page.locator('#recovery-message').textContent(), 'The saved game could not be read. Your saved data has been left unchanged. Start a fresh game to continue.');
  assert.equal(await page.evaluate(() => localStorage.getItem('dxnnystyles.browser-chess.v1')), '{broken');
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
  await page.locator('#board [data-square="e2"]').click(); await page.locator('#board [data-square="e4"]').click();
  await page.locator('#board [data-square="e7"]').click(); await page.locator('#board [data-square="e5"]').click();
  await page.locator('#draw-agreement').click();
  assert.match(await page.locator('#draw-offer-copy').textContent(), /Black offers a draw/);
  await page.locator('#accept-draw-offer').click();
  assert.match(await page.locator('#result').textContent(), /Draw by agreement/);
  await context.close();
});

test('capture charcoal desktop and narrow renders in both system appearances', { skip: !canLaunch || !['BROWSER_CHESS_CAPTURE_DARK_DESKTOP','BROWSER_CHESS_CAPTURE_LIGHT_DESKTOP','BROWSER_CHESS_CAPTURE_DARK_NARROW','BROWSER_CHESS_CAPTURE_LIGHT_NARROW'].every((key) => process.env[key]) }, async () => {
  const desktop = await newPage({ colorScheme: 'dark' });
  const desktopE2 = desktop.page.locator('#board [data-square="e2"]');
  await desktopE2.focus(); await desktop.page.keyboard.press('Enter'); await desktop.page.keyboard.press('ArrowUp'); await desktop.page.keyboard.press('Enter');
  await assertKeyboardEndpointState(desktop.page);
  assert.equal(await desktop.page.locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--page').trim()), '#17191a');
  await desktop.page.screenshot({ path: process.env.BROWSER_CHESS_CAPTURE_DARK_DESKTOP, fullPage: true });
  await desktop.context.close();

  const lightDesktop = await newPage({ colorScheme: 'light' });
  const lightDesktopE2 = lightDesktop.page.locator('#board [data-square="e2"]');
  await lightDesktopE2.focus(); await lightDesktop.page.keyboard.press('Enter'); await lightDesktop.page.keyboard.press('ArrowUp'); await lightDesktop.page.keyboard.press('Enter');
  await assertKeyboardEndpointState(lightDesktop.page);
  assert.equal(await lightDesktop.page.locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--page').trim()), '#272624');
  await lightDesktop.page.screenshot({ path: process.env.BROWSER_CHESS_CAPTURE_LIGHT_DESKTOP, fullPage: true });
  await lightDesktop.context.close();

  const narrow = await newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const narrowE2 = narrow.page.locator('#board [data-square="e2"]');
  await narrowE2.focus(); await narrow.page.keyboard.press('Enter'); await narrow.page.keyboard.press('ArrowUp'); await narrow.page.keyboard.press('Enter');
  await assertKeyboardEndpointState(narrow.page);
  const rankCoordinate = narrow.page.locator('#board [data-square="a8"] .rank-coord');
  assert.equal(await rankCoordinate.evaluate((el) => getComputedStyle(el).fontSize), '10px');
  assert.equal(await rankCoordinate.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(23, 24, 23, 0.875)');
  await narrow.page.screenshot({ path: process.env.BROWSER_CHESS_CAPTURE_DARK_NARROW, fullPage: true });
  assert.equal(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await narrow.context.close();

  const lightNarrow = await newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const lightNarrowE2 = lightNarrow.page.locator('#board [data-square="e2"]');
  await lightNarrowE2.focus(); await lightNarrow.page.keyboard.press('Enter'); await lightNarrow.page.keyboard.press('ArrowUp'); await lightNarrow.page.keyboard.press('Enter');
  await assertKeyboardEndpointState(lightNarrow.page);
  await lightNarrow.page.screenshot({ path: process.env.BROWSER_CHESS_CAPTURE_LIGHT_NARROW, fullPage: true });
  assert.equal(await lightNarrow.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await lightNarrow.context.close();
});

async function assertKeyboardEndpointState(page) {
  const origin = page.locator('#board [data-square="e2"]');
  const destination = page.locator('#board [data-square="e3"]');
  assert.equal(await origin.evaluate((el) => el.classList.contains('light')), true);
  assert.equal(await destination.evaluate((el) => el.classList.contains('dark')), true);
  assert.match(await origin.getAttribute('aria-label'), /last move origin/);
  assert.match(await destination.getAttribute('aria-label'), /last move destination/);
  assert.match(await origin.evaluate((el) => getComputedStyle(el).boxShadow), /5px inset.*7px inset/);
  assert.match(await destination.evaluate((el) => getComputedStyle(el).boxShadow), /5px inset.*7px inset/);
  assert.equal(await destination.evaluate((el) => el.matches(':focus-visible')), true);
  assert.equal(await destination.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
  assert.equal(await page.locator('#move-list [aria-current="step"]').textContent(), 'e3');
}

test('reduced motion keeps replay stepping usable and removes control transitions', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const { page, context } = await newPage({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  await page.getByRole('button', { name: 'Replay the Opera Game' }).click();
  const transitionDuration = await page.locator('#replay-next').evaluate((el) => getComputedStyle(el).transitionDuration);
  assert.ok(Number.parseFloat(transitionDuration) <= 0.001, `expected reduced transition, got ${transitionDuration}`);
  await page.locator('#replay-next').click();
  assert.match(await page.locator('#replay-progress').textContent(), /Black to move/);
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').textContent(), 'e4');
  await page.locator('#replay-next').click();
  assert.equal(await page.locator('#replay-moves [aria-current="step"]').textContent(), 'e5');
  await context.close();
});
