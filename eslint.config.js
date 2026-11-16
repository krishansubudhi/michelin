import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", ".runs/", "test/fixtures/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 4],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", 400],
      "max-params": ["error", 4],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": "error",
      eqeqeq: "error",
      "prefer-const": "error",
    },
  },
  // Tests are long tables of cases; only the function-length rule is relaxed for them.
  { files: ["test/**/*.ts"], rules: { "max-lines-per-function": "off" } },
);
