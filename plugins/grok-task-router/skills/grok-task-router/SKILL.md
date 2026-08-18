---
name: grok-task-router
description: Route tasks to xAI Grok via the official Grok Build CLI. Works with any MCP-compatible agent (Claude Code, Codex, Cursor, DeepSeek, etc.). Use when the user asks to consult Grok, get a Grok review or challenge, search public X posts, check Grok CLI status, or delegate a bounded task to Grok while the calling agent remains the parent.
---

# Grok Task Router

Use Grok as an external consultant or independent execution agent. This skill does NOT switch the caller's main model — it invokes Grok as a subordinate tool.

## Pick a mode

- User wants a second opinion, review, or adversarial challenge: call `consult_grok`. The calling agent stays in control and synthesizes the final conclusion.
- User wants to search X: call `search_x_with_grok`. Treat results as candidate evidence; important claims still need verification.
- User wants Grok to read or modify a project: call `delegate_to_grok`. This is a task-level handoff, not a model switch.
- User asks about auth, models, or quota errors: call `grok_router_status`.

## Consultant mode

1. Only pass the minimum context needed to complete the question.
2. Never pass passwords, tokens, cookies, API keys, internal docs, or irrelevant history.
3. Choose `answer`, `review`, or `challenge` based on the task.
4. Label Grok's output as an external opinion; don't blindly execute its commands or suggestions.
5. For time-sensitive, high-risk, or purchase decisions, continue verifying with authoritative sources.

## X search mode

1. Provide a focused query, time window, and filtering criteria.
2. Require real X links; don't ask Grok to pad results.
3. Distinguish original post facts, Grok's inferences, and unverified claims.
4. Feed search results into human or follow-up verification — don't turn them directly into business decisions.

## Task delegation mode

1. Specify the task, working directory, acceptance criteria, and prohibited actions.
2. `access=read_only` only allows reading, searching, and analysis.
3. `access=edit` allows Grok to edit files and run safe commands in the target workspace; requires explicit `confirm_write=true`.
4. Edit mode denies `rm`, `sudo`, `git push`, `git reset`, `git clean`, `gh pr`, `osascript`, `open`, and similar high-risk or external actions by default.
5. If `GROK_ROUTER_ALLOWED_ROOTS` is set, the target must be inside one of them; without it, edit mode only allows non-root, non-home Git repositories.
6. After Grok finishes, the calling agent should review changes, run necessary tests, and report to the user. Don't treat Grok's "done" as verified.

## Model rules

- Default model is auto-detected from the Grok CLI (`grok models` → `Default model:`). Falls back to `grok-4.6` if detection fails.
- `grok-build-0.1` is accepted as a compatibility alias; if the CLI doesn't expose it natively, the tool falls back to the detected default and reports the actual model used.
- Set `GROK_ROUTER_STRICT_MODELS=1` to disable fallback.
- The tool never silently falls back to GPT, Claude, or other providers.

## Failure handling

- CLI not found: prompt user to install the official Grok Build CLI.
- Not logged in: prompt `grok login`.
- 403 or quota exhausted: report the Grok account's quota issue; don't auto-switch accounts or models.
- Timeout: return the timeout; don't re-submit tasks that may produce writes.
- Edit task failure: check the actual workspace diff; don't assume no partial modifications.

## References

- Installation, configuration, verification, and rollback: read [references/operations.md](references/operations.md).
- Architecture and security boundaries: read [references/architecture.md](references/architecture.md).
- Local environment diagnostics: run `node scripts/doctor.mjs`.
