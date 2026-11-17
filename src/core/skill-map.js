// The one place that picks a resonator's skill map. Curated (skill-map.json,
// injected as dataset.skillMap) wins when it has any non-`_` key; the
// auto-generated map (dataset.autoSkillMap) is the fallback. Returns null when
// neither has entries. A leaf module: sim.js, skill.js and triggerability.js
// import it, so it must import nothing from them.
export function effectiveSkillMap(dataset, resonatorId) {
    const curated = dataset?.skillMap?.[String(resonatorId)];
    if (curated && Object.keys(curated).some(key => !key.startsWith('_'))) return curated;
    const auto = dataset?.autoSkillMap?.[String(resonatorId)];
    if (auto && Object.keys(auto).length > 0) return auto;
    return null;
}
