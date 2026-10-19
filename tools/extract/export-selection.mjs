// tools/extract/export-selection.mjs — one regex for FModel's Search box that
// selects exactly what export-manifest.json lists, so an export is a paste and a
// select-all instead of a walk through the folder tree.
//
// FModel's Search window (Regex toggle on) tests each file's path, which starts
// at the game root ("Client/Content/Aki/..."), and its Export > Raw Data acts on
// every selected row (FModel SearchView.xaml / SearchViewModel.cs, dev branch).

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {object} manifest   tools/extract/export-manifest.json
 * @param {string[]} assetDirs character asset dirs as "<BodyType>/<Dir>", e.g. "FemaleS/Suoming"
 * @returns {string} a pattern (case-insensitive use intended): a FILE entry must
 *   match whole, a DIR entry or asset dir matches as a prefix ending in "/".
 */
export function selectionRegex(manifest, assetDirs = []) {
    const entries = Object.values(manifest.groups).flatMap(group => group.paths ?? []);
    const alternatives = [
        ...entries.map(entry => escape(entry.path) + (entry.kind === 'dir' ? '/' : '$')),
        ...assetDirs.map(dir => `${escape(`Content/Aki/Character/Role/${dir}`)}/`),
    ];
    return `(?:^|/)(?:${alternatives.join('|')})`;
}
