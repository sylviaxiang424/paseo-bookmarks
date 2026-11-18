import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { assertPluginCompatibility } from "../node_modules/@getpaseo/protocol/dist/plugin-requirements.js";

test("app and daemon admit Paseo 0.13 and later without an installation upper bound", async () => {
  const { id, requirements } = JSON.parse(await readFile(new URL("../paseo-plugin.json", import.meta.url), "utf8"));
  for (const runtime of ["app", "daemon"] as const) {
    for (const version of ["0.13.0", "0.13.2", "0.14.0", "0.15.0", "0.15.4", "0.16.0", "0.16.1", "0.17.0", "1.0.0"]) {
      assert.doesNotThrow(() => assertPluginCompatibility({ id, requirements, runtime, version }), `${runtime} ${version}`);
    }
    for (const version of ["0.12.9", "0.10.0"]) {
      assert.throws(() => assertPluginCompatibility({ id, requirements, runtime, version }), /requires Paseo/, `${runtime} ${version}`);
    }
  }
});
