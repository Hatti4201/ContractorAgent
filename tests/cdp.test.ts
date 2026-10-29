import assert from "node:assert/strict";
import test from "node:test";
import { isNavigationTimeout } from "@/services/cdp";

test("navigation timeouts are retryable, other failures are not", () => {
  assert.equal(isNavigationTimeout(new Error("Chrome did not answer Page.navigate in time.")), true);
  assert.equal(isNavigationTimeout(new Error("Chrome refused Page.navigate")), false);
  assert.equal(isNavigationTimeout("Chrome did not answer Page.navigate in time"), false);
});
