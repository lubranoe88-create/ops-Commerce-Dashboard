import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.LOCAL_LLM_ENABLED = "1";
process.env.LOCAL_LLM_HOSTS = "bionic.local,bionic";
process.env.LOCAL_LLM_PORT = "23000";
process.env.LOCAL_LLM_BASE_URL = "";

const {
  localLlmBaseUrlCandidates,
  localLlmChatUrl,
  localLlmEnabled,
  localLlmHosts,
  localLlmPort,
  probeLocalLlm,
} = await import("./localLlm.js");

describe("localLlm LAN hostname config", () => {
  it("prefers bionic.local then bionic on port 23000", () => {
    assert.equal(localLlmEnabled(), true);
    assert.equal(localLlmPort(), 23000);
    assert.deepEqual(localLlmHosts(), ["bionic.local", "bionic"]);
    const candidates = localLlmBaseUrlCandidates();
    assert.ok(candidates.includes("http://bionic.local:23000/v1"));
    assert.ok(candidates.includes("http://bionic:23000/v1"));
    assert.equal(candidates[0], "http://bionic.local:23000/v1");
    assert.equal(
      localLlmChatUrl("http://bionic.local:23000/v1"),
      "http://bionic.local:23000/v1/chat/completions",
    );
  });

  it("probe reports unreachable hosts without throwing", async () => {
    const probe = await probeLocalLlm({
      timeoutMs: 400,
      fetchImpl: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND bionic.local"), {
          code: "ENOTFOUND",
        });
      },
    });
    assert.equal(probe.ok, false);
    assert.ok(probe.hostTried.length >= 2);
    assert.match(probe.hostTried[0], /bionic\.local/);
  });
});
