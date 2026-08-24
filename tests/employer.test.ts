import assert from "node:assert/strict";
import test from "node:test";
import { employerCcSetting } from "@/services/employer";

test("the employer copy address is taken only from a valid private setting", () => {
  assert.deepEqual(employerCcSetting({ EMPLOYER_CC_ADDRESS: "employer@example.invalid" }), { address: "employer@example.invalid", issue: null });
  assert.deepEqual(employerCcSetting({}), { address: null, issue: null }, "Not configured is not an error on its own.");
  assert.deepEqual(employerCcSetting({ EMPLOYER_CC_ADDRESS: "   " }), { address: null, issue: null });

  // A misconfigured address must be reported, never quietly dropped, because nothing downstream checks it.
  const broken = employerCcSetting({ EMPLOYER_CC_ADDRESS: "not-an-address" });
  assert.equal(broken.address, null);
  assert.match(broken.issue ?? "", /valid email/i);
  assert.equal(employerCcSetting({ EMPLOYER_CC_ADDRESS: `${"a".repeat(320)}@example.invalid` }).address, null);
});
