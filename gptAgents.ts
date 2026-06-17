import OpenAI from "openai";

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY in environment variables.");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

type CodexInput = {
  task: string;
  context?: string;
};

type ArchitectInput = {
  question: string;
  context?: string;
};

// Best-effort secret redaction for anything we send to the external API. Every
// pattern is linear (a single repetition over a simple character class, no
// nested quantifiers) so this is ReDoS-safe even on hostile input.
export function sanitizeContext(context = ""): string {
  return (
    context
      // PEM private-key blocks (any "... PRIVATE KEY" label). [\s\S] is the
      // body; the lazy *? plus distinct delimiters keep this linear.
      .replace(
        /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
        "[REDACTED_PRIVATE_KEY]"
      )
      // Provider API tokens (prefix-identified, high-signal).
      .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_OPENAI_KEY]")
      .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/gh[pousr]_[A-Za-z0-9]+/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]")
      .replace(/\bAIza[A-Za-z0-9_-]{35}\b/g, "[REDACTED_GOOGLE_KEY]")
      .replace(/\bxox[baprs]-[A-Za-z0-9-]+/g, "[REDACTED_SLACK_TOKEN]")
      // Generic `Bearer <token>` auth headers.
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
      // Sensitive assignments in either `KEY=value` or `KEY: value` form,
      // including quoted values, covering common YAML/JSON/.env shapes. Kept
      // conservative: only key names ending in API_KEY / SECRET / TOKEN /
      // PASSWORD, plus the legacy OPENAI/ANTHROPIC names.
      .replace(
        /\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/g,
        "$1=[REDACTED]"
      )
      // Generic high-entropy token catch-all (runs last). Require the 40+ char
      // run to MIX lower + UPPER + digit — the signature of a random secret — so
      // ordinary long strings pass through untouched: git SHAs and other hex
      // digests (no uppercase), SCREAMING_CONSTANTS / snake_case identifiers (no
      // digit), and plain prose. The three lookaheads each scan a fixed class
      // with no nested quantifiers, so this stays linear (ReDoS-safe).
      .replace(
        /\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{40,}\b/g,
        "[REDACTED_TOKEN]"
      )
  );
}

// Run an outbound API call, converting any SDK error into a generic, redacted
// Error so request metadata / local paths (the .env lives in this dir) never
// reach the MCP client. Full detail goes to stderr only.
async function callOpenAI(
  label: string,
  fn: () => Promise<{ output_text?: string }>
): Promise<string> {
  try {
    const response = await fn();
    return response.output_text ?? "";
  } catch (err) {
    console.error(`[gpt-subagents] ${label} failed:`, err);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} failed: ${sanitizeContext(detail)}`);
  }
}

export async function askGptCodex({
  task,
  context = "",
}: CodexInput): Promise<string> {
  const client = getClient();
  const safeTask = sanitizeContext(task);
  const safeContext = sanitizeContext(context);

  return callOpenAI("ask_gpt_codex", () =>
    client.responses.create({
    model: "gpt-5.3-codex",
    instructions: `
You are a coding subagent. You handle routine implementation work.

Focus on:
- Correct, working code patches
- Debugging with stack traces and error context
- Test writing and test-driven fixes
- Repo inspection and code navigation
- Implementation details and concrete edits

Return:
- The fix or implementation
- Code patch (diff or full replacement)
- Any edge cases or risks noticed
- Confidence level (high/medium/low)

Be direct. Produce code, not essays.
    `.trim(),
    input: `
Task:
${safeTask}

Context:
${safeContext}
    `.trim(),
    })
  );
}

export async function askGptArchitect({
  question,
  context = "",
}: ArchitectInput): Promise<string> {
  const client = getClient();
  const safeQuestion = sanitizeContext(question);
  const safeContext = sanitizeContext(context);

  return callOpenAI("ask_gpt_architect", () =>
    client.responses.create({
    model: "gpt-5.5",
    reasoning: { effort: "xhigh" },
    instructions: `
You are a senior architect subagent for hard reasoning tasks.

Focus on:
- Architecture decisions and tradeoffs
- Complex debugging strategy
- Security and threat modeling
- Risk assessment for large or high-stakes changes
- Design review and system-level reasoning

Important:
- Clearly separate facts from assumptions.
- Flag uncertainty. Do not make confident claims you cannot support.
- When referencing files, APIs, dependencies, or behaviors, note whether you are certain or inferring.
- Prefer structured reasoning: state the problem, enumerate options, recommend with rationale.

Return:
- Analysis of the problem
- Options considered with tradeoffs
- Recommended approach with rationale
- Risks and unknowns
- Confidence level (high/medium/low)
    `.trim(),
    input: `
Question:
${safeQuestion}

Context:
${safeContext}
    `.trim(),
    })
  );
}
