import eslintPluginPrettier from "eslint-plugin-prettier";
import typescriptEslintPlugin from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "artifacts/**"]
  },
  {
    files: ["src/**/*.ts"],

    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.json"
      }
    },

    plugins: {
      "@typescript-eslint": typescriptEslintPlugin,
      prettier: eslintPluginPrettier
    },

    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-unused-vars": "error"
    },

    settings: {
      "import/resolver": {
        typescript: {}
      }
    }
  }
];
