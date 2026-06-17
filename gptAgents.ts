import OpenAI from "openai";

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment variables.");
  }
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

function sanitizeContext(context = ""): string {
  return context
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_OPENAI_KEY]")
    .replace(/ANTHROPIC_API_KEY=[^\s]+/g, "ANTHROPIC_API_KEY=[REDACTED]")
    .replace(/OPENAI_API_KEY=[^\s]+/g, "OPENAI_API_KEY=[REDACTED]");
}

export async function askGptCodex({
  task,
  context = "",
}: CodexInput): Promise<string> {
  const client = getClient();
  const safeContext = sanitizeContext(context);

  const response = await client.responses.create({
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
${task}

Context:
${safeContext}
    `.trim(),
  });

  return response.output_text;
}

export async function askGptArchitect({
  question,
  context = "",
}: ArchitectInput): Promise<string> {
  const client = getClient();
  const safeContext = sanitizeContext(context);

  const response = await client.responses.create({
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
${question}

Context:
${safeContext}
    `.trim(),
  });

  return response.output_text;
}
