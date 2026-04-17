import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";
import prettierPlugin from "eslint-config-prettier";

export default [
  js.configs.recommended,
  sonarjs.configs.recommended,
  unicorn.configs.recommended,
  jsdoc.configs["flat/recommended"],
  prettierPlugin,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      "no-console": "warn",
      "eqeqeq": "error",
      "complexity": ["warn", { "max": 15 }],
      "unicorn/prevent-abbreviations": "off",
      "unicorn/prefer-module": "off",
      "unicorn/no-null": "off",
      "unicorn/filename-case": "off",
      "jsdoc/require-jsdoc": "warn",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns-description": "off",
      "sonarjs/cognitive-complexity": ["warn", 15]
    }
  }
];
