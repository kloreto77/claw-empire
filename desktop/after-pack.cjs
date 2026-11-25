const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const source = path.resolve(__dirname, "..", ".desktop-runtime", "node_modules");
  const target = path.join(context.appOutDir, "resources", "mesa-runtime", "node_modules");
  if (!fs.existsSync(path.join(source, "tsx", "dist", "loader.mjs"))) {
    throw new Error("Staged tsx dependency is missing");
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
  for (const file of ["tsx/dist/loader.mjs", "express/package.json", "ws/package.json", "esbuild/package.json"]) {
    if (!fs.existsSync(path.join(target, file))) throw new Error("Missing packaged dependency: " + file);
  }
  console.log("Mesa backend dependencies copied and verified in " + target);
};
