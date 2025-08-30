import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
    { 
        files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], 
        plugins: { js }, extends: ["js/recommended"], 
        languageOptions: { globals: globals.browser },
        rules: {
            "indent": ["error", 4],
            "react/jsx-indent": ["error", 4],
            "react/jsx-indent-props": ["error", 4],
        }
    },
    tseslint.configs.recommended,
]);
