# Native Plugin Marketplace for OpenCode

Browse, inspect, and manage Claude Code plugins from OpenCode without leaving the conversation.

This plugin reads the same data Claude Code uses under `~/.claude/plugins/` and delegates mutating operations to the Claude CLI (`claude plugin ...`).

## Why this exists

OpenCode does not yet have Claude Code's native `/plugin` marketplace UX in core. This bridge provides native discovery and management tools while staying fully compatible with Claude Code's plugin system.

## What it provides

| Tool | Purpose |
|------|---------|
| `plugin_search` | Search available plugins across marketplaces |
| `plugin_info` | Inspect plugin metadata and install details |
| `plugin_list` | List installed plugins |
| `plugin_status` | Show plugin system health and marketplace coverage |
| `plugin_install` | Install via Claude CLI + file-state verification |
| `plugin_uninstall` | Uninstall via Claude CLI + file-state verification |
| `plugin_enable` | Enable via Claude CLI + output verification |
| `plugin_disable` | Disable via Claude CLI + output verification |
| `marketplace_list` | List registered marketplaces |
| `marketplace_add` | Add marketplace via Claude CLI + verification |
| `marketplace_update` | Update marketplace(s) via Claude CLI + verification |
| `marketplace_remove` | Remove marketplace via Claude CLI + verification |

## Verification model

Mutating tools always execute in two phases:

1. Run Claude CLI (`claude plugin ...`)
2. Re-read `~/.claude/plugins/*.json` and verify expected state transition

If CLI success does not match on-disk state, tools return an explicit warning instead of silently claiming success.

## Requirements

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)
- Claude Code CLI (`claude` command in PATH)
- OpenCode with plugin support

## Installation

In `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "opencode-claude-marketplace-bridge"
  ]
}
```

For local development:

```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "/home/jordans/github/opencode-claude-marketplace-bridge"
  ]
}
```

## Command workflow

Use `/plugin` in OpenCode (if your command file routes to these tools), then:

- discover: `plugin_search`
- inspect: `plugin_info plugin="feature-dev@claude-plugins-official"`
- install: `plugin_install plugin="feature-dev@claude-plugins-official"`
- check status: `plugin_status`

## Development

```bash
npm install
node -e "import('./index.js').then(m => m.default({}).then(h => console.log(Object.keys(h.tool))))"
```

## License

MIT
