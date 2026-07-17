// eslint.config.js — S2.2 guardrails (docs/SIMPLIFICATION-PLAN.md).
//
// `recommended` correctness rules run as ERRORS (CI fails on them). The
// code-style rules that encode CLAUDE.md's naming/size goals enter as
// WARNINGS — the codebase predates them — and get ratcheted to errors
// per-directory as the S3 rename pass and S4 splits clean each area.
import js from '@eslint/js';
import globals from 'globals';

const ID_LENGTH_OPTIONS = {
    min: 3,
    exceptions: ['i', 'j', 'k', 'x', 'y', 'id', 'el', 'on', '_'],
    properties: 'never',
};

export default [
    { ignores: ['.venv/', 'assets/', 'data/', 'docs-local/', 'templates/'] },
    js.configs.recommended,
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            // Modules run in both the browser and Node (tests/tools), so
            // both global sets are legal; the sim core should use neither.
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            // CLAUDE.md CODE STYLE — NAMING. Sanctioned short names only.
            'id-length': ['warn', ID_LENGTH_OPTIONS],
            'max-lines-per-function': ['warn', { max: 80, skipComments: true }],
            complexity: ['warn', 12],
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                // `const { unwanted, ...rest } = obj` — destructure-to-omit;
                // the "unused" binding is what keeps it out of `rest`.
                ignoreRestSiblings: true,
                destructuredArrayIgnorePattern: '^_',
                caughtErrors: 'none',
            }],
            // preprocess.mjs legitimately strips control characters from
            // localization text; the accident this rule guards against is a
            // deliberate pattern here.
            'no-control-regex': 'off',
            // `catch {}` around browser APIs that throw on some engines
            // (e.g. dataTransfer.setData) is an intentional swallow.
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    // Ratchet (SIMPLIFICATION-PLAN §S2.2): directories the S3 naming pass has
    // cleaned enforce the naming convention as an ERROR — regressions fail CI.
    {
        files: ['src/core/**/*.js', 'src/data/**/*.js', 'tools/**/*.js', 'tools/**/*.mjs'],
        rules: {
            'id-length': ['error', ID_LENGTH_OPTIONS],
        },
    },
];
