const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: [
      "vscode",
      // playwright-core 包含动态文件引用和 __dirname 相对路径操作，
      // 无法安全打包，保持 external 通过 node_modules 加载
      "playwright-core",
    ],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node20",
  })
  .then(() => {
    console.log("✅ Bundle complete: dist/extension.js");
  })
  .catch((err) => {
    console.error("❌ Bundle failed:", err);
    process.exit(1);
  });
