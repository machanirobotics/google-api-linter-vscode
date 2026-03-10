const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
	{
		ignores: ["out", "dist", "**/*.d.ts", "**/node_modules/**"],
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { ecmaVersion: 6, sourceType: "module" },
		},
		plugins: { "@typescript-eslint": tsPlugin },
		rules: {
			"@typescript-eslint/naming-convention": "warn",
			curly: "warn",
			eqeqeq: "warn",
			"no-throw-literal": "warn",
			semi: "off",
		},
	},
];
