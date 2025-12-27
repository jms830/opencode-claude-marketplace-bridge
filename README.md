# Claude Management Tools for OpenCode

> **Architecture Change (Dec 2024):** With [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) v2.6+ now loading Claude plugins directly, this plugin's role has shifted from "content bridge" to **"management tools"**. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## What This Plugin Does

This plugin provides **Claude CLI management tools** from within OpenCode, letting you:

1. **Manage Marketplaces** - Add, update, remove Claude marketplaces
2. **Install/Uninstall Plugins** - Manage Claude plugins without leaving OpenCode
3. **Configure MCP Servers** - Add/remove MCP servers via Claude CLI
4. **Access Claude's `/plugin` TUI** - Launch interactive sessions via tmux
5. **Search & Discover** - Find plugins across marketplaces before installing

## Do You Need This Plugin?

| Your Setup | This Plugin | Recommendation |
|------------|-------------|----------------|
| oh-my-opencode + happy switching to Claude CLI | **Optional** | Skip it |
| oh-my-opencode + want management from OpenCode | **Useful** | Install it |
| OpenCode without oh-my-opencode | **Required** | Install both |

**If you use oh-my-opencode v2.6+**, it already handles:
- ✅ Loading skills from `~/.claude/skills/`
- ✅ Loading commands from `~/.claude/commands/`
- ✅ Loading agents from `~/.claude/agents/`
- ✅ Loading plugins from `~/.claude/plugins/`
- ✅ MCP configuration from `.mcp.json`
- ✅ Hooks from `settings.json`

**This plugin adds** what oh-my-opencode doesn't do:
- 🔧 `claude plugin install/uninstall` from OpenCode
- 🔧 `claude marketplace add/update` from OpenCode
- 🔧 `claude mcp add/remove` from OpenCode
- 🖥️ Interactive `/plugin` TUI access via tmux
- 🔍 Search across available (not-yet-installed) plugins

## Features

### Marketplace Management

```
"List my Claude marketplaces"
→ Uses claude_marketplace_list

"Add the anthropic skills marketplace"
→ Uses claude_marketplace_add with source: "anthropics/skills"

"Update all my marketplaces"
→ Uses claude_marketplace_update
```

- `claude_marketplace_list` - List all configured marketplaces
- `claude_marketplace_add` - Add a marketplace from GitHub/URL/path
- `claude_marketplace_remove` - Remove a marketplace
- `claude_marketplace_update` - Update marketplace(s) from source

### Plugin Management

```
"Install the code-review plugin"
→ Uses claude_plugin_install

"Uninstall brand-guidelines"
→ Uses claude_plugin_uninstall
```

- `claude_plugin_install` - Install a plugin (use `plugin@marketplace` for specific source)
- `claude_plugin_uninstall` - Uninstall a plugin
- `claude_plugin_enable` - Enable a disabled plugin
- `claude_plugin_disable` - Disable a plugin
- `claude_plugin_validate` - Validate a plugin manifest

### MCP Server Management

```
"Add the Sentry MCP server"
→ Uses claude_mcp_add

"List my MCP servers"
→ Uses claude_mcp_list
```

- `claude_mcp_list` - List configured MCP servers
- `claude_mcp_add` - Add an MCP server (stdio/http/sse)
- `claude_mcp_remove` - Remove an MCP server
- `claude_mcp_get` - Get details about a specific server

### Interactive TUI Access (via tmux)

**The killer feature**: Access Claude's `/plugin` browser from OpenCode!

```
"Open Claude's plugin browser"
→ Uses claude_interactive with command: "/plugin"
→ Opens in tmux session, attach with: tmux attach -t claude-xxx
```

- `claude_interactive` - Run any Claude CLI command interactively
- `claude_run` - Run marketplace commands (supports `interactive=true`)
- `claude_tmux_list` - List active Claude tmux sessions
- `claude_tmux_kill` - Kill a specific session
- `claude_tmux_kill_all` - Kill all Claude sessions

**Requires tmux** - Install with:
- macOS: `brew install tmux`
- Ubuntu/Debian: `sudo apt-get install tmux`
- Fedora: `sudo dnf install tmux`

### Search & Discovery

```
"Search for code review plugins"
→ Uses claude_search_commands with query: "code review"

"What skills are available?"
→ Uses claude_search_skills
```

- `claude_search_commands` - Search commands by name/description
- `claude_search_skills` - Search skills by name/description
- `claude_marketplace_refresh` - Rediscover all available content
- `claude_list` - List all commands grouped by marketplace

## Installation


### With oh-my-opencode (Recommended)

1. **Install oh-my-opencode** (handles content loading):
   ```json
   // ~/.config/opencode/opencode.json
   {
     "plugin": ["oh-my-opencode@latest"]
   }
   ```

2. **Add this plugin** (for management tools):
   ```bash
   cd ~/.config/opencode
   npm install opencode-claude-marketplace-bridge
   ```

3. **Register in opencode.json**:
   ```json
   {
     "plugin": [
       "oh-my-opencode@latest",
       "./node_modules/opencode-claude-marketplace-bridge"
     ]
   }
   ```

### Without oh-my-opencode

If you're not using oh-my-opencode, this plugin provides both content discovery AND management. However, we recommend using oh-my-opencode for the best experience.

## Requirements

- **Claude Code CLI** installed (`claude` command available)
- **tmux** (optional, for interactive features)
- **Node.js** 18+

Verify Claude is installed:
```bash
claude --version
claude doctor
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                               │
│  Source of truth: ~/.claude/plugins/, skills/, commands/        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      oh-my-opencode                              │
│  Loads content into OpenCode (skills, commands, agents, MCP)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              This Plugin (Management Tools)                      │
│  CLI wrappers + Interactive TUI + Search/Discovery              │
└─────────────────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for comprehensive documentation.

## Comparison: What Each Project Does

| Capability | Claude Code | oh-my-opencode | This Plugin |
|------------|-------------|----------------|-------------|
| Plugin TUI browser | ✅ `/plugin` | ❌ | ✅ via tmux |
| Load skills/commands | ✅ | ✅ | ❌ (deferred) |
| Load plugins | ✅ | ✅ v2.6+ | ❌ (deferred) |
| Install plugins | ✅ CLI | ❌ | ✅ wrapper |
| Manage marketplaces | ✅ CLI | ❌ | ✅ wrapper |
| Manage MCP | ✅ CLI | ❌ | ✅ wrapper |
| Search plugins | ✅ TUI | ❌ | ✅ tools |

## Related Projects

| Project | Role | URL |
|---------|------|-----|
| Claude Code | Primary plugin manager | https://claude.ai/code |
| oh-my-opencode | Content loader (recommended) | https://github.com/code-yeongyu/oh-my-opencode |
| OpenCode | Open-source AI coding agent | https://github.com/sst/opencode |

## Troubleshooting

**Plugin not loading?**
- Check for `[claude-bridge]` messages in console
- Ensure dependencies installed: `npm install`

**Claude CLI commands failing?**
- Verify Claude is installed: `claude --version`
- Check authentication: `claude doctor`

**Interactive commands not working?**
- Install tmux (see requirements above)
- Check for existing sessions: `tmux list-sessions`

## License

MIT
