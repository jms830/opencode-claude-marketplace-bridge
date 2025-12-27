# Architecture: Claude-First Plugin Ecosystem

> **Last Updated:** December 2024
> **Status:** Active - Simplified Architecture

This document describes the simplified architecture for managing AI coding agent plugins across Claude Code and OpenCode, with Claude as the single source of truth.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Decision](#architecture-decision)
3. [Directory Structure](#directory-structure)
4. [How It Works](#how-it-works)
5. [Component Responsibilities](#component-responsibilities)
6. [Related Projects](#related-projects)
7. [Migration Guide](#migration-guide)
8. [FAQ](#faq)

---

## Executive Summary

### The Problem

Previously, we explored multiple approaches to share plugins/skills across AI coding agents:

- **agent-plugins** (`~/.agent/`): Universal plugin manager with symlinks to each agent
- **opencode-claude-marketplace-bridge**: OpenCode plugin wrapping Claude CLI
- **oh-my-opencode**: OpenCode plugin with Claude Code compatibility layer

This created complexity:
- Multiple symlink chains (`~/.agent/` → `~/.claude/` → `~/.config/opencode/`)
- Duplicate registries and caches
- Unclear source of truth for installed plugins
- Maintenance burden across multiple projects

### The Solution

**Claude Code is the single source of truth.**

```
~/.claude/                          # PRIMARY - Claude manages everything
├── skills/                         # All skills live here
├── commands/                       # All commands
├── agents/                         # All agents
├── plugins/                        # Plugin cache & marketplaces
│   ├── cache/                      # Installed plugin content
│   └── marketplaces/               # Cloned marketplace repos
└── settings.json                   # Hooks configuration

oh-my-opencode (OpenCode plugin)
└── Reads ~/.claude/* → Exposes to OpenCode automatically
```

**Benefits:**
1. Claude's native `/plugin` command handles all marketplace browsing & installation
2. oh-my-opencode automatically imports Claude's skills/commands/agents to OpenCode
3. No symlinks, no duplicate directories, no sync issues
4. Works in any terminal (WezTerm, iTerm2, Alacritty, etc.)

---

## Architecture Decision

### Why Claude as Source of Truth?

| Factor | Claude-First | OpenCode-First | agent-plugins (~/.agent/) |
|--------|-------------|----------------|---------------------------|
| Native TUI browsing | ✅ `/plugin` command | ❌ None | ❌ CLI only |
| Marketplace ecosystem | ✅ Mature, growing | ❌ Limited | ⚠️ Mirrors Claude |
| Plugin installation | ✅ Built-in | ❌ Manual | ⚠️ Wraps Claude |
| Cross-agent support | ⚠️ Needs bridge | ✅ Native | ✅ Native |
| Maintenance burden | ✅ Low (Anthropic maintains) | ⚠️ Medium | ❌ High (custom sync) |

**Decision:** Use Claude Code's plugin system as the canonical source, bridge to OpenCode via oh-my-opencode.

### What This Means for Each Project

| Project | New Role | Status |
|---------|----------|--------|
| **Claude Code** | Primary plugin manager | ✅ Use as-is |
| **oh-my-opencode** | Bridge layer (Claude → OpenCode) | ✅ Already handles this |
| **opencode-claude-marketplace-bridge** | Supplementary tools (CLI wrappers) | ⚠️ Reduced scope - see below |
| **agent-plugins** | Optional: sync to other agents (Codex, Gemini) | ⚠️ Simplified role |

---

## Directory Structure

### Claude Code (Source of Truth)

```
~/.claude/
├── CLAUDE.md                       # Global instructions
├── settings.json                   # Hooks, permissions
├── skills/                         # User-installed skills
│   └── my-skill/
│       └── SKILL.md
├── commands/                       # User slash commands
│   └── my-command.md
├── agents/                         # Custom agent definitions
│   └── my-agent.md
├── plugins/
│   ├── cache/                      # Installed plugin content
│   │   ├── anthropic-agent-skills/
│   │   ├── claude-code-plugins/
│   │   └── superpowers-marketplace/
│   ├── marketplaces/               # Cloned marketplace repos
│   │   ├── anthropic-agent-skills/
│   │   └── personal-dev-toolkit/
│   ├── installed_plugins.json      # Installation registry
│   └── known_marketplaces.json     # Marketplace registry
└── .mcp.json                       # MCP server configuration
```

### OpenCode (Receives from oh-my-opencode)

```
~/.config/opencode/
├── opencode.json                   # Config with oh-my-opencode plugin
├── command/                        # OpenCode-native commands (optional)
├── agent/                          # OpenCode-native agents (optional)
└── plugin/                         # OpenCode plugins (JS)
    └── (this bridge, if needed)

# oh-my-opencode automatically reads:
# - ~/.claude/skills/*/SKILL.md
# - ~/.claude/commands/*.md
# - ~/.claude/agents/*.md
# - ~/.claude/.mcp.json
# - ~/.claude/settings.json (hooks)
```

### What oh-my-opencode Scans

From [oh-my-opencode documentation](https://github.com/code-yeongyu/oh-my-opencode):

| Content Type | Directories Scanned |
|--------------|---------------------|
| **Skills** | `~/.claude/skills/*/SKILL.md`, `./.claude/skills/*/SKILL.md` |
| **Commands** | `~/.claude/commands/`, `./.claude/commands/`, `~/.config/opencode/command/`, `./.opencode/command/` |
| **Agents** | `~/.claude/agents/*.md`, `./.claude/agents/*.md` |
| **MCPs** | `~/.claude/.mcp.json`, `./.mcp.json`, `./.claude/.mcp.json` |
| **Hooks** | `~/.claude/settings.json`, `./.claude/settings.json`, `./.claude/settings.local.json` |

---

## How It Works

### Workflow: Installing a Plugin

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER: Browse/install plugins                                 │
│    $ claude                                                     │
│    > /plugin                        # Opens TUI browser         │
│    > (select and install plugin)                                │
│                                                                 │
│ 2. CLAUDE: Installs to ~/.claude/plugins/cache/                 │
│    - Downloads plugin content                                   │
│    - Extracts skills/commands/agents                            │
│    - Updates installed_plugins.json                             │
│                                                                 │
│ 3. OH-MY-OPENCODE: Auto-discovers on next OpenCode session      │
│    - Scans ~/.claude/skills/                                    │
│    - Registers as OpenCode tools                                │
│    - No manual sync required                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Workflow: Using Skills in OpenCode

```
┌─────────────────────────────────────────────────────────────────┐
│ USER in OpenCode:                                               │
│ > "Use the code-review skill to analyze this file"              │
│                                                                 │
│ OH-MY-OPENCODE:                                                 │
│ 1. Skill already loaded from ~/.claude/skills/code-review/      │
│ 2. Injects SKILL.md content into conversation                   │
│ 3. Agent follows skill instructions                             │
│                                                                 │
│ No bridge plugin needed - oh-my-opencode handles it natively!   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### Claude Code

**Role:** Primary plugin manager and source of truth

**Responsibilities:**
- Marketplace discovery and browsing (`/plugin` TUI)
- Plugin installation, updates, uninstallation
- Plugin cache management (`~/.claude/plugins/cache/`)
- Marketplace registry (`~/.claude/plugins/marketplaces/`)

**Commands:**
```bash
claude                              # Start Claude Code
/plugin                             # Browse marketplaces (TUI)
/plugin install <name>              # Install plugin
/plugin uninstall <name>            # Uninstall plugin
/marketplace add <source>           # Add marketplace
/marketplace update                 # Update all marketplaces
```

### oh-my-opencode

**Role:** Claude Code compatibility layer for OpenCode

**Responsibilities:**
- Scan Claude directories on OpenCode startup
- Register skills/commands/agents as OpenCode tools
- Load MCP configurations from Claude's `.mcp.json`
- Execute Claude-style hooks (PreToolUse, PostToolUse, etc.)
- Provide background agents, LSP tools, and other enhancements

**Key Features:**
- Zero configuration - works out of the box
- Async subagents (like Claude Code)
- Claude Code hook compatibility
- Built-in MCPs (Context7, Exa, grep.app)

**Installation:**
```json
// ~/.config/opencode/opencode.json
{
  "plugin": ["oh-my-opencode@latest"]
}
```

### opencode-claude-marketplace-bridge (This Project)

**Role:** Supplementary CLI wrappers (reduced scope)

**When to Use:**
- If you need to manage Claude plugins from within OpenCode conversation
- If oh-my-opencode doesn't scan a specific directory you need
- If you want to search/discover plugins without leaving OpenCode

**Current Status:**
Given oh-my-opencode's comprehensive Claude compatibility layer, this plugin's role is now supplementary rather than essential. Consider:

1. **If using oh-my-opencode:** This plugin may be redundant for most use cases
2. **If NOT using oh-my-opencode:** This plugin provides Claude CLI access

**Tools Provided:**
```
claude_marketplace_list             # List marketplaces
claude_marketplace_add              # Add marketplace
claude_plugin_install               # Install plugin
claude_search_commands              # Search commands
claude_search_skills                # Search skills
```

### agent-plugins (Simplified Role)

**Role:** Optional sync to non-Claude/OpenCode agents

**When to Use:**
- Syncing plugins to Codex CLI, Gemini CLI, Cursor, etc.
- Cross-agent plugin management beyond Claude/OpenCode

**If only using Claude + OpenCode:** agent-plugins is not needed. oh-my-opencode handles the bridge.

---

## Related Projects

### Session Management Patterns

Research into how other projects handle multi-agent sessions:

| Project | Approach | Key Features |
|---------|----------|--------------|
| [claude-squad](https://github.com/smtg-ai/claude-squad) | Go binary + tmux | Git worktrees, visual TUI, multi-agent |
| [claunch](https://github.com/0xkaz/claunch) | Bash + optional tmux | Session persistence, project-based |
| [ccmanager](https://github.com/kbwo/ccmanager) | Node.js + node-pty | No tmux, real-time state detection |
| [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) | OpenCode plugin | Full Claude compatibility, async agents |

### Related Tools

| Tool | Purpose | URL |
|------|---------|-----|
| Claude Code | AI coding agent | https://claude.ai/code |
| OpenCode | Open-source Claude alternative | https://github.com/sst/opencode |
| oh-my-opencode | OpenCode plugin ecosystem | https://github.com/code-yeongyu/oh-my-opencode |
| agent-plugins | Universal plugin manager | https://github.com/jms830/agent-plugins |

---

## Migration Guide

### From agent-plugins (~/.agent/) to Claude-First

1. **Verify oh-my-opencode is installed:**
   ```json
   // ~/.config/opencode/opencode.json
   {
     "plugin": ["oh-my-opencode@latest"]
   }
   ```

2. **Move user skills to Claude directory:**
   ```bash
   # If you have skills in ~/.agent/skills/
   mv ~/.agent/skills/* ~/.claude/skills/
   ```

3. **Move user commands to Claude directory:**
   ```bash
   # If you have commands in ~/.agent/commands/
   mv ~/.agent/commands/* ~/.claude/commands/
   ```

4. **Remove symlinks (optional cleanup):**
   ```bash
   # Check what's symlinked
   ls -la ~/.claude/plugins/
   
   # Remove symlinks if they point to ~/.agent/
   # (only after verifying content is in ~/.claude/)
   ```

5. **Test in OpenCode:**
   ```bash
   opencode
   # Skills should be available via oh-my-opencode
   ```

### Keep Using agent-plugins For

- Syncing to Codex CLI (`~/.codex/`)
- Syncing to Gemini CLI (`~/.gemini/`)
- Syncing to other agents not covered by oh-my-opencode

---

## FAQ

### Q: Do I still need this plugin (opencode-claude-marketplace-bridge)?

**A:** Probably not, if you're using oh-my-opencode. It provides:
- Claude skill/command/agent loading ✅
- Claude hook execution ✅
- Claude MCP loading ✅

This plugin adds CLI wrappers for marketplace management, which you can do directly in Claude Code.

### Q: What about the plugin cache in ~/.claude/plugins/cache/?

**A:** oh-my-opencode scans `~/.claude/skills/` (user-installed skills), not the plugin cache. However, when Claude installs a plugin, it typically extracts skills to `~/.claude/skills/`. Verify your specific plugin's installation behavior.

### Q: Can I use both Claude Code and OpenCode with the same skills?

**A:** Yes! That's the point of this architecture:
- Skills live in `~/.claude/skills/`
- Claude Code reads them natively
- oh-my-opencode reads them for OpenCode
- No duplication, no sync issues

### Q: What if oh-my-opencode doesn't see my installed plugins?

**A:** Check where the plugin installed its content:
```bash
# User skills (oh-my-opencode scans here)
ls ~/.claude/skills/

# Plugin cache (may need manual symlink or copy)
ls ~/.claude/plugins/cache/
```

If skills are in the cache but not in `~/.claude/skills/`, you may need to:
1. Create symlinks manually
2. Use this bridge plugin for discovery
3. File an issue with oh-my-opencode for expanded scanning

### Q: How do I install plugins without Claude's TUI?

**A:** Use Claude CLI directly:
```bash
claude plugin install <plugin-name>
claude marketplace add <source>
```

Or use this bridge plugin from within OpenCode:
```
"Install the code-review plugin"
→ Uses claude_plugin_install tool
```

---

## Appendix: Full oh-my-opencode Claude Compatibility

From oh-my-opencode README:

```markdown
## Claude Code Compatibility

### Hooks Integration
- PreToolUse, PostToolUse, UserPromptSubmit, Stop
- Reads from ~/.claude/settings.json

### Config Loaders
- Commands: ~/.claude/commands/, ./.claude/commands/
- Skills: ~/.claude/skills/*/SKILL.md
- Agents: ~/.claude/agents/*.md
- MCPs: ~/.claude/.mcp.json, ./.mcp.json

### Compatibility Toggles
{
  "claude_code": {
    "mcp": true,
    "commands": true,
    "skills": true,
    "agents": true,
    "hooks": true
  }
}
```

---

*This document is part of the opencode-claude-marketplace-bridge project.*
*For updates, see: https://github.com/jms830/opencode-claude-marketplace-bridge*
