import assert from "node:assert/strict";
import { canUseProvider, reportProviderFailure, reportProviderSuccess } from "../src/lib/terboo-provider-health.js";
reportProviderSuccess("test");
reportProviderFailure("test", "x"); reportProviderFailure("test", "x"); reportProviderFailure("test", "x");
assert.equal(canUseProvider("test").allowed, false);
reportProviderSuccess("test");
assert.equal(canUseProvider("test").allowed, true);
console.log("provider health tests: passed");
