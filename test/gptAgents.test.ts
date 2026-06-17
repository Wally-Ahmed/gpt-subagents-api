import { describe, it, expect } from "vitest";
import { sanitizeContext } from "../gptAgents.js";

describe("sanitizeContext — provider secret classes", () => {
  it("redacts OpenAI sk- keys", () => {
    const out = sanitizeContext("token sk-AbC0123456789_def-XYZ end");
    expect(out).not.toContain("sk-AbC0123456789_def-XYZ");
    expect(out).toContain("[REDACTED_OPENAI_KEY]");
  });

  it("redacts GitHub classic (ghp_) and fine-grained (github_pat_) tokens", () => {
    const ghp = "ghp_" + "A".repeat(36);
    const pat = "github_pat_" + "B".repeat(22) + "_" + "C".repeat(59);
    const out = sanitizeContext(`a ${ghp} b ${pat} c`);
    expect(out).not.toContain(ghp);
    expect(out).not.toContain(pat);
    expect(out).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts AWS access key ids (AKIA / ASIA)", () => {
    const akia = "AKIA" + "1234567890ABCDEF"; // 16 trailing
    const asia = "ASIA" + "ABCDEF1234567890";
    const out = sanitizeContext(`${akia} and ${asia}`);
    expect(out).not.toContain(akia);
    expect(out).not.toContain(asia);
    expect(out).toContain("[REDACTED_AWS_KEY]");
  });

  it("redacts Google API keys (AIza...)", () => {
    const key = "AIza" + "D".repeat(35);
    const out = sanitizeContext(`key=${key}`);
    expect(out).not.toContain(key);
    // matched either by the Google rule or the assignment rule; never leaks raw
    expect(out).toMatch(/REDACTED/);
  });

  it("redacts Slack tokens (xox[baprs]-...)", () => {
    const tok = "xoxb-123456789012-abcdEFGH";
    const out = sanitizeContext(`slack ${tok} here`);
    expect(out).not.toContain(tok);
    expect(out).toContain("[REDACTED_SLACK_TOKEN]");
  });

  it("redacts generic Bearer tokens", () => {
    const out = sanitizeContext("Authorization: Bearer abc.DEF-123_xyz==");
    expect(out).not.toContain("abc.DEF-123_xyz==");
    expect(out).toContain("Bearer [REDACTED]");
  });

  it("redacts PEM private-key blocks", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAk",
      "EAtttttttttttttttttttttttttttttttttttttttttt",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const out = sanitizeContext(`here is a key:\n${pem}\ndone`);
    expect(out).not.toContain("MIIBVAIBADAN");
    expect(out).not.toContain("PRIVATE KEY");
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
    expect(out).toContain("here is a key:");
    expect(out).toContain("done");
  });
});

describe("sanitizeContext — assignment forms", () => {
  it("redacts KEY=value (the original form)", () => {
    const out = sanitizeContext("OPENAI_API_KEY=supersecretvalue123");
    expect(out).not.toContain("supersecretvalue123");
    expect(out).toContain("OPENAI_API_KEY=[REDACTED]");
  });

  it("redacts ANTHROPIC_API_KEY=value", () => {
    const out = sanitizeContext("ANTHROPIC_API_KEY=sk-ant-abc123def456");
    expect(out).not.toContain("sk-ant-abc123def456");
    expect(out).toContain("ANTHROPIC_API_KEY=[REDACTED]");
  });

  it("redacts KEY: value (YAML form)", () => {
    const out = sanitizeContext("MY_API_KEY: plaintextsecret");
    expect(out).not.toContain("plaintextsecret");
    expect(out).toMatch(/MY_API_KEY=\[REDACTED\]/);
  });

  it('redacts quoted values KEY="..." and KEY: \'...\'', () => {
    const dq = sanitizeContext('DB_PASSWORD="hunter2-very-secret"');
    expect(dq).not.toContain("hunter2-very-secret");
    expect(dq).toMatch(/DB_PASSWORD=\[REDACTED\]/);

    const sq = sanitizeContext("SOME_SECRET: 'another-secret-val'");
    expect(sq).not.toContain("another-secret-val");
    expect(sq).toMatch(/SOME_SECRET=\[REDACTED\]/);
  });

  it("redacts a generic *_TOKEN assignment", () => {
    const out = sanitizeContext("SLACK_TOKEN=plain-token-here-value");
    expect(out).not.toContain("plain-token-here-value");
    expect(out).toMatch(/SLACK_TOKEN=\[REDACTED\]/);
  });
});

describe("sanitizeContext — does not mangle ordinary prose", () => {
  it("leaves text that merely contains the word 'key' intact", () => {
    const text =
      "The key insight is that the public key API is the master key to success.";
    expect(sanitizeContext(text)).toBe(text);
  });

  it("leaves a normal sentence with a colon intact", () => {
    const text = "Note: the build passes and tests are green.";
    expect(sanitizeContext(text)).toBe(text);
  });

  it("returns empty string for empty / default input", () => {
    expect(sanitizeContext()).toBe("");
    expect(sanitizeContext("")).toBe("");
  });
});

describe("sanitizeContext — ReDoS safety (linear, fast on hostile input)", () => {
  it("processes a large adversarial input quickly", () => {
    const hostile = "Bearer " + "a".repeat(200_000) + " " + "-".repeat(200_000);
    const start = Date.now();
    const out = sanitizeContext(hostile);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(out).toContain("Bearer [REDACTED]");
  });
});

describe("sanitizeContext — loosened generic catch-all (high-entropy only)", () => {
  it("still redacts a long mixed lower+UPPER+digit token not covered by a specific rule", () => {
    const token = "Xy7".repeat(16); // 48 chars, mixes all three classes
    const out = sanitizeContext(`value ${token} end`);
    expect(out).not.toContain(token);
    expect(out).toContain("[REDACTED_TOKEN]");
  });

  it("preserves a git SHA-1 (40 hex, no uppercase)", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const text = `fixed in commit ${sha} today`;
    expect(sanitizeContext(text)).toBe(text);
  });

  it("preserves a SHA-256 hex digest (64 hex, no uppercase)", () => {
    const sha = "0123456789abcdef".repeat(4);
    const text = `integrity ${sha} ok`;
    expect(sanitizeContext(text)).toBe(text);
  });

  it("preserves a long snake_case identifier (no digit)", () => {
    const ident = "this_is_a_really_long_descriptive_function_name_here";
    const text = `call ${ident}()`;
    expect(sanitizeContext(text)).toBe(text);
  });

  it("stays linear on a long no-uppercase run (catch-all lookahead fails fast)", () => {
    const hostile = "x".repeat(300_000);
    const start = Date.now();
    const out = sanitizeContext(hostile);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(out).toBe(hostile);
  });
});
