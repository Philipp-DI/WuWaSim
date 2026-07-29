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
    'TsAnimNotifyStateChangeSlot_C':       'slot_change',
    'TsAnimNotifyStateChangeSlot':         'slot_change',
    'TsAnimNotifySwitchSequenceCamera_C':  'camera',
    'TsAnimNotifySwitchSequenceCamera':    'camera',
    # identified from Rebecca's montages:
    'TsAnimNotifyReSkillEvent':            'hit',
    'TsAnimNotifySkillBehavior':           'skill_behavior',
    'TsAnimNotifyStateSoftLock':           'soft_lock',
    'TsAnimNotifyChangeSkillPriority':     'priority_change',
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


def montage_timeline(uasset, uexp, include_cosmetic=False):
    a = load(uasset, uexp)
    props, _, _ = a.read_export(0)

    events = []
    for ev in props.get('Notifies', []) or []:
        if not isinstance(ev, dict):
            continue
        raw = ev.get('NotifyName')
        base = norm(raw)
        if not include_cosmetic and base in COSMETIC:
            continue
        t = (ev.get('LinkValue') or 0.0) + (ev.get('TriggerTimeOffset') or 0.0)
        dur = ev.get('Duration') or 0.0
        events.append({
            'notify': base,
            'role': ROLE.get(raw, ROLE.get(base, 'other')),
            'time_s': round(t, 4),
            'duration_s': round(dur, 4),
            'end_s': round(t + dur, 4) if dur else None,
            'is_state': bool(ev.get('NotifyStateClass', {}).get('__objref')),
            'track': ev.get('TrackIndex'),
        })
    events.sort(key=lambda e: (e['time_s'], e['notify']))

    sections = []
    for s in props.get('CompositeSections', []) or []:
        if isinstance(s, dict):
            sections.append({
                'name': s.get('SectionName'),
                'next': s.get('NextSectionName'),
                'start_s': round((s.get('LinkValue') or 0.0), 4),
                'segment_length_s': round((s.get('SegmentLength') or 0.0), 4),
            })

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
        'derived': derive(events, seq_len),
    }


def derive(events, seq_len):
    """Reduce the raw notify list to the numbers a rotation sim needs."""
    def first(role):
        return next((e for e in events if e['role'] == role), None)

    freeze = [e for e in events if e['role'] in ('freeze', 'freeze_request')]
    cancel = first('cancel_window')
    end = first('skill_end')
    idle = first('idle_return')
    buffs = [e for e in events if e['role'] == 'add_buff']

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
        'hit_times_s': [e['time_s'] for e in events if e['role'] == 'hit'] or None,
        'hit_count': sum(1 for e in events if e['role'] == 'hit'),
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
