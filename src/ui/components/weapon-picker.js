/**
 * Weapon picker + weapon-text formatters — shared by the Build editor
 * (build-editor/, single equipped weapon) and the Team editor
 * (team-editor-v2.js, one weapon per slot). Both pages open the same generic
 * modal-picker.js overlay with the same row layout (icon, name, rarity/type,
 * resolved lvl-90 stat line) so the two pickers never drift apart again.
 *
 *   openWeaponPicker({
 *     dataset,             // { weapons: [...] }
 *     resonator,           // { weaponType, weaponTypeName }
 *     currentWeaponId,     // truthy → shows the "— Remove —" row
 *     onPick(weapon|null), // null when the unequip row is chosen
 *   })
 */

import { esc } from '../dom.js';
import * as modal from './modal-picker.js';

const WEAPON_STAT_KEY = {
  ATK: 'atk',
  HP: 'hp',
  DEF: 'def',
  'Crit. Rate': 'critRate',
  'Crit. DMG': 'critDmg',
  'Energy Regen': 'energyRegen',
  'ATK%': 'atkPct',
  'HP%': 'hpPct',
  'DEF%': 'defPct',
};

// "ATK 587 · Crit. Rate 24.3%" — the weapon's resolved main/sub stat at its
// current level, read straight off the pre-resolved statsByLevel table.
export function weaponStatsLine(wpn, level) {
  const byLevel = wpn?.statsByLevel;
  if (!byLevel) return '';
  const resolvedLevel = byLevel[level] ? level : 90;
  const s = byLevel[resolvedLevel];
  if (!s) return '';
  const parts = [`ATK ${Math.round(s.atk ?? 0)}`];
  const subKey = WEAPON_STAT_KEY[wpn.subStatName];
  if (subKey && s[subKey] != null) {
    const isFlat = subKey === 'atk' || subKey === 'hp' || subKey === 'def';
    parts.push(
      `${wpn.subStatName} ${isFlat ? Math.round(s[subKey]) : Math.round(s[subKey] * 1000) / 10 + '%'}`,
    );
  }
  return parts.join(' · ');
}

// Passive effect desc carries unsubstituted {n} placeholders filled per
// refinement rank (effectParams[n] is a 5-entry [R1..R5] array).
export function weaponEffectDesc(wpn, rank) {
  if (!wpn?.effect) return '';
  const rankIndex = Math.max(0, Math.min(4, (rank ?? 1) - 1));
  const filled = wpn.effect.replace(
    /\{(\d+)\}/g,
    (m, i) => wpn.effectParams?.[Number(i)]?.[rankIndex] ?? m,
  );
  return wpn.effectName ? `${wpn.effectName} — ${filled}` : filled;
}

export function weaponTooltipDesc(wpn, build) {
  const statsLine = weaponStatsLine(wpn, build?.weapon?.level ?? 1);
  const effectLine = weaponEffectDesc(wpn, build?.weapon?.rank ?? 1);
  return [statsLine, effectLine].filter(Boolean).join('\n\n');
}

function weaponIcon(w) {
  return w.iconUrl
    ? `<img class="option__icon" src="${esc(w.iconUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<span class="option__icon option__icon--missing"></span>`;
}

/** Public: open the shared weapon-picker modal. */
export function openWeaponPicker({ dataset, resonator, currentWeaponId, onPick }) {
  if (!resonator) return;
  const weapons = (dataset?.weapons ?? [])
    .filter((w) => w.type === resonator.weaponType)
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));

  modal.open({
    title: `Choose a ${resonator.weaponTypeName}`,
    items: weapons,
    searchFields: ['name'],
    allowUnequip: !!currentWeaponId,
    renderRow: (w) => `${weaponIcon(w)}
            <div class="option__body"><span class="option__name">${esc(w.name)}</span>
            <span class="option__sub">${'★'.repeat(w.rarity)} · ${esc(w.typeName ?? resonator.weaponTypeName)}</span>
            <span class="option__sub">${esc(weaponStatsLine(w, 90))}</span></div>`,
    onPick,
  });
}
