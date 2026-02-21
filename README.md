# opencode-claude-marketplace-bridge

[![npm version](https://img.shields.io/npm/v/opencode-claude-marketplace-bridge.svg)](https://www.npmjs.com/package/opencode-claude-marketplace-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Browse, inspect, and manage Claude Code plugins from OpenCode without leaving the conversation.

This plugin reads the same data Claude Code uses under `~/.claude/plugins/` and delegates mutating operations to the Claude CLI (`claude plugin ...`).

## Why this exists

OpenCode does not yet have Claude Code's native `/plugin` marketplace UX in core. This bridge provides native discovery and management tools while staying fully compatible with Claude Code's plugin system.

## Installation

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-claude-marketplace-bridge@latest"
  ]
}
```

That's it — OpenCode will install the plugin automatically on next startup.

### Requirements

- [OpenCode](https://github.com/sst/opencode) with plugin support
- [Claude Code CLI](https://claude.ai/code) (`claude` command in PATH) — required for install/uninstall/update operations

## Tools Provided

| Tool | Purpose |
|------|---------|
| `plugin_search` | Search available plugins across marketplaces |
| `plugin_info` | Inspect plugin metadata and install details |
| `plugin_list` | List installed plugins |
| `plugin_status` | Show plugin system health and marketplace coverage |
| `plugin_install` | Install via Claude CLI + file-state verification |
| `plugin_uninstall` | Uninstall via Claude CLI + file-state verification |
| `plugin_update` | Update single plugin to latest + version/timestamp verification |
| `plugin_enable` | Enable via Claude CLI + output verification |
| `plugin_disable` | Disable via Claude CLI + output verification |
| `marketplace_list` | List registered marketplaces |
| `marketplace_add` | Add marketplace via Claude CLI + verification |
| `marketplace_update` | Update marketplace(s) via Claude CLI + verification |
| `marketplace_remove` | Remove marketplace via Claude CLI + verification |
| `update_all` | Update all marketplaces + all plugins in one shot |

## Usage Examples

```text
# Discover plugins
> plugin_search query="code review"

# Get details
> plugin_info plugin="feature-dev@claude-plugins-official"

# Install
> plugin_install plugin="feature-dev@claude-plugins-official"

# Update everything
> update_all

# Check system status
> plugin_status
```

## Verification Model

Mutating tools always execute in two phases:

1. Run Claude CLI (`claude plugin ...`)
2. Re-read `~/.claude/plugins/*.json` and verify expected state transition

If CLI success does not match on-disk state, tools return an explicit warning instead of silently claiming success.

## Development

```bash
# Install dependencies
npm install

# Smoke test
node -e "import('./index.js').then(m => m.default({}).then(h => console.log(Object.keys(h.tool))))"
```

For local development, use a file:// path in your opencode.json:

```json
{
  "plugin": [
    "file:///path/to/opencode-claude-marketplace-bridge"
  ]
}
```

## License

MIT
