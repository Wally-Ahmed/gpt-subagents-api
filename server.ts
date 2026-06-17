import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askGptCodex, askGptArchitect } from "./gptAgents.js";
import { listPatterns, getPattern, patternNames } from "./patterns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Global install: compiled to <pkg>/dist/server.js, so the colocated .env is one
// level up. Falls back silently to any inherited process.env.OPENAI_API_KEY.
config({ path: resolve(__dirname, "..", ".env") });

const server = new McpServer(
  {
    name: "gpt-subagents",
    version: "1.0.0",
  },
  {
    instructions: `
This server lets you delegate to OpenAI "expert" models from inside your agent loop:

- ask_gpt_codex (GPT-5.3-Codex): routine coding — patches, debugging, tests, repo
  inspection. Cheaper and faster; prefer it for concrete code work.
- ask_gpt_architect (GPT-5.5, high reasoning): hard reasoning, architecture decisions,
  security/threat modeling, and review of large or high-risk changes. May be confidently
  wrong — treat its output as a hypothesis and verify against real files, docs, and tests.

ORCHESTRATION PATTERNS: Before any non-trivial use of these experts (code or security
review, design critique, threat modeling, large-document analysis — anything whose output
you would act on), call list_patterns and apply the most relevant pattern, then read it in
full with get_pattern. Patterns are reusable playbooks that keep expert output parallel,
context-cheap, and verified against ground truth. For quick one-off lookups you may call the
expert tools directly.
    `.trim(),
  }
);

server.tool(
  "ask_gpt_codex",
  "Ask GPT-5.3-Codex to handle a coding task. Use for routine coding, debugging, repo inspection, code patches, tests, stack traces, and implementation details. This is the cheaper, faster model — prefer it for concrete code work.",
  {
    task: z
      .string()
      .describe(
        "The coding task: describe what to fix, implement, debug, or inspect"
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Code snippets, error messages, stack traces, or other relevant context"
      ),
  },
  async ({ task, context }) => {
    const result = await askGptCodex({ task, context });
    return { content: [{ type: "text" as const, text: result }] };
  }
);

server.tool(
  "ask_gpt_architect",
  "Ask GPT-5.5 for hard reasoning, architecture decisions, complex debugging strategy, security/threat modeling, or final review of large/high-risk changes. WARNING: GPT-5.5 may hallucinate confidently — treat output as a hypothesis and verify claims against actual files, docs, and tests before acting.",
  {
    question: z
      .string()
      .describe(
        "The architecture, design, or complex reasoning question"
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Relevant code, constraints, prior analysis, or background information"
      ),
  },
  async ({ question, context }) => {
    const result = await askGptArchitect({ question, context });
    return { content: [{ type: "text" as const, text: result }] };
  }
);

server.tool(
  "list_patterns",
  "List available orchestration patterns for driving the GPT subagents (ask_gpt_codex / ask_gpt_architect). Call this before non-trivial expert work — reviews, audits, threat modeling, large-document analysis — then read the chosen one with get_pattern. Returns each pattern's name, title, summary, and when to use it.",
  {},
  async () => {
    const patterns = listPatterns();
    if (patterns.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No patterns found." }],
      };
    }
    const text = patterns
      .map(
        (p) =>
          `- ${p.name} — ${p.title}\n  Summary: ${p.summary}\n  Use when: ${p.use_when}`
      )
      .join("\n\n");
    return {
      content: [
        {
          type: "text" as const,
          text: `Available orchestration patterns (read one in full with get_pattern):\n\n${text}`,
        },
      ],
    };
  }
);

server.tool(
  "get_pattern",
  "Return the full text of an orchestration pattern by name (see list_patterns). Use it to apply the pattern when orchestrating ask_gpt_codex / ask_gpt_architect calls.",
  {
    name: z
      .string()
      .describe(
        "The pattern name from list_patterns, e.g. 'two-layer-cross-model-expert'"
      ),
  },
  async ({ name }) => {
    const pattern = getPattern(name);
    if (!pattern) {
      const available = patternNames();
      const list = available.length ? available.join(", ") : "(none found)";
      return {
        content: [
          {
            type: "text" as const,
            text: `No pattern named "${name}". Available patterns: ${list}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `# ${pattern.title}\n\n${pattern.body}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GPT subagent MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
