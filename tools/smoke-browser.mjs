#!/usr/bin/env node
/**
 * Browser smoke test of the build and team pages, run after UI-touching
 * changes (the test commands section of CLAUDE.md).
 *
 *   npm run smoke                 # Hiyuki (1108)
 *   npm run smoke -- 1107         # another resonator id
 *
 * Serves the repo root on a free local port, opens the build page of a fresh
 * build (`#new/<id>`), then the team page through the build page's own
 * "OPEN IN TEAM SIM" button. Fails on any console error, uncaught page error,
 * failed request, or a page that renders without its numbers. Screenshots go
 * to the OS temp directory (path printed at the end).
 *
 * Needs the Playwright Chromium build once: `npx playwright install chromium`.
 * Not part of `npm test` or CI, because it needs that download.
 */
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, extname, join, normalize, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = join(tmpdir(), 'wuwasim-smoke');
const RESONATOR_ID = Number(process.argv[2] ?? 1108);
const TIMEOUT_MS = 30000;

const CONTENT_TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

const failures = [];
const fail = (message) => failures.push(message);

function startServer() {
    const server = createServer(async (request, response) => {
        const urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const filePath = normalize(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
        if (!filePath.startsWith(ROOT + sep)) { response.writeHead(403).end(); return; }
        try {
            const body = await readFile(filePath);
            response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' });
            response.end(body);
        } catch {
            response.writeHead(404).end();
        }
    });
    return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

function watchForErrors(page) {
    page.on('console', message => { if (message.type() === 'error') fail(`console error: ${message.text()}`); });
    page.on('pageerror', error => fail(`page error: ${error.message}`));
    page.on('requestfailed', request => fail(`request failed: ${request.url()}`));
    page.on('response', response => { if (response.status() >= 400) fail(`HTTP ${response.status()}: ${response.url()}`); });
}

// The top strip's cells, as { label: value }.
async function topStripCells(page) {
    return page.$$eval('.bv2-hud--top .bv2-hud__cell', cells => Object.fromEntries(cells.map(cell => [
        cell.querySelector('.bv2-hud__label')?.textContent.trim() ?? '',
        cell.querySelector('.bv2-hud__val')?.textContent.trim() ?? '',
    ])));
}

async function checkBuildPage(page, baseUrl) {
    await page.goto(`${baseUrl}/#new/${RESONATOR_ID}`);
    await page.getByText('ABILITY DAMAGE OVERVIEW').first().waitFor({ timeout: TIMEOUT_MS });
    const cells = await topStripCells(page);
    for (const label of ['BASIC AVG', 'SKILL AVG', 'LIB AVG', 'OVERALL AVG']) {
        if (!(label in cells)) fail(`build page: top strip has no ${label} cell`);
        else if (!/\d/.test(cells[label])) fail(`build page: ${label} shows "${cells[label]}"`);
    }
    const abilityRows = await page.locator('[data-act="toggle-dmg-row"]').count();
    if (abilityRows === 0) fail('build page: the Ability Damage Overview has no damage rows');
    await page.screenshot({ path: join(SHOT_DIR, 'build-page.png'), fullPage: true });
    return { cells, abilityRows };
}

async function checkTeamPage(page) {
    const openTeam = page.locator('[data-act="load-team"][data-members]').first();
    await openTeam.waitFor({ timeout: TIMEOUT_MS });
    await openTeam.click();
    await page.waitForURL(/#party\//, { timeout: TIMEOUT_MS });
    const teamDps = page.getByText('TEAM DPS').first();
    await teamDps.waitFor({ timeout: TIMEOUT_MS });
    const chip = (await teamDps.locator('xpath=..').textContent())?.trim() ?? '';
    if (!/\d/.test(chip)) fail(`team page: TEAM DPS chip shows "${chip}"`);
    await page.screenshot({ path: join(SHOT_DIR, 'team-page.png'), fullPage: true });
    return { chip };
}

async function main() {
    await mkdir(SHOT_DIR, { recursive: true });
    const server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        watchForErrors(page);
        const build = await checkBuildPage(page, baseUrl);
        console.log(`build page: ${build.abilityRows} ability rows; strip ${JSON.stringify(build.cells)}`);
        const team = await checkTeamPage(page);
        console.log(`team page: ${team.chip}`);
    } catch (error) {
        fail(`aborted: ${error.message.split('\n')[0]}`);
    } finally {
        await browser.close();
        server.close();
    }
    console.log(`screenshots: ${SHOT_DIR}`);
    for (const message of failures) console.error(`  ✗ ${message}`);
    console.log(failures.length === 0 ? 'smoke: PASS' : `smoke: FAIL (${failures.length})`);
    process.exit(failures.length === 0 ? 0 : 1);
}

main();
