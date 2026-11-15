/* tiny loader: transpiles src/lib/*.ts in memory with the project's TypeScript (no bundler, no browser) */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const SRC = path.join(__dirname, "..", "src", "lib");
module.exports = function makeLoader() {
  const cache = {};
  const load = (name) => {
    if (cache[name]) return cache[name].exports;
    const out = ts.transpileModule(fs.readFileSync(path.join(SRC, name + ".ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const mod = { exports: {} };
    cache[name] = mod;
    new Function("exports", "require", "module", out)(mod.exports, (s) => load(s.replace("./", "")), mod);
    return mod.exports;
  };
  return load;
};
