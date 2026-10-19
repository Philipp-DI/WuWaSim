# History — .claude/rules/invariants-effects.md

## "The incoming Resonator gains …" is the OUTRO lane's, and the second copy is MARKED not dropped

### 2026-10-19 — Outro-node copies no longer emitted; Suoming's two are distinct grants

At 3.7 the skill-node pass stopped reading an Outro node whose grants `outroBuffs` carries, which removed the SN copies of Iuno, Qiuyuan, Lynae, Zani, Yangyang: Xuanling and Hsin, and Suoming added two incoming clauses with no `outroBuffs` twin. The row's full Detail text before this change, verbatim:

An Outro Skill's grant goes to the member switching IN and `outroBuffs` already carries it, but the same sentence also reaches the ordinary effect parser, which knew only "the wielder" or "the team" — so it emitted a SECOND copy as a SELF buff. Measured: exactly **4 clauses** on the roster say this (Iuno, Qiuyuan, Lynae ×2) and every one is already in its own `outroBuffs` at the same value and the same 14s; none is a distinct grant. None was paying, but three were LATENT: Iuno's trigger fires and its window opens, with only a dead scope stopping it, so repairing that scope would have switched on a 50% self-amplify. `effects.mjs` stamps `recipient: 'incoming'` (`INCOMING_RECIPIENT_RE`) and `resolveChainInherentContext` skips it. **MARKED, NEVER DROPPED** — deleting an effect changes its node's effect COUNT and re-slots every `S{level}.{index}` after it, and Lynae carries a curated override at `S3.1` directly after one of these at `S2.1`. `tests/dead-scope.test.mjs` exempts the flag for the same reason it exempts `teamWide`: the WIELDER'S kit is the wrong kit to ask of a buff paid to someone else

