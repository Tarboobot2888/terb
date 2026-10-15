// ═══════════════════════════════════════════════
// ESLint (flat config) — `npm run lint`
// ───────────────────────────────────────────────
// قواعد الصحة فقط (أخطاء حقيقية: متغير غير معرّف، مفتاح مكرر، كود لا يُصل إليه، مقارنة خاطئة…)
// بلا قواعد أسلوب: 900+ بلوقن بأساليب متعددة لا يُعاد تنسيقها.
// ═══════════════════════════════════════════════

import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "session/**", "tmp/**", "temp/**", "downloads/**", "backup/**", "coverage/**"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // متصفح للقراءة فقط: دوال page.evaluate في Puppeteer تعمل داخل المتصفح (document/location)
      globals: { ...globals.node, ...globals.es2024, ...Object.fromEntries(Object.keys(globals.browser).map((k) => [k, "readonly"])), ...Object.fromEntries(Object.keys(globals.node).map((k) => [k, globals.node[k]])) },
    },
    rules: {
      ...js.configs.recommended.rules,
      // ضوضاء أسلوبية/تاريخية في البلوقنات — ليست أخطاء تشغيل
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
      "no-prototype-builtins": "off",
      "no-async-promise-executor": "off",
      "no-case-declarations": "off",
      "no-inner-declarations": "off",
      "no-irregular-whitespace": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "no-unassigned-vars": "off",
      // try { … } catch (e) { throw e } لا يغيّر السلوك
      "no-useless-catch": "off",
    },
  },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs", globals: { ...globals.node } } },
];
