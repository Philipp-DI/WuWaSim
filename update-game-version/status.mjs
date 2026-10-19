#!/usr/bin/env node
// update-game-version/status.mjs — step 1: is the target version ready on
// both halves, and what is installed and exported on this machine?
//
//   node update-game-version/status.mjs --version 3.7
//
// Exits 1 when Arikatsu or nanoka lacks the target version.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NANOKA, USER_AGENT, flag, loadLocal, nanokaVersionFor, readGameVersion, reportsDir } from './sources.mjs';
import { REPO } from '../tools/preprocess/download.mjs';

// Version-shaped names only: Saved/Resources also holds "Video", which a plain
// sort puts above "3.6.0". Numeric compare, so 3.7.15 beats 3.7.2.
function newestVersionDir(dir) {
    if (!existsSync(dir)) return null;
    return readdirSync(dir)
        .filter(name => /^\d+(\.\d+)*$/.test(name) && statSync(join(dir, name)).isDirectory())
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))[0] ?? null;
}

/**
 * The install as the client runs it. THE BASE PAKS ARE NOT THE LIVE GAME:
 * every hotfix lands under Client/Saved/Resources/<version>/Resource/<hotfix>/.
 * @returns {{ resources: string|null, hotfix: string|null, hotfixDir: string|null }}
 */
export function readInstall(installPath) {
    const resourcesDir = installPath ? join(installPath, 'Client', 'Saved', 'Resources') : null;
    const resources = resourcesDir ? newestVersionDir(resourcesDir) : null;
    const lane = resources ? join(resourcesDir, resources, 'Resource') : null;
    const hotfix = lane ? newestVersionDir(lane) : null;
    return { resources, hotfix, hotfixDir: hotfix ? join(lane, hotfix) : null };
}

/**
 * BuildInfo.txt ships inside the paks, so only an EXPORT carries it: it says
 * which build the current export was taken from, not what is installed.
 * @returns {{ stream: string|null, patchVersion: string|null }}
 */
export function readExportBuild(exportRoot) {
    const path = exportRoot ? join(exportRoot, 'Content', 'Aki', 'ConfigDB', 'Misc', 'BuildInfo.txt') : null;
    if (!path || !existsSync(path)) return { stream: null, patchVersion: null };
    const text = readFileSync(path, 'utf8');
    const field = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? null;
    return { stream: field('Stream'), patchVersion: field('PatchVersion') };
}

async function arikatsuBranchExists(version) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/branches/${version}`, { headers: { 'User-Agent': USER_AGENT } });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return true;
}

async function nanokaManifest() {
    const response = await fetch(`${NANOKA}/manifest.json`, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`nanoka manifest HTTP ${response.status}`);
    return (await response.json()).ww;
}

function renderStatus({ version, pinned, installed, exported, branch, manifest, nanokaVersion }) {
    const installLine = installed.resources
        ? `${installed.resources}${installed.hotfix ? `, newest hotfix lane ${installed.hotfix}` : ''}`
        : '(no install — set installPath in local.json)';
    const exportLine = exported.patchVersion
        ? `PatchVersion ${exported.patchVersion} (${exported.stream})`
        : '(no BuildInfo.txt — set exportRoot in local.json)';
    const available = manifest.available ?? [];
    return [
        `# Status for ${version} (${new Date().toISOString().slice(0, 10)})`,
        '',
        `- pinned:    arikatsu ${pinned.arikatsu}, nanoka ${pinned.nanoka}`,
        `- installed: ${installLine}`,
        `- export:    ${exportLine}`,
        `- arikatsu:  branch ${version} ${branch ? 'exists' : 'MISSING'}`,
        `- nanoka:    live ${manifest.live}, latest ${manifest.latest}, available [${available.join(', ')}]`
            + ` -> ${nanokaVersion ? `stages ${nanokaVersion}` : `NO version for ${version}`}`,
        `- nanoka new in this build: characters [${(manifest.new?.character ?? []).join(', ')}]`,
    ];
}

async function main() {
    const version = flag(process.argv, '--version');
    if (!version) {
        console.error('Usage: node update-game-version/status.mjs --version <x.y>');
        process.exit(2);
    }
    const local = loadLocal();
    const manifest = await nanokaManifest();
    const facts = {
        version,
        pinned: readGameVersion(),
        installed: readInstall(local.installPath),
        exported: readExportBuild(local.exportRoot),
        branch: await arikatsuBranchExists(version),
        manifest,
        nanokaVersion: nanokaVersionFor(manifest.available ?? [], version),
    };
    const ready = facts.branch && facts.nanokaVersion != null;
    const lines = renderStatus(facts);
    lines.push('', ready ? `READY: both halves carry ${version}.` : `NOT READY: ${facts.branch ? 'nanoka' : 'Arikatsu'} lacks ${version}.`);
    const report = `${lines.join('\n')}\n`;
    process.stdout.write(report);
    mkdirSync(reportsDir(version), { recursive: true });
    writeFileSync(resolve(reportsDir(version), 'status.md'), report);
    process.exit(ready ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
