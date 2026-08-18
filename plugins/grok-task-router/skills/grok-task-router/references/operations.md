# Installation, Usage & Rollback

## Prerequisites

```bash
grok version
grok login
grok models
node --version
```

Requires Node.js 18+ and a logged-in official Grok Build CLI.

## Install the MCP server

### Claude Code

```bash
claude mcp add grok-task-router -- node /path/to/grok-task-router/mcp/server.mjs
```

Replace `/path/to/grok-task-router` with the actual directory. The four tools (`grok_router_status`, `consult_grok`, `search_x_with_grok`, `delegate_to_grok`) will be available in new conversations.

### Codex

Install the plugin to your personal marketplace, then:

```bash
codex plugin add grok-task-router@personal
```

Start a new Codex task to load the Skill and MCP tools.

### Cursor

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "grok-task-router": {
      "command": "node",
      "args": ["/path/to/grok-task-router/mcp/server.mjs"]
    }
  }
}
```

Restart Cursor to pick up the new server.

### Other MCP-compatible agents

Any agent that supports MCP stdio transport can use this server. The command is:

```bash
node /path/to/grok-task-router/mcp/server.mjs
```

The server communicates via JSON-RPC over stdio (both newline-delimited and Content-Length framed).

## Local proxy configuration (optional)

If the Grok CLI works in your terminal but fails from within an agent (DNS or network errors), the agent process may not inherit your terminal's proxy environment. Create a config file:

```json
{
  "proxy": "http://127.0.0.1:7897"
}
```

At this fixed path:

```text
~/.config/grok-task-router/config.json
```

You can copy from `config.example.json` in the plugin root and adjust the port. The env var `GROK_ROUTER_PROXY` overrides this file. Only local loopback addresses (`127.0.0.1`, `localhost`, `::1`) over HTTP/HTTPS are accepted; no credentials or remote proxies. This file contains no Grok credentials and should not be committed to Git.

## Common requests

```text
Use Grok to independently review this technical proposal.
Use Grok to challenge this business judgment.
Use Grok to search X posts about PDF tools in the last 48 hours.
Delegate this bounded modification in /path/to/repo to Grok, then review the result.
Check Grok CLI login status and available models.
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GROK_ROUTER_CLI` | auto-detect `grok` | Absolute path to official CLI |
| `GROK_ROUTER_PROXY` | empty | Temporary local HTTP/HTTPS proxy override |
| `GROK_ROUTER_CONFIG` | `~/.config/grok-task-router/config.json` | Local config file path |
| `GROK_ROUTER_TIMEOUT_MS` | `240000` | Consultant timeout |
| `GROK_ROUTER_SEARCH_TIMEOUT_MS` | `600000` | X search timeout |
| `GROK_ROUTER_DELEGATE_TIMEOUT_MS` | `600000` | Task delegation timeout |
| `GROK_ROUTER_ALLOWED_ROOTS` | empty | Allowed root directories for edit mode (system path separator) |
| `GROK_ROUTER_STRICT_MODELS` | `0` | Set to `1` to disable model compatibility fallback |

## Verification

```bash
node skills/grok-task-router/scripts/doctor.mjs
node --check mcp/server.mjs
node tests/smoke.mjs
```

After installation, call `grok_router_status` in a new conversation, then test with a short question via `consult_grok`.

## Uninstall

### Claude Code

```bash
claude mcp remove grok-task-router
```

### Codex

```bash
codex plugin remove grok-task-router
```

### Cursor

Remove the `grok-task-router` entry from your MCP config JSON.

The plugin does not modify your agent's model configuration, so uninstalling requires no config restoration.
