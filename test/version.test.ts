import test from "ava";
import fs from "fs";
import path from "path";

// Compiled location: dist/test/version.test.js — project root is two levels up.
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

test("package.json and src/driver.json versions are in sync", (t) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
  const drv = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "src", "driver.json"), "utf-8"));
  t.is(
    pkg.version,
    drv.version,
    `package.json version (${pkg.version}) must match src/driver.json version (${drv.version})`
  );
});
