import assert from "node:assert/strict";
import test from "node:test";
import { codeFromLabel, readRoleFamilyCode } from "@/services/role-family";

test("a family code is derived from its name when the user leaves it blank", () => {
  assert.equal(codeFromLabel("Python + React"), "PYTHON_REACT");
  assert.equal(codeFromLabel("  java / AI  "), "JAVA_AI");
  assert.equal(readRoleFamilyCode(codeFromLabel("Go backend")), "GO_BACKEND");
  // A name with no letter to start a code gives an invalid code, which the form reports.
  assert.throws(() => readRoleFamilyCode(codeFromLabel("123 + ++")));
});
