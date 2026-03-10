const esbuild = require("esbuild");
const path = require("node:path");

const production = process.argv.includes("--production");

async function main() {
	await esbuild.build({
		entryPoints: [path.join(__dirname, "src", "extension.ts")],
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "node18",
		outfile: path.join(__dirname, "out", "extension.js"),
		external: ["vscode"],
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
	});
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
