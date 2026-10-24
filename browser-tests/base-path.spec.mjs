import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const canLaunch = executablePath ? existsSync(executablePath) : existsSync(chromium.executablePath());
let server; let browser; let baseUrl;

before(async () => {
  server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}/browser-chess/`;
  if (canLaunch) browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });

test('built entry and generated assets load under the project-site prefix', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /src="\/browser-chess\/assets\/index-[^"]+\.js"/);
  assert.match(html, /href="\/browser-chess\/assets\/index-[^"]+\.css"/);
  const paths = [...html.matchAll(/(?:src|href)="(\/browser-chess\/assets\/[^\"]+)"/g)].map((match) => match[1]);
  assert.equal(paths.length, 2);
  for (const path of paths) assert.equal((await fetch(new URL(path, baseUrl))).status, 200, `${path} should load`);
});

test('built game runs at the candidate project-site URL', { skip: !canLaunch && 'Chromium is not installed; set PLAYWRIGHT_CHROMIUM_EXECUTABLE.' }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const failedRequests = [];
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  await page.goto(baseUrl);
  assert.equal(await page.locator('#board [data-square]').count(), 64);
  await page.locator('#board [data-square="e2"]').click();
  await page.locator('#board [data-square="e4"]').click();
  assert.match(await page.locator('#turn-copy').textContent(), /Black to move/);
  assert.deepEqual(failedRequests, []);
  await page.close();
});
