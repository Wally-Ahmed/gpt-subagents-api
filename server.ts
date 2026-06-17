import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askGptWorker, askGptArchitect } from "./gptAgents.js";
import { listPatterns, getPattern, patternNames } from "./patterns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Global install: compiled to <pkg>/dist/server.js, so the colocated .env is one
// level up. Falls back silently to any inherited process.env.OPENAI_API_KEY.
config({ path: resolve(__dirname, "..", ".env") });

const server = new McpServer(
  {
    name: "gpt-subagents-api",
    version: "1.0.0",
  },
  {
    instructions: `
This server lets you delegate to OpenAI "expert" models from inside your agent loop:

- ask_gpt_worker: routine coding — patches, debugging, tests, repo inspection. Cheaper and
  faster; prefer it for concrete code work. You choose the model (e.g. gpt-5.3-codex).
- ask_gpt_architect: hard reasoning, architecture decisions, security/threat modeling, and
  review of large or high-risk changes. Uses high-effort reasoning; you choose the model
  (e.g. gpt-5.5). Expert reasoning models can be confidently wrong — treat output as a
  hypothesis and verify against real files, docs, and tests before acting.

ORCHESTRATION PATTERNS: Before any non-trivial use of ask_gpt_architect — or for any
review, audit, threat modeling, or large-document analysis whose output you would act on —
call list_patterns and apply the most relevant pattern, then read it in full with get_pattern.
Patterns are reusable playbooks that keep expert output parallel, context-cheap, and verified
against ground truth. For quick one-off lookups you may call the expert tools directly.

DATA BOUNDARY: task, question, and context are sent to an external OpenAI API. Secrets are
stripped on a best-effort basis (common API keys, tokens, and private keys are redacted), but
this is not guaranteed — do NOT paste highly sensitive data and rely on redaction to protect it.
    `.trim(),
  }
);

// Input size caps. These bound what we forward to the API so an oversized
// argument can't be used to burn API credit, overflow context, or buffer huge
// strings. Comparable to the sibling subscription server's limits.
const MAX_PROMPT_CHARS = 32_000;
const MAX_CONTEXT_CHARS = 200_000;
const MAX_PATTERN_NAME_CHARS = 100;

// Convert any thrown error into a generic, caller-safe message. Details
// (including the original error) are logged to stderr by gptAgents/here, never
// returned to the MCP client where they could disclose local paths/metadata.
function errorText(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

server.tool(
  "ask_gpt_worker",
  "Delegate a coding task to an OpenAI model. Use for routine coding, debugging, repo inspection, code patches, tests, stack traces, and implementation details — the cheaper, faster path for concrete code work. Pass any valid OpenAI model id; a coding-focused model such as gpt-5.3-codex works well here.",
  {
    task: z
      .string()
      .trim()
      .min(1)
      .max(MAX_PROMPT_CHARS)
      .describe(
        "The coding task: describe what to fix, implement, debug, or inspect"
      ),
    context: z
      .string()
      .max(MAX_CONTEXT_CHARS)
      .optional()
      .describe(
        "Code snippets, error messages, stack traces, or other relevant context"
      ),
    model: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(
        "The OpenAI model to use, e.g. 'gpt-5.3-codex'. Any valid OpenAI model id is accepted."
      ),
  },
  async ({ task, context, model }) => {
    try {
      const result = await askGptWorker({ task, context, model });
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      console.error("[gpt-subagents] ask_gpt_worker handler error:", err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: errorText(err) }],
      };
    }
  }
);

server.tool(
  "ask_gpt_architect",
  "Delegate a hard reasoning task to an OpenAI model with high-effort reasoning. Use for architecture decisions, complex debugging strategy, security/threat modeling, or final review of large/high-risk changes. Pass any valid OpenAI model id; a strong reasoning model such as gpt-5.5 works well here. WARNING: expert reasoning models can be confidently wrong — treat output as a hypothesis and verify claims against actual files, docs, and tests before acting. For reviews and audits, prefer using list_patterns / get_pattern to apply an orchestration pattern that keeps expert output verified against ground truth.",
  {
    question: z
      .string()
      .trim()
      .min(1)
      .max(MAX_PROMPT_CHARS)
      .describe(
        "The architecture, design, or complex reasoning question"
      ),
    context: z
      .string()
      .max(MAX_CONTEXT_CHARS)
      .optional()
      .describe(
        "Relevant code, constraints, prior analysis, or background information"
      ),
    model: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(
        "The OpenAI model to use, e.g. 'gpt-5.5'. Any valid OpenAI model id is accepted."
      ),
  },
  async ({ question, context, model }) => {
    try {
      const result = await askGptArchitect({ question, context, model });
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      console.error("[gpt-subagents] ask_gpt_architect handler error:", err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: errorText(err) }],
      };
    }
  }
);

server.tool(
  "list_patterns",
  "List available orchestration patterns for driving the GPT subagents (ask_gpt_worker / ask_gpt_architect). Call this before non-trivial expert work — reviews, audits, threat modeling, large-document analysis — then read the chosen one with get_pattern. Returns each pattern's name, title, summary, and when to use it.",
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
  "Return the full text of an orchestration pattern by name (see list_patterns). Use it to apply the pattern when orchestrating ask_gpt_worker / ask_gpt_architect calls.",
  {
    name: z
      .string()
      .trim()
      .min(1)
      .max(MAX_PATTERN_NAME_CHARS)
      .describe(
        "The pattern name from list_patterns, e.g. 'two-layer-cross-model-expert'"
      ),
  },
  async ({ name }) => {
    const pattern = getPattern(name);
    if (!pattern) {
      const available = patternNames();
      const list = available.length ? available.join(", ") : "(none found)";
      // JSON.stringify + truncate the echoed name so control chars / a huge
      // value can't inject newlines or formatting into the reflected message.
      const echoed = JSON.stringify(name.slice(0, MAX_PATTERN_NAME_CHARS));
      return {
        content: [
          {
            type: "text" as const,
            text: `No pattern named ${echoed}. Available patterns: ${list}`,
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
