# AGENTS.md - Coding Agent Guidelines

## What This Plugin Does

Launches Claude's `/plugin` marketplace browser from OpenCode via tmux.

**That's it.** Content loading is handled by oh-my-opencode.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full context on the Claude-first ecosystem.

```
claude "/plugin"  →  TUI in tmux  →  User installs  →  oh-my-opencode loads
```

## Build & Run

- **Install:** `npm install`
- **Test:** `node -e "import('./index.js').then(m => console.log('OK'))"`

## Code Style

- ES Modules (`"type": "module"`)
- 2-space indent
- Minimal dependencies (just `@opencode-ai/plugin`)

## Tools Provided

| Tool | Purpose |
|------|---------|
| `claude_plugin_browser` | Launch `/plugin` TUI in tmux |
| `claude_sessions` | List/kill tmux sessions |

## Key Implementation

```javascript
execSync(`tmux new-session -d -s "${sessionName}" 'claude "/plugin"'`)
```

The `/plugin` argument is passed directly to Claude, which opens the marketplace.
