# Claude Plugin Browser for OpenCode

> Launch Claude's plugin marketplace directly from OpenCode.

## What This Does

One command: Opens Claude's `/plugin` marketplace browser in a tmux session.

```
"Open the plugin browser"
→ claude_plugin_browser
→ Launches marketplace TUI
→ Attach, browse, install, done
```

## Requirements

- **[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)** - Loads installed plugins into OpenCode
- **Claude Code CLI** - `claude` command
- **tmux** - For the interactive session

```bash
# Install tmux
brew install tmux        # macOS
sudo apt install tmux    # Ubuntu/Debian
```

## Installation

```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "opencode-claude-marketplace-bridge"
  ]
}
```

## Usage

### Browse & Install Plugins
```
"Open Claude's plugin marketplace"
```

Then:
```bash
tmux attach -t claude-plugins-xxx
```

Navigate, install what you need, exit. Restart OpenCode to load new plugins.

### Manage Sessions
```
"List Claude sessions"     → claude_sessions action="list"
"Kill all sessions"        → claude_sessions action="kill-all"
```

## Tools

| Tool | Description |
|------|-------------|
| `claude_plugin_browser` | Launch `/plugin` marketplace in tmux |
| `claude_sessions` | List/kill tmux sessions |

## How It Works

```
claude "/plugin"  →  Marketplace TUI  →  Install  →  oh-my-opencode loads it
```

That's it. 131 lines of code.

## Why tmux?

OpenCode runs in your terminal. To show Claude's TUI, we need a separate terminal context. tmux provides that cleanly - attach when needed, detach when done.

## License

MIT
