const assert = require("assert");
const { isProtectedMember, cachedRecoveryInvite } = require("../src/security/protectedMembers");

const cfg = {
  protectedMembers: {
    enabled: true,
    userIds: ["1296954480318873652"],
    recoveryInvites: {
      "1296954480318873652": { url: "https://discord.gg/test" }
    }
  }
};

assert.strictEqual(isProtectedMember(cfg, "1296954480318873652"), true);
assert.strictEqual(isProtectedMember(cfg, "111"), false);
assert.strictEqual(cachedRecoveryInvite(cfg, "1296954480318873652"), "https://discord.gg/test");

cfg.protectedMembers.enabled = false;
assert.strictEqual(isProtectedMember(cfg, "1296954480318873652"), false);

console.log("v12.1 protected-member tests: PASS");
