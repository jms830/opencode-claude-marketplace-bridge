# Claude Marketplace Bridge Plugin for OpenCode

> **Note**: For a cross-agent solution that works with Claude, OpenCode, Codex, and Gemini, see [agent-plugins](https://github.com/jordan/agent-plugins) - a universal plugin manager that mirrors Claude's plugin system.

This plugin bridges Claude Code's entire plugin/marketplace ecosystem into OpenCode, giving you full access to:

1. **All your Claude marketplaces** (commands, skills, agents)
2. **Claude CLI management tools** (install, uninstall, update marketplaces/plugins)
3. **MCP server management** (add, remove, list MCP servers)

## Features

### Dynamic Content Discovery
- Scans `~/.claude/plugins/marketplaces/` on startup
- Registers all commands from `commands/` and `workflows/` directories as tools
- Registers all `SKILL.md` skills as tools
- No file copying or symlinking - pure dynamic discovery
- Always current (reads files at runtime)

### Claude CLI Management
Full access to Claude Code's CLI commands from within OpenCode:

**Marketplace Management:**
- `claude_marketplace_list` - List all configured marketplaces
- `claude_marketplace_add` - Add a marketplace from GitHub/URL/path
- `claude_marketplace_remove` - Remove a marketplace
- `claude_marketplace_update` - Update marketplace(s) from source

**Plugin Management:**
- `claude_plugin_install` - Install a plugin from marketplaces
- `claude_plugin_uninstall` - Uninstall a plugin
- `claude_plugin_enable` - Enable a disabled plugin
- `claude_plugin_disable` - Disable a plugin
- `claude_plugin_validate` - Validate plugin/marketplace manifest

**MCP Server Management:**
- `claude_mcp_list` - List configured MCP servers
- `claude_mcp_add` - Add an MCP server
- `claude_mcp_remove` - Remove an MCP server
- `claude_mcp_get` - Get details about an MCP server

### Search & Discovery
- `claude_marketplace_refresh` - Rediscover all content
- `claude_search_commands` - Search commands by name/description
- `claude_search_skills` - Search skills by name/description

## Usage Examples

### Managing Marketplaces

```
"List my Claude marketplaces"
→ Uses claude_marketplace_list

"Add the anthropic skills marketplace"
→ Uses claude_marketplace_add with source: "anthropics/skills"

"Update all my marketplaces"
→ Uses claude_marketplace_update
```

### Installing Plugins

```
"Install the brand-guidelines plugin"
→ Uses claude_plugin_install

"Install code-review from personal-dev-toolkit"
→ Uses claude_plugin_install with plugin: "code-review@personal-dev-toolkit"
```

### Using Commands & Skills

```
"Search for code review commands"
→ Uses claude_search_commands with query: "code review"

"Use the brand guidelines skill"
→ Uses claude_skill_brand_guidelines_anthropic_agent_skills

"Run the commit command from my personal toolkit"
→ Uses claude_cmd_commit@personal_dev_toolkit
```

### Managing MCP Servers

```
"List my MCP servers"
→ Uses claude_mcp_list

"Add the Sentry MCP server"
→ Uses claude_mcp_add
```

## Tool Naming Convention

**Commands:** `claude_cmd_<command_name>@<marketplace>`
- Example: `claude_cmd_code_review@personal_dev_toolkit`

**Skills:** `claude_skill_<skill_name>_<marketplace>`
- Example: `claude_skill_brand_guidelines_anthropic_agent_skills`

**Management:** `claude_<category>_<action>`
- Example: `claude_marketplace_add`, `claude_plugin_install`, `claude_mcp_list`

## Requirements

- Claude Code CLI installed (`claude` command available)
- Claude marketplaces directory at `~/.claude/plugins/marketplaces/`
- Dependencies: `gray-matter` (for parsing markdown frontmatter)

## How It Works

1. **On OpenCode startup:**
   - Scans all marketplaces under `~/.claude/plugins/marketplaces/`
   - Parses all `.md` files in `commands/` and `workflows/` directories
   - Parses all `SKILL.md` files
   - Registers everything as dynamic tools

2. **For CLI commands:**
   - Wraps the `claude` CLI using `execSync`
   - Captures output and returns it to OpenCode
   - Handles errors gracefully

3. **For content execution:**
   - Uses OpenCode's `client.message.create()` with `noReply: true`
   - Content persists in conversation (not purged like tool responses)
   - Supports $ARGUMENTS and positional parameter substitution

## Comparison: Direct Claude vs This Plugin

| Feature | Direct Claude CLI | This Plugin |
|---------|------------------|-------------|
| Marketplace management | ✅ Full | ✅ Full (via CLI wrapper) |
| Plugin management | ✅ Full | ✅ Full (via CLI wrapper) |
| MCP management | ✅ Full | ✅ Full (via CLI wrapper) |
| Use commands in conversation | ❌ Must run separately | ✅ Integrated as tools |
| Use skills in conversation | ❌ Must run separately | ✅ Integrated as tools |
| Search content | ❌ Manual | ✅ Built-in search |
| Works in OpenCode TUI | ❌ No | ✅ Yes |

## Installation

The plugin is installed at:
```
~/.config/opencode/plugin/claude-marketplace-bridge.js
```

Dependencies in `~/.config/opencode/package.json`:
```json
{
  "dependencies": {
    "gray-matter": "^4.0.3"
  }
}
```

OpenCode automatically loads plugins from the `plugin/` directory.

## Troubleshooting

**Plugin not loading?**
- Check for `[claude-bridge]` messages in console
- Verify the plugin file exists
- Ensure `gray-matter` is installed: `cd ~/.config/opencode && npm install gray-matter`

**Claude CLI commands failing?**
- Verify Claude Code is installed: `claude --version`
- Check Claude authentication: `claude doctor`

**Content not discovered?**
- Verify marketplaces exist: `ls ~/.claude/plugins/marketplaces/`
- Check marketplace structure has `commands/` or `workflows/` directories
- Use `claude_marketplace_refresh` to see what's found

**After installing new plugins:**
- Restart OpenCode to pick up new content
- Or use `claude_marketplace_refresh` to see new content (requires restart to activate tools)

## Contributing

This plugin can be published to npm as `opencode-claude-bridge` for community use. The core concept is:

1. Use Claude Code CLI for marketplace/plugin management
2. Dynamically discover and register content as OpenCode tools
3. Bridge the two ecosystems seamlessly

Pull requests welcome!

## License

MIT
