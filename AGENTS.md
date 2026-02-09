# AGENTS.md - Coding Agent Guidelines

## What This Plugin Does

Provides native plugin marketplace operations inside OpenCode by reading Claude Code's plugin data files and delegating lifecycle mutations to Claude CLI.

## Architecture

See `docs/ARCHITECTURE.md` for ecosystem context.

```
OpenCode tool call
  -> read ~/.claude/plugins/*.json
  -> optional claude plugin ... mutation
  -> post-action verification against JSON state
```

## Build & Run

- Install: `npm install`
- Smoke load: `node -e "import('./index.js').then(m => m.default({}).then(h => console.log(Object.keys(h.tool))))"`

## Code Style

- ES Modules (`"type": "module"`)
- 2-space indent
- Minimal dependencies (`@opencode-ai/plugin` + Node built-ins)

## Tools Provided

| Tool | Purpose |
|------|---------|
| `plugin_search` | Search marketplace plugins |
| `plugin_info` | Detailed plugin metadata |
| `plugin_list` | Installed plugin listing |
| `plugin_status` | Plugin system dashboard |
| `plugin_install` | Install with verification |
| `plugin_uninstall` | Uninstall with verification |
| `plugin_enable` | Enable with verification |
| `plugin_disable` | Disable with verification |
| `marketplace_list` | List marketplaces |
| `marketplace_add` | Add marketplace with verification |
| `marketplace_update` | Update marketplace(s) with verification |
| `marketplace_remove` | Remove marketplace with verification |

## Verification Rule

For every mutating operation, verify expected post-state from `known_marketplaces.json` or `installed_plugins.json`. Never report success based only on CLI exit code.
