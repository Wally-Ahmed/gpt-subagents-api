# gpt-subagents

An [MCP](https://modelcontextprotocol.io) server that lets **Claude Code delegate to OpenAI
"expert" models as subagents** — and ships a small, extensible library of **orchestration
patterns** that teach the calling agent *how* to use those experts well.

Claude orchestrates; GPT gives a second opinion from a **different model family** (different blind
spots). The patterns make that second opinion **parallel, context-cheap, and verified** instead of
blindly trusted.

---

## The subagent tools

| Tool | Model | Use it for |
|------|-------|------------|
| `ask_gpt_codex` | GPT-5.3-Codex | Routine coding — patches, debugging, tests, repo inspection, concrete edits. Cheaper and faster. |
| `ask_gpt_architect` | GPT-5.5 (high reasoning) | Hard reasoning, architecture decisions, security / threat modeling, review of large or high-risk changes. |

> ⚠️ `ask_gpt_architect` can be **confidently wrong**. Treat its output as a *hypothesis* and verify
> claims against real files, docs, and tests before acting. The orchestration patterns below exist
> largely to make this discipline automatic.

Both tools take a task/question plus optional `context`. Inbound context is run through a
`sanitizeContext` pass that redacts obvious secrets (OpenAI/Anthropic keys) before it leaves your
machine — but don't rely on it as your only safeguard; avoid pasting secrets.

---

## Orchestration patterns

Patterns are reusable playbooks (Markdown files in [`patterns/`](./patterns)) that describe *how* to
drive the expert tools — splitting work, bundling context, calling the expert, **verifying its
output against ground truth**, and aggregating results.

Two tools expose them to the agent:

- **`list_patterns`** — catalog of every pattern (name, title, summary, when to use).
- **`get_pattern("<name>")`** — the full text of one pattern.

Patterns are read from disk **at call time**, so adding or editing one needs no rebuild. The
server's startup `instructions` nudge the agent to consult patterns before any non-trivial expert
work.

**Shipped patterns**

| name | what it does |
|------|--------------|
| [`two-layer-cross-model-expert`](./patterns/two-layer-cross-model-expert.md) | Wrap the GPT expert in verifying Claude subagents so the orchestrator only ever sees parallel, context-cheap, ground-truth-checked conclusions. |

The two-layer pattern also ships a rendered, styled diagram at
[`patterns/html/two-layer-cross-model-expert.html`](./patterns/html/two-layer-cross-model-expert.html) — open it in a
browser for the visual walkthrough.

See [`patterns/README.md`](./patterns/README.md) to add your own.

---

## Setup

**Requirements:** Node 18+ and an OpenAI API key.

```bash
# 1. Install dependencies
npm install

# 2. Add your key (this file is gitignored and must never be committed)
cp .env.example .env
#   then edit .env and set OPENAI_API_KEY=sk-...

# 3. Build
npm run build
```

This compiles to `dist/`. The server loads `.env` from the project root (one level up from
`dist/server.js`), or falls back to an inherited `OPENAI_API_KEY` in the environment.

### Register with Claude Code

```bash
claude mcp add gpt-subagents -- node /absolute/path/to/gpt-subagents/dist/server.js
```

Or add it to your MCP client config manually:

```jsonc
{
  "mcpServers": {
    "gpt-subagents": {
      "command": "node",
      "args": ["/absolute/path/to/gpt-subagents/dist/server.js"]
    }
  }
}
```

Once connected, the server advertises four tools: `ask_gpt_codex`, `ask_gpt_architect`,
`list_patterns`, and `get_pattern`.

---

## Project layout

```
gpt-subagents/
├── server.ts        # MCP server: tool defs + server instructions
├── gptAgents.ts     # OpenAI calls (codex + architect) and secret sanitization
├── patterns.ts      # Loads/parses pattern Markdown from patterns/
├── patterns/        # Orchestration patterns (one Markdown file each)
│   ├── README.md
│   └── two-layer-cross-model-expert.md
├── .env.example     # Placeholder; copy to .env (gitignored)
└── dist/            # Build output (gitignored)
```

---

## Security notes

- **`.env` is gitignored** and never tracked — only the `.env.example` placeholder is committed.
  Local agent/editor state (`.mempalace/`, `.claude/`, `CLAUDE.local.md`, IDE folders) is gitignored
  too, so dev-environment data doesn't leak into the repo.
- **`sanitizeContext`** redacts `sk-…` keys and `OPENAI_API_KEY=` / `ANTHROPIC_API_KEY=` assignments
  from outbound context. It's a backstop, not a guarantee — keep secrets out of prompts.
- **Verify expert output.** GPT-5.5 reasoning is powerful but fallible; the `two-layer-cross-model-expert`
  pattern is the recommended way to act on it safely.

---

## License

ISC
