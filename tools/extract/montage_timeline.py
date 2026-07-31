"""
Extract a combat timeline from a cooked UE AnimMontage.

Trigger time for a notify = LinkValue + TriggerTimeOffset (Absolute link
method). Notify *states* additionally carry a Duration, so they describe a
window [t, t+Duration] rather than an instant.

WuWa's notify vocabulary (TypeScript-generated classes, Ts* prefix):
  TsAnimNotifyStateAbsoluteTimeStop  - hard freeze window (burst lock)
  TsAnimNotifyStateTimeStopRequest   - requested/soft time stop
  TsAnimNotifyStateNextAtt           - "next attack" input/cancel window
  TsAnimNotifyEndSkill               - skill terminates here
  TsAnimNotifyStateBurst             - burst state span
  TsAnimNotifyAddBuff                - buff application instant
  TsAnimNotifySwitchSequenceCamera   - cinematic camera swap
  TsAnimNotifyStateChangeSlot        - weapon/slot swap window
"""
import json
import sys
from ue_asset import load

# Semantic grouping for the fields that matter to a rotation sim.
ROLE = {
    'TsAnimNotifyStateAbsoluteTimeStop_C': 'freeze',
    'TsAnimNotifyStateAbsoluteTimeStop':   'freeze',
    'TsAnimNotifyStateTimeStopRequest_C':  'freeze_request',
    'TsAnimNotifyStateTimeStopRequest':    'freeze_request',
    'TsAnimNotifyStateNextAtt_C':          'cancel_window',
    'TsAnimNotifyStateNextAtt':            'cancel_window',
    'TsAnimNotifyEndSkill_C':              'skill_end',
    'TsAnimNotifyEndSkill':                'skill_end',
    'TsAnimNotifyStateBurst_C':            'burst_state',
    'TsAnimNotifyStateBurst':              'burst_state',
    'TsAnimNotifyAddBuff_C':               'add_buff',
    'TsAnimNotifyAddBuff':                 'add_buff',
    'TsAnimNotifySwitchSequenceCamera_C':  'camera',
    'TsAnimNotifySwitchSequenceCamera':    'camera',
    # identified from Rebecca's montages:
    'TsAnimNotifyReSkillEvent':            'hit',
    'TsAnimNotifySkillBehavior':           'skill_behavior',
    'TsAnimNotifyStateSoftLock':           'soft_lock',
    # ChangeSlot's MECHANISM is cosmetic -- 切换组件到指定插槽 ("switch component to
    # specified socket"), body calls SetSubMeshAttach / K2_AttachToComponent to
    # re-parent a weapon mesh to a bone. But it is a faithful SIGNAL of a weapon
    # /stance change, which is what we actually need: Rebecca's two Intro
    # montages target different props (AM_QTE_M -> WeaponProp01 pistol,
    # AM_QTE_S -> WeaponProp02 shotgun), matching the Huntress/Guts split we had
    # to pin by bullet label. Kept as a first-class event, not filtered as
    # cosmetic -- its ComponentName/SwitchToSlotName ride along in `props`.
    'TsAnimNotifyChangeSlot':              'weapon_slot',
    'TsAnimNotifyChangeSlot_C':            'weapon_slot',
    'TsAnimNotifyStateChangeSlot':         'weapon_slot',
    'TsAnimNotifyStateChangeSlot_C':       'weapon_slot',
    # The gameplay-tag layer -- the game's own state tracking, and the authored
    # answer to what an animation commits you to. Real windows with durations:
    #   角色.Common.BUFF通用标识.不能切人   cannot switch out          (94)
    #   ...状态标识.切人结束技能            switching ENDS the skill   (4, Camellya)
    #   行为状态.逻辑状态.禁止移动打断技能   movement cannot interrupt  (26)
    #   功能.逻辑状态标识.霸体              super armour               (8)
    #   功能.逻辑状态标识.无敌.通用无敌      invincibility frames       (204)
    #   功能.功能制作.禁止体力恢复...        stamina regen blocked      (211)
    # This is why Lupa's Dance With the Wolf survives a swap and Camellya's
    # 20-hit AM_Attack04 does not: it is authored per move, not a global rule.
    # Many per-character state tags are hash-obfuscated (角色.3130d70d....) --
    # distinguishable (same hash = same state) but not readable.
    'TsAnimNotifyAddTag':                  'gameplay_tag',
    'TsAnimNotifyAddTag_C':                'gameplay_tag',
    'TsAnimNotifyStateAddTag':             'gameplay_tag',
    'TsAnimNotifyStateAddTag_C':           'gameplay_tag',
    'TsAnimNotifyChangeSkillPriority':     'priority_change',
    'TsAnimNotifyChangeSkillPriority_C':   'priority_change',
    'TsAnimNotifyBreakPoint':              'break_point',
    'TsAnimNotifyBreakPoint_C':            'break_point',
    'TsAnimNotifyStateSkillBehavior':      'skill_behavior',
    'TsAnimNotifyStateSkillBehavior_C':    'skill_behavior',
    'TsAnimNotifyStatePositionBranchTarget': 'branch_target',
    'TsAnimNotifyFightStand':              'idle_return',
}
# Cosmetic-only notifies, excluded from the timeline summary by default.
COSMETIC = {'TsAnimNotifyAudioEvent', 'TsAnimNotifyStateAudioEvent',
            'TsAnimNotifyControllerShake', 'TsAnimNotifyWeaponHide',
            'TsAnimNotifyStateSubMeshControl', 'TsAnimNotifyStateSceneInteract',
            'TsAnimNotifyStateControllerShake', 'TsAnimNotifyStateCameraShake',
            'TsAnimNotifyCameraShake', 'TsAnimNotifyCameraModify',
            'TsAnimNotifyStateCameraModify', 'TsAnimNotifyStateRotate'}


def norm(name):
    return (name or '').removesuffix('_C')


# Whether a freeze notify stops the PLAYER's combat clock, which is the only
# kind the sim's freeze model represents (gameTime pauses -> cooldowns and buff
# durations stop, DPS denominator excludes the window).
#
# Maintainer verified in-game (2026-07-29) that WuWa has TWO freezes:
#   MAJOR - a complete stop: timers, buffs, cooldowns, enemy actions. Liberations
#           and the Tune Break trigger ("Execute") animations.
#   minor - enemy actions/movement only, very brief; the player's own clock keeps
#           running. Intro Skills.
# WHICH NOTIFY IS WHICH -- settled from the game's own shipped JavaScript
# (Content/Aki/JavaScript/Game/AnimNotifyState/*.js in a full client export).
# Each notify's GetNotifyName() states its effect outright:
#
#   TsAnimNotifyStateTimeStopRequest  -> "副本计时和所有战斗单位buff、技能冷却冻结"
#        "instance timer and ALL combat units' buffs and skill cooldowns freeze"
#        == exactly the sim's freeze semantics. THIS is the freeze we model.
#
#   TsAnimNotifyStateAbsoluteTimeStop -> "动画和子弹冻结"
#        "animation and bullet freeze" -- a visual/local hold of the owner's
#        animation and its bullets. It does NOT stop timers, buffs or cooldowns,
#        so it must contribute ZERO sim freeze.
#
# This also closes an earlier false lead: AbsoluteTimeStop declares
# 角色战斗机制停止 / 怪物战斗机制停止 / 副本计时停止 (defaulting true/true/false),
# and those looked like the discriminator -- but its K2_NotifyBegin passes ONLY
# 是否冻结移动效果 to SkillUtils.BeginAbsoluteTimeStop. The other three are never
# read. They are dead properties, which is why classifying on them matched most
# observations and then failed on Aemeath.
FREEZE_NOTIFY_CLASSES = ('TsAnimNotifyStateAbsoluteTimeStop',
                         'TsAnimNotifyStateTimeStopRequest')


# Per-notify properties worth carrying into the timeline. A notify's own fields
# live in a SEPARATE export, referenced by the timeline entry's Notify /
# NotifyStateClass objref -- the same indirection scan_bullet_timings.py follows
# to reach bullet ids. Only these are kept; the rest would bloat every montage.
#
# `Priority` (TsAnimNotifyChangeSkillPriority) is the important one: its
# GetNotifyName is 修改技能优先级 and its body calls SetSkillPriority(mainSkill,
# Priority), so it is the authored interrupt ranking CHANGING mid-animation.
# Together with DT_SkillInfo.InterruptLevel it is how the game decides whether an
# incoming action cancels the current one -- the mechanic that
# TsAnimNotifyStateSoftLock was wrongly assumed to carry (that one is
# 开启镜头软锁, camera lock-on, and is gameplay-irrelevant).
CARRIED_PROPS = ('Priority', 'BuffId', 'BuffIds', 'TagName', 'Tag',
                 'SwitchToSlotName', 'ComponentName', 'Action', '技能行为')


def _notify_props(asset, ev):
    """The notify object's own properties, resolved through its objref."""
    for field in ('Notify', 'NotifyStateClass'):
        objref = (ev.get(field) or {}).get('__objref') or 0
        if objref <= 0:
            continue
        try:
            props, _, _ = asset.read_export(objref - 1)
        except Exception:
            return {}
        return {k: v for k, v in props.items() if k in CARRIED_PROPS}
    return {}


def _section_of(time_s, sections):
    """Name of the CompositeSection a timestamp falls in, or None."""
    hit = None
    for sec in sections:
        if sec['start_s'] <= time_s + 1e-6 and (hit is None or sec['start_s'] > hit['start_s']):
            hit = sec
    return hit['name'] if hit else None


def montage_timeline(uasset, uexp, include_cosmetic=False):
    a = load(uasset, uexp)
    props, _, _ = a.read_export(0)

    raw_sections = []
    for s in props.get('CompositeSections', []) or []:
        if isinstance(s, dict):
            raw_sections.append({
                'name': s.get('SectionName'),
                'next': s.get('NextSectionName'),
                'start_s': round((s.get('LinkValue') or 0.0), 4),
                'segment_length_s': round((s.get('SegmentLength') or 0.0), 4),
            })
    raw_sections.sort(key=lambda x: x['start_s'])

    events = []
    for ev in props.get('Notifies', []) or []:
        if not isinstance(ev, dict):
            continue
        raw = ev.get('NotifyName')
        base = norm(raw)
        cosmetic = base in COSMETIC
        if not include_cosmetic and cosmetic:
            continue
        t = (ev.get('LinkValue') or 0.0) + (ev.get('TriggerTimeOffset') or 0.0)
        dur = ev.get('Duration') or 0.0
        entry = {
            'notify': base,
            'role': ROLE.get(raw, ROLE.get(base, 'other')),
            'time_s': round(t, 4),
            'duration_s': round(dur, 4),
            'end_s': round(t + dur, 4) if dur else None,
            'is_state': bool(ev.get('NotifyStateClass', {}).get('__objref')),
            'track': ev.get('TrackIndex'),
            # A montage asset can hold SEVERAL playable segments. Notifies from a
            # later section are NOT part of the section the action plays, so a
            # flattened timeline invents late "hits" that never occur in the move
            # (Qiuyuan's basic_1: one real hit, plus one 0.6s after its own
            # EndSkill). Tagging every event lets derive() scope to one section.
            'section': _section_of(t, raw_sections),
        }
        carried = _notify_props(a, ev)
        if carried:
            entry['props'] = carried
        events.append(entry)
    events.sort(key=lambda e: (e['time_s'], e['notify']))

    sections = raw_sections

    seq_len = props.get('SequenceLength')
    rate = props.get('RateScale', 1.0) or 1.0
    return {
        'asset': uasset.split('/')[-1].replace('.uasset', ''),
        'sequence_length_s': seq_len,
        'rate_scale': rate,
        'effective_length_s': round(seq_len / rate, 4) if seq_len else None,
        'blend_in_s': (props.get('BlendIn') or {}).get('BlendTime'),
        'blend_out_s': (props.get('BlendOut') or {}).get('BlendTime'),
        'sections': sections,
        'events': events,
        'derived': derive(events, seq_len, sections),
    }


def derive(events, seq_len, sections=None):
    """Reduce the raw notify list to the numbers a rotation sim needs.

    NOT scoped by section, deliberately. A montage's CompositeSections are
    usually SEQUENTIAL PHASES of one continuous action, not alternative
    variants: Electro Rover's AM_Skill02_Wind_G_Long (a hold skill) splits into
    Default (wind-up) / "1" (hold) / "2" (release), with the cancel window in
    section 1 and EndSkill in section 2. Restricting to the first section threw
    both away and dropped that key onto the sequenceLength fallback.
    Section membership is still tagged per event and reported below, because it
    is real structure worth seeing -- it just must not gate the derivation.

    (This was tried as an explanation for phantom late "hits" and is not one.
    Qiuyuan's basic_1 has a SINGLE section; its 1.0s extra ReSkillEvent fires
    bullet 1411001000 "普攻-目押判定", a just-frame input detector carrying no
    damage ids. The fix for that is damageAt in map-timings.mjs -- filter by
    which bullet the notify fires, not by where it sits.)
    """
    sections = sections or []
    scoped = events

    def first(role):
        return next((e for e in scoped if e['role'] == role), None)

    freeze = [e for e in scoped if e['role'] in ('freeze', 'freeze_request')]
    cancel = first('cancel_window')
    end = first('skill_end')
    idle = first('idle_return')
    buffs = [e for e in scoped if e['role'] == 'add_buff']

    # Freeze windows overlap (AbsoluteTimeStop and TimeStopRequest describe the
    # same span), so take the UNION, never the sum.
    def union_seconds(windows):
        spans = sorted((e['time_s'], e['time_s'] + e['duration_s']) for e in windows)
        merged = []
        for a_, b_ in spans:
            if merged and a_ <= merged[-1][1] + 1e-6:
                merged[-1][1] = max(merged[-1][1], b_)
            else:
                merged.append([a_, b_])
        return round(sum(b_ - a_ for a_, b_ in merged), 4)

    total_freeze = union_seconds(freeze)
    # The ONLY freeze the sim models: TimeStopRequest windows, which the game
    # itself describes as freezing the instance timer plus every combat unit's
    # buffs and skill cooldowns. AbsoluteTimeStop ("animation and bullet freeze")
    # is deliberately excluded — it holds the animation, not the clock.
    combat_clock = union_seconds([e for e in freeze if e['role'] == 'freeze_request'])
    out = {
        'freeze_total_s': total_freeze or None,
        'freeze_combat_clock_s': combat_clock or None,
        'freeze_windows': [{'start': e['time_s'], 'dur': e['duration_s'],
                            'kind': e['role'],
                            'stopsCombatClock': e['role'] == 'freeze_request'}
                           for e in freeze] or None,
        'cancel_window_opens_s': cancel['time_s'] if cancel else None,
        'cancel_window_dur_s': cancel['duration_s'] if cancel else None,
        'skill_end_s': end['time_s'] if end else None,
        'idle_return_s': idle['time_s'] if idle else None,
        'buff_applied_s': [e['time_s'] for e in buffs] or None,
        'hit_times_s': [e['time_s'] for e in scoped if e['role'] == 'hit'] or None,
        'hit_count': sum(1 for e in scoped if e['role'] == 'hit'),
        # -- Commitment / interrupt model. ChangeSkillPriority rewrites the
        #    skill's interrupt ranking mid-animation (SetSkillPriority), so this
        #    is the authored "how cancellable am I right now" curve. Pairs with
        #    DT_SkillInfo.InterruptLevel, which is its starting value.
        'priority_changes': [{'t': e['time_s'], 'priority': (e.get('props') or {}).get('Priority')}
                             for e in scoped if e['role'] == 'priority_change'] or None,
        # -- Input-buffer flush points. TsAnimNotifyBreakPoint's own name is
        #    "打断点（强制执行一次按键缓存检测）" -- force one key-cache check --
        #    and NextAtt calls the same CallAnimBreakPoint() when its window
        #    opens. This is where a queued input actually executes.
        'break_points_s': [e['time_s'] for e in scoped if e['role'] == 'break_point'] or None,
        # -- Section geometry, so a consumer can tell a single-segment montage
        #    from one that packs several actions into one asset.
        'gameplay_tags': [{'t': e['time_s'], 'dur': e['duration_s'],
                           'tag': ((e.get('props') or {}).get('Tag') or {}).get('TagName')
                                  if isinstance((e.get('props') or {}).get('Tag'), dict)
                                  else (e.get('props') or {}).get('TagName')}
                          for e in scoped if e['role'] == 'gameplay_tag'] or None,
        'weapon_slots': [{'t': e['time_s'], 'dur': e['duration_s'],
                          'component': (e.get('props') or {}).get('ComponentName'),
                          'slot': (e.get('props') or {}).get('SwitchToSlotName')}
                         for e in scoped if e['role'] == 'weapon_slot'] or None,
        'section_count': len(sections),
        'section_names': [x['name'] for x in sections] or None,
        'events_outside_first_section': (len(events) - len(scoped)) or None,
    }
    # A montage with NEITHER a cancel window nor a skill-end notify never gives
    # the player control back, so it cannot be where the action completes: it is
    # one PHASE of a multi-montage action (an uncancellable wind-up that chains
    # into a follow-up montage). The distinction matters downstream -- a phase's
    # length is a lead-in to add, not an actionable time to report.
    out['is_phase'] = (out['cancel_window_opens_s'] is None
                       and out['skill_end_s'] is None)
    # Actionable = when the player regains control: the cancel window opening,
    # else the skill-end notify, else where the idle-return tail starts
    # (TsAnimNotifyFightStand -- everything after it is settle-back animation,
    # so sequence_length overshoots), else the full length. That last fallback
    # is only correct for a phase montage, which has no idle-return tail at all
    # because it chains straight into the next montage.
    out['actionable_at_s'] = (out['cancel_window_opens_s']
                              if out['cancel_window_opens_s'] is not None
                              else out['skill_end_s']
                              if out['skill_end_s'] is not None
                              else out['idle_return_s']
                              if out['idle_return_s'] is not None else seq_len)
    return out


if __name__ == '__main__':
    paths = sys.argv[1:]
    results = []
    for p in paths:
        base = p.removesuffix('.uasset').removesuffix('.uexp')
        results.append(montage_timeline(base + '.uasset', base + '.uexp'))
    print(json.dumps(results, ensure_ascii=False, indent=2))
