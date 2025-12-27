# AGENTS.md - Coding Agent Guidelines

## Architecture

> **Important:** See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the comprehensive architecture documentation describing the Claude-first plugin ecosystem approach.

**TL;DR:** Claude Code is the single source of truth for plugins/skills. oh-my-opencode bridges Claude's ecosystem to OpenCode automatically. This plugin provides supplementary CLI wrappers.

## Project Status

This plugin's role has been **simplified**:

| If you use... | This plugin is... |
|---------------|-------------------|
| oh-my-opencode | Optional (oh-my-opencode handles Claude bridging) |
| OpenCode without oh-my-opencode | Useful for Claude CLI access |
| Only Claude Code | Not needed |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details on the simplified architecture.

---

## Build & Run Commands

- **Install:** `npm install`
- **Run test:** `node -e "import('./index.js').then(m => m.ClaudeMarketplaceBridge({client:{},\$:{}}))"` (no test framework)
- **Lint:** None configured

## Code Style

- **Module type:** ES Modules (`"type": "module"` in package.json)
- **Imports:** Use explicit `.js` extension for local imports; use `@opencode-ai/plugin/tool` subpath import
- **Formatting:** 2-space indent, semicolons used
- **Naming:** camelCase for functions/variables, PascalCase for exports (e.g., `ClaudeMarketplaceBridge`)
- **Types:** Plain JavaScript with JSDoc comments where helpful
- **Error handling:** Use try/catch, log errors with `console.error("[claude-bridge] ...")`, return gracefully

## Key Patterns

- **Tool names:** Max 64 chars, pattern `^[a-zA-Z0-9_-]+$`, use `__` as namespace separator
- **CLI wrapper:** Use `execSync` with timeout, return `{ success, output, error }` objects
- **Async generators:** `async function* walk(dir)` for directory traversal
- **Tool registration:** Use `tool()` from `@opencode-ai/plugin/tool` with `tool.schema` for Zod schemas

## Plugin Usage

- `claude_run <command>` - Run command by name (e.g., `claude_run commit`)
- `claude_list` - List all commands by marketplace
- `claude_search_commands <query>` - Search commands
- `claude_plugin_install <name>` - Install a plugin via Claude CLI
- `claude_marketplace_add <source>` - Add a marketplace

## Related Projects

| Project | Role | URL |
|---------|------|-----|
| Claude Code | Primary plugin manager (source of truth) | https://claude.ai/code |
| oh-my-opencode | Claude→OpenCode bridge (recommended) | https://github.com/code-yeongyu/oh-my-opencode |
| agent-plugins | Cross-agent sync (Codex, Gemini, etc.) | https://github.com/jms830/agent-plugins |
| OpenCode | Open-source AI coding agent | https://github.com/sst/opencode |

## Directory Structure

```
~/.claude/                    # Source of truth (Claude manages)
├── skills/                   # oh-my-opencode scans here
├── commands/                 # oh-my-opencode scans here
├── agents/                   # oh-my-opencode scans here
├── plugins/cache/            # Installed plugin content
└── plugins/marketplaces/     # Cloned marketplace repos

~/.config/opencode/           # OpenCode config
├── opencode.json             # Include oh-my-opencode in plugins
└── plugin/                   # This bridge (optional)
```
