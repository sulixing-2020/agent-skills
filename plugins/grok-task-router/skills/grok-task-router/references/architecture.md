# Architecture & Security Boundaries

## Directory Structure

```text
grok-task-router/
├── .codex-plugin/plugin.json          Plugin manifest (Codex marketplace)
├── .mcp.json                          MCP process launch config
├── mcp/server.mjs                     Standalone stdio MCP Server
├── skills/grok-task-router/
│   ├── SKILL.md                       Agent routing rules
│   ├── agents/openai.yaml             Skill interface & MCP dependency
│   ├── references/architecture.md     Architecture & security boundaries
│   ├── references/operations.md       Installation, usage & rollback
│   └── scripts/doctor.mjs             Local CLI/OAuth diagnostics
├── tests/
│   ├── fake-grok.mjs                  Quota-free fake CLI for testing
│   └── smoke.mjs                      MCP protocol & security smoke tests
├── config.example.json                Proxy config template
└── README.md                          This file
```

## Two Modes

### Calling agent invokes Grok as consultant

```text
Calling agent (Claude Code / Codex / Cursor / ...)
  -> grok-task-router MCP
  -> Official Grok Build CLI (headless mode)
  -> Grok output
  -> Calling agent verifies & synthesizes
```

The calling agent's model, conversation history, and tools remain under its own control. Grok only sees the task and context explicitly passed to it.

### Task-level delegation to Grok

```text
Calling agent
  -> delegate_to_grok
  -> Grok Build executes in target workspace
  -> Returns result + Git status
  -> Calling agent reviews & continues
```

This is NOT a main-model switch in the caller's UI. The Skill and MCP server cannot replace a running conversation's model with another provider. For full Grok takeover of a coding task, use task delegation, or launch the official Grok TUI directly in the terminal.

## Security Boundaries

- **Consultant mode**: runs in a temp empty directory, overrides system prompt to block external project rules, disables memory/subagents/planning/web search, removes local file and shell tools.
- **X search mode**: only enables `x_search`, `web_search`, and `web_fetch`.
- **Edit delegation**: requires explicit workspace + `confirm_write=true`, uses workspace sandbox with dangerous command deny rules.
- **All modes**: deny external MCP tools; edit mode additionally denies network commands, publish, push, deploy, privilege escalation, and destructive Git operations.
- **Environment isolation**: child processes only inherit basic language, certificate, and proxy env vars; never forwards `XAI_API_KEY` or arbitrary environment variables.
- **Output limits**: stdout/stderr are capped; timeouts kill the entire child process group.
- **Auth**: managed by the official Grok CLI; this plugin never reads or copies token content.

## Model Compatibility

The default model is auto-detected from `grok models` CLI output (`Default model:` line). If detection fails, falls back to `grok-4.6`. The `grok-build-0.1` alias is preserved for backward compatibility — if the CLI doesn't expose it natively, it resolves to the detected default with explicit reporting. Set `GROK_ROUTER_STRICT_MODELS=1` to disable this fallback.
