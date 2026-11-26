/* Fast checks that need no database: RFC 6238 TOTP vectors and base32 round-trip. */
import assert from "node:assert/strict";
import { base32Decode, base32Encode, newSecret, totp, verifyTotp } from "../src/lib/totp";

const s = base32Encode(Buffer.from("12345678901234567890"));
assert.equal(s, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
assert.equal(totp(s, 59_000), "287082");
assert.equal(totp(s, 1_111_111_109_000), "081804");
assert.equal(totp(s, 20_000_000_000_000), "353130");
assert.ok(verifyTotp(s, totp(s, 59_000), 59_000 + 29_000), "accepts one step of drift");
assert.ok(!verifyTotp(s, totp(s, 59_000), 59_000 + 95_000), "rejects old codes");
assert.ok(!verifyTotp(s, "12345"), "rejects malformed codes");
const r = newSecret();
assert.equal(base32Encode(base32Decode(r)), r);
console.log("selftest ok");
