const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  // Extension host bundle (Node, CJS)
  const extCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    sourcemap: !production,
    minify: production,
  });

  // Lineage webview bundle (browser, IIFE)
  const lineageCtx = await esbuild.context({
    entryPoints: ["src/features/lineage/webview/App.tsx"],
    bundle: true,
    outfile: "dist/lineage.js",
    format: "iife",
    platform: "browser",
    sourcemap: !production,
    minify: production,
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": production ? '"production"' : '"development"',
    },
  });

  if (watch) {
    await Promise.all([extCtx.watch(), lineageCtx.watch()]);
    console.log("Watching...");
  } else {
    await Promise.all([extCtx.rebuild(), lineageCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), lineageCtx.dispose()]);
  }
}

main().catch(() => process.exit(1));
