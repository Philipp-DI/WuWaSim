"""
Damage-id -> animation-timing index, built by identity instead of by structure.

    python3 scan_bullet_timings.py <asset_root> [-o out.json]

WHY THIS EXISTS (and what it fixes about the DT_SkillInfo route)
  extract_timings.py joins by STRUCTURE: DT_SkillInfo row -> its Animations refs
  -> montage. That only works when a hit-map damage id decomposes into a known
  row id by prefix, which fails whenever a character's row-id scheme is unusual
  (Chixia's short ids) or nanoka's damage ids simply don't share a prefix with
  any row id (the stance-switch kits). ~19% of the roster's skillMap keys have
  no such decomposition and were left on fabricated defaults.

  This scanner joins by IDENTITY, following the link the game itself stores:

      montage notify  --子弹数据名-->  bullet id
      bullet table row --伤害ID/多伤害ID--> damage id   (== data/hit-map.json id)

  Phase 1 reads every TsAnimNotifyReSkillEvent_C notify object inside every
  montage; its `子弹数据名` ("bullet data name") field is the bullet the notify
  fires, and the notify's own trigger time is when it fires. Phase 2 reads every
  bullet table and records which damage ids each bullet row applies. Composing
  the two maps a damage id straight onto a real animation timeline -- no prefix
  arithmetic, no row table, nothing guessed.

  Verified on Baizhi (1103), whose four "unjoinable" keys all resolve through
  this chain: e.g. her intro damage id 1103160001 is applied by bullet
  11030160002 (a DIFFERENT number -- which is exactly why prefix matching could
  never have found it) fired by AM_QTE.

DETECTION IS BY CLASS, NOT BY FILENAME
  Montages are found via export[0].class == 'AnimMontage', pre-filtered only by
  a cheap byte test for the notify class name. An `AM_*` prefix filter would
  silently miss any differently-named montage -- the same shape of bug that made
  Chixia look absent from an export she was present in all along.

BULLET TABLES ARE AN EXPLICIT ALLOWLIST
  A full-roster export carries _Rogue/_Rouge/_MainLine variants of the bullet
  table for non-combat game modes, whose rows reuse the same id space with
  mode-specific numbers. Merging them would silently overwrite real timings, so
  they are excluded -- the same rule extract_timings.py applies to DT_SkillInfo.
"""
import argparse
import json
import os
import sys
from collections import defaultdict

from ue_asset import load
from ue_tagged import parse_datatable
from montage_timeline import montage_timeline

# --- phase 1: montages ----------------------------------------------------
# Fields naming a bullet, anywhere inside a notify object's properties. Three
# distinct notify classes fire bullets and each spells it differently:
#   TsAnimNotifyReSkillEvent_C        .子弹数据名               (a plain hit)
#   TsAnimNotifySkillBehavior_C       .技能行为[].SkillBehaviorActionGroup[]
#                                       .Bullets[].bulletRowName  (a gated hit)
#   TsAnimNotifyStateBulletDuration_C .BulletIds[]              (a sustained hit)
# The second is CONDITION-gated (SkillBehaviorConditionGroup), which is how
# alternate-form movesets are authored -- the same montage fires a different
# bullet depending on stance; reading only the first class is why the
# stance-switch kits (Denia/Lumi/Buling/Lucy) looked unreachable. The third
# holds a LIST, and covers held/channelled attacks (Baizhi's charged shot).
# Collection is recursive over every notify export and accepts a string or a
# list of strings, so a fourth spelling needs only an entry here. UNKNOWN_FIELD_HINT
# reports plausible-looking field names NOT in this list, so a future spelling
# surfaces in the report instead of silently becoming a coverage gap.
#   TsAnimNotifyReSkillEvent_C        .子弹id数组[]             (a multi-bullet hit)
BULLET_ID_FIELDS = ('子弹数据名', 'BulletDataName', 'bulletRowName', 'BulletIds',
                    '子弹id数组')
UNKNOWN_FIELD_HINT = ('bullet', 'Bullet', '子弹')
# Bullet-ish field names that are NOT bullet ids, checked and excluded on
# purpose so the tripwire reports only genuinely new spellings:
#   bulletName          -- TsAnimNotifyDestroySpecBullet_C DESTROYS a bullet;
#                          reading it would stamp a hit time on a despawn.
#   Bullets             -- the container whose members carry bulletRowName (read).
#   使用子弹id数组      -- a bool flag ("use the bullet id array"), not an id.
#   bulletCount, 子弹出生位置偏移, 子弹初速度偏移, 子弹数组Tag条件,
#   是否召唤子子弹, 立即销毁子弹特效 -- counts, offsets, flags.
IGNORED_BULLET_FIELDS = frozenset({
    'Bullets', 'bulletCount', 'bulletName', '使用子弹id数组', '子弹出生位置偏移',
    '子弹初速度偏移', '子弹数组Tag条件', '是否召唤子子弹', '立即销毁子弹特效',
})
# Notify-bearing animation assets. AnimSequence matters as much as AnimMontage:
# Mortefi's mid-air attacks live in AirAttack/AirAttack01_FR, a bare sequence,
# and an AnimMontage-only filter drops them. Both expose Notifies + SequenceLength,
# so montage_timeline() reads either unchanged.
ANIMATION_CLASSES = ('AnimMontage', 'AnimSequence')
NOTIFY_CLASS_PREFIXES = ('TsAnimNotify', 'AnimNotify')
# Cheap byte pre-filter, so only plausible assets get a full parse. The ASCII
# field names appear verbatim in the name table; Chinese ones are stored UTF-16LE.
PREFILTERS = tuple(
    field.encode('ascii') if field.isascii() else field.encode('utf-16-le')
    for field in BULLET_ID_FIELDS
)

# --- phase 2: bullet tables -----------------------------------------------
BULLET_TABLE_NAMES = {'DT_ReBulletDataMain.uasset', 'CDT_Bullet.uasset'}
# '伤害ID' = damage id, '多伤害ID' = multi damage id (a list). Both live nested
# inside the row's 基础设置 ("base settings") struct, and child-bullet configs
# repeat them, so the search is recursive over the whole row.
DAMAGE_ID_FIELDS = ('伤害ID', '多伤害ID')
# '子子弹设置[].召唤子弹ID' = "child bullet settings[].summon bullet id". A montage
# often fires a carrier bullet that deals no damage itself and spawns the one
# that does -- e.g. Encore's AM_Attack01 fires 1203600101 ("basic attack 1 --
# ground-detection bullet", damage id none), whose child 1203600001 ("basic
# attack 1") is the hit-map id. Resolving damage ids therefore needs the
# transitive closure over this edge, not just the row's own fields.
CHILD_BULLET_FIELDS = ('召唤子弹ID',)
# '子弹名称' = the designer's own label for the bullet ("安可普攻1正式" = "Encore
# basic attack 1, final"). Carries no timing, but it is the single most useful
# field for triaging a damage id that has no montage: it says in the game's own
# words whether the thing is a player swing or a turret/field tick.
BULLET_NAME_FIELD = '子弹名称'


def norm(name):
    return (name or '').removesuffix('_C')


def collect_bullet_ids(node, out, unknown=None):
    """Recursively pull every bullet-id field value out of a notify's properties.

    `unknown` collects field names that LOOK like they name a bullet but are not
    in BULLET_ID_FIELDS -- a tripwire, so a spelling we have not seen shows up in
    the report rather than silently reducing coverage.
    """
    if isinstance(node, dict):
        for key, value in node.items():
            if key in BULLET_ID_FIELDS:
                if isinstance(value, str) and value.strip():
                    out.add(value.strip())
                elif isinstance(value, list):
                    out.update(v.strip() for v in value
                               if isinstance(v, str) and v.strip())
            elif (unknown is not None and key not in IGNORED_BULLET_FIELDS
                    and any(h in key for h in UNKNOWN_FIELD_HINT)):
                unknown.add(key)
            collect_bullet_ids(value, out, unknown)
    elif isinstance(node, list):
        for value in node:
            collect_bullet_ids(value, out, unknown)


def bullet_ids_by_export(asset, unknown=None):
    """export index -> {bullet id, ...}, for every notify object in the package."""
    out = {}
    for k, exp in enumerate(asset.exports):
        if not norm(exp['class'] or '').startswith(NOTIFY_CLASS_PREFIXES):
            continue
        try:
            props, _, _ = asset.read_export(k)
        except Exception:
            continue
        found = set()
        collect_bullet_ids(props, found, unknown)
        if found:
            out[k] = found
    return out


def scan_animation(uasset, uexp, unknown=None):
    """-> (timeline, [(bullet_id, fire_time_s), ...]) or None if not applicable."""
    asset = load(uasset, uexp)
    if not asset.exports or norm(asset.exports[0]['class']) not in ANIMATION_CLASSES:
        return None
    ids_by_export = bullet_ids_by_export(asset, unknown)
    if not ids_by_export:
        return None

    props, _, _ = asset.read_export(0)
    fires = []
    for ev in props.get('Notifies', []) or []:
        if not isinstance(ev, dict):
            continue
        # FPackageIndex: a positive value means export[value - 1]. Instant
        # notifies carry the object in Notify, state notifies in NotifyStateClass.
        for field in ('Notify', 'NotifyStateClass'):
            objref = (ev.get(field) or {}).get('__objref') or 0
            if objref <= 0:
                continue
            for bullet_id in sorted(ids_by_export.get(objref - 1, ())):
                t = (ev.get('LinkValue') or 0.0) + (ev.get('TriggerTimeOffset') or 0.0)
                fires.append((bullet_id, round(t, 4)))
    if not fires:
        return None
    return montage_timeline(uasset, uexp), fires


def collect_ids(node, fields, out):
    """Recursively pull every value of the named int/int-list fields out of a row."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in fields:
                if isinstance(value, int) and value:
                    out.add(str(value))
                elif isinstance(value, list):
                    out.update(str(v) for v in value if isinstance(v, int) and v)
            collect_ids(value, fields, out)
    elif isinstance(node, list):
        for value in node:
            collect_ids(value, fields, out)


def close_over_children(direct_damage, children):
    """bullet -> every damage id reachable through its child-bullet chain.

    Iterative with an explicit stack and a visited set: child configs can point
    back at an ancestor (a bullet that re-summons its own carrier), so a naive
    recursive walk would not terminate.
    """
    effective = {}
    for bullet_id in set(direct_damage) | set(children):
        found, seen, stack = set(), {bullet_id}, [bullet_id]
        while stack:
            current = stack.pop()
            found |= direct_damage.get(current, set())
            for child in children.get(current, ()):
                if child not in seen:
                    seen.add(child)
                    stack.append(child)
        if found:
            effective[bullet_id] = found
    return effective


def scan(root, verbose=True):
    montages = defaultdict(list)      # bullet id -> [timing source, ...]
    montage_meta = {}                 # montage rel path -> per-ANIMATION facts
    direct_damage = defaultdict(set)  # bullet id -> {damage id it applies itself}
    children = defaultdict(set)       # bullet id -> {child bullet id it summons}
    names = {}                        # bullet id -> designer label
    unknown_fields = set()            # tripwire: bullet-ish field names not read
    errors = []
    scanned = candidates = montage_count = table_count = 0

    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if not fn.endswith('.uasset'):
                continue
            full = os.path.join(dirpath, fn)
            uexp = full[:-len('.uasset')] + '.uexp'
            if not os.path.exists(uexp):
                continue
            rel = os.path.relpath(full, root).replace('\\', '/')

            if fn in BULLET_TABLE_NAMES:
                table_count += 1
                try:
                    _pkg, _obj, _n, rows, _end = parse_datatable(full, uexp)
                except Exception as ex:
                    errors.append({'file': rel, 'phase': 'bullet-table',
                                   'error': str(ex)[:140]})
                    continue
                for bullet_id, row in rows.items():
                    label = row.get(BULLET_NAME_FIELD)
                    if isinstance(label, str) and label.strip():
                        names.setdefault(str(bullet_id), label.strip())
                    damage_ids, child_ids = set(), set()
                    collect_ids(row, DAMAGE_ID_FIELDS, damage_ids)
                    collect_ids(row, CHILD_BULLET_FIELDS, child_ids)
                    # A row with neither is inert; keeping it would only pad the
                    # index. A row with only children is NOT inert -- it is the
                    # carrier case the closure exists for.
                    if damage_ids:
                        direct_damage[str(bullet_id)] |= damage_ids
                    if child_ids:
                        children[str(bullet_id)] |= child_ids
                continue

            scanned += 1
            try:
                blob = open(full, 'rb').read()
            except OSError as ex:
                errors.append({'file': rel, 'phase': 'read', 'error': str(ex)[:140]})
                continue
            if not any(needle in blob for needle in PREFILTERS):
                continue
            candidates += 1
            try:
                res = scan_animation(full, uexp, unknown_fields)
            except Exception as ex:
                errors.append({'file': rel, 'phase': 'montage', 'error': str(ex)[:140]})
                continue
            if not res:
                continue
            montage_count += 1
            timeline, fires = res
            derived = timeline['derived']
            # Facts that belong to the ANIMATION, not to one bullet fire.
            # Stored once per montage rather than repeated on every source
            # record -- gameplay_tags on ~2,200 montages x their bullet fires
            # would multiply the artifact several times over for no new data.
            if derived['gameplay_tags']:
                montage_meta[rel] = {'gameplay_tags': derived['gameplay_tags']}
            for bullet_id, fire_time in fires:
                montages[bullet_id].append({
                    'montage': rel,
                    'asset': timeline['asset'],
                    'fire_time_s': fire_time,
                    'actionable_at_s': derived['actionable_at_s'],
                    'cancel_window_opens_s': derived['cancel_window_opens_s'],
                    'cancel_window_dur_s': derived['cancel_window_dur_s'],
                    'skill_end_s': derived['skill_end_s'],
                    'idle_return_s': derived['idle_return_s'],
                    'is_phase': derived['is_phase'],
                    'freeze_total_s': derived['freeze_total_s'],
                    'freeze_combat_clock_s': derived['freeze_combat_clock_s'],
                    'hit_times_s': derived['hit_times_s'],
                    'hit_count': derived['hit_count'],
                    'sequence_length_s': timeline['sequence_length_s'],
                })
            if verbose and montage_count % 300 == 0:
                print(f'  ... {montage_count} montages, {len(montages)} bullets',
                      file=sys.stderr)

    bullets = close_over_children(direct_damage, children)
    damage_ids = set()
    for ids in bullets.values():
        damage_ids |= ids
    if verbose:
        print(f'[scan] {scanned} .uasset | {candidates} montage candidates | '
              f'{montage_count} montages firing {len(montages)} bullets | '
              f'{table_count} bullet tables -> {len(bullets)} bullets '
              f'({len(children)} with children), {len(damage_ids)} damage ids',
              file=sys.stderr)

    return {
        '_meta': {
            'asset_root': os.path.abspath(root),
            'assets_scanned': scanned,
            'prefilter_candidates': candidates,
            'montages_firing_bullets': montage_count,
            'bullet_tables_parsed': table_count,
            'bullets_with_timing': len(montages),
            'bullets_with_damage_ids': len(bullets),
            'bullets_with_children': len(children),
            'distinct_damage_ids': len(damage_ids),
            'montages_with_gameplay_tags': len(montage_meta),
            'chain': 'montage notify (子弹数据名 | bulletRowName) -> bullet id -> bullet row '
                     '伤害ID/多伤害ID, transitively through 子子弹设置.召唤子弹ID -> damage id',
            'bulletIdFields': list(BULLET_ID_FIELDS),
            'unreadBulletLikeFields': sorted(unknown_fields),
            'bullet_tables': sorted(BULLET_TABLE_NAMES),
            'errors': errors,
        },
        # bullet id -> every damage id it applies, itself or via a child bullet
        'bulletDamageIds': {k: sorted(v) for k, v in sorted(bullets.items())},
        # bullet id -> the child bullets it summons (provenance for the closure)
        'bulletChildren': {k: sorted(v) for k, v in sorted(children.items())},
        # bullet id -> the designer's own label, for triaging gaps by hand
        'bulletNames': dict(sorted(names.items())),
        # bullet id -> every montage that fires it, with that montage's timeline
        'bulletTimings': {k: v for k, v in sorted(montages.items())},
        # montage rel path -> facts that describe the ANIMATION rather than any
        # one bullet it fires. gameplay_tags carries the authored switch
        # behaviour (切人结束技能 "switching ends the skill", 不能切人 "cannot
        # switch out"), which is a WINDOW with its own start and duration, not a
        # property of the whole montage.
        'montageMeta': dict(sorted(montage_meta.items())),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('-o', '--out', default='bullet-timings.json')
    a = ap.parse_args()
    res = scan(a.root)
    json.dump(res, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"wrote {a.out}", file=sys.stderr)


if __name__ == '__main__':
    main()
