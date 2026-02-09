# Native Plugin Marketplace for OpenCode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the opencode-claude-marketplace-bridge plugin to provide native plugin discovery, browsing, and status within OpenCode conversations — reading/writing the same `~/.claude/plugins/` files Claude Code uses — with a Claude CLI bridge for actual installation.

**Architecture:** The plugin exposes Claude-parity lifecycle tools for plugin management (search, info, list, status, install, uninstall, enable/disable, marketplace list/add/update/remove) that read JSON files from `~/.claude/plugins/` directly. The `/plugin` slash command in `~/.config/opencode/command/plugin.md` acts as the conversational entry point that invokes these tools. Mutating operations delegate to Claude CLI and then run file-based post-action verification to confirm success.

**Tech Stack:** Node.js ES Modules, `@opencode-ai/plugin` SDK (Zod schemas, `tool()` helper), `child_process` for Claude CLI bridge, `fs/promises` for JSON file I/O. Zero additional dependencies.

---

## Data Layer: Claude Code Plugin Files (READ ONLY unless noted)

All paths relative to `~/.claude/plugins/`:

| File | Format | Purpose | Our Access |
|------|--------|---------|------------|
| `known_marketplaces.json` | `{ "name": { source, installLocation, lastUpdated, autoUpdate } }` | Registry of marketplace sources | READ |
| `installed_plugins.json` | `{ version: 2, plugins: { "name@marketplace": [{ scope, projectPath, installPath, version, installedAt, lastUpdated, gitCommitSha }] } }` | What's installed | READ |
| `config.json` | `{ enabled_agents, marketplaces, sync_mode }` | Plugin system config | READ |
| `install-counts-cache.json` | `{ version: 1, fetchedAt, counts: [{ plugin, unique_installs }] }` | Download popularity | READ |
| `marketplaces/<name>/.claude-plugin/marketplace.json` | `{ name, description?, owner, plugins: [{ name, description, version?, source, category?, homepage?, tags?, author?, lspServers?, skills?, strict? }] }` | Browsable plugin catalog per marketplace | READ |
| `cache/<marketplace>/<plugin>/<version>/` | Directory tree | Installed plugin content | READ (for status) |

---

## Task 1: Create Shared Data Access Module (`lib/data.js`)

**Files:**
- Create: `lib/data.js`

This module encapsulates all file I/O for the Claude plugin data layer. Every tool imports from here.

**Step 1: Write `lib/data.js`**

```javascript
// lib/data.js — Read-only access to Claude Code's plugin data layer
import { readFile, readdir, access } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

const PLUGINS_DIR = join(homedir(), ".claude", "plugins")

// Safe JSON reader — returns null on missing/corrupt files
async function readJSON(path) {
  try {
    const raw = await readFile(path, "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function getPluginsDir() {
  return PLUGINS_DIR
}

export async function getKnownMarketplaces() {
  return await readJSON(join(PLUGINS_DIR, "known_marketplaces.json")) ?? {}
}

export async function getInstalledPlugins() {
  const data = await readJSON(join(PLUGINS_DIR, "installed_plugins.json"))
  return data?.plugins ?? {}
}

export async function getInstallCounts() {
  const data = await readJSON(join(PLUGINS_DIR, "install-counts-cache.json"))
  if (!data?.counts) return {}
  const map = {}
  for (const { plugin, unique_installs } of data.counts) {
    map[plugin] = unique_installs
  }
  return map
}

export async function getConfig() {
  return await readJSON(join(PLUGINS_DIR, "config.json")) ?? {}
}

// Returns array of { marketplaceName, catalog } for all registered marketplaces
export async function getAllMarketplaceCatalogs() {
  const marketplaces = await getKnownMarketplaces()
  const results = []
  for (const name of Object.keys(marketplaces)) {
    const catalogPath = join(PLUGINS_DIR, "marketplaces", name, ".claude-plugin", "marketplace.json")
    const catalog = await readJSON(catalogPath)
    if (catalog) {
      results.push({ marketplaceName: name, catalog })
    }
  }
  return results
}

// Returns flat list of all available plugins across all marketplaces
export async function getAllAvailablePlugins() {
  const catalogs = await getAllMarketplaceCatalogs()
  const installCounts = await getInstallCounts()
  const installed = await getInstalledPlugins()
  const plugins = []

  for (const { marketplaceName, catalog } of catalogs) {
    for (const plugin of catalog.plugins ?? []) {
      const key = `${plugin.name}@${marketplaceName}`
      const installs = installCounts[key] ?? 0
      const installInfo = installed[key]
      plugins.push({
        name: plugin.name,
        marketplace: marketplaceName,
        key,
        description: plugin.description ?? "",
        version: plugin.version ?? null,
        category: plugin.category ?? null,
        homepage: plugin.homepage ?? null,
        author: plugin.author?.name ?? catalog.owner?.name ?? null,
        tags: plugin.tags ?? [],
        hasLsp: !!plugin.lspServers,
        hasSkills: !!plugin.skills,
        installs,
        installed: !!installInfo,
        installedVersion: installInfo?.[0]?.version ?? null,
        installedAt: installInfo?.[0]?.installedAt ?? null,
        lastUpdated: installInfo?.[0]?.lastUpdated ?? null,
        strict: plugin.strict ?? false,
      })
    }
  }

  return plugins
}

// Check if the Claude CLI is available
export async function isClaudeAvailable() {
  try {
    const { execSync } = await import("child_process")
    execSync("which claude", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}

// Check if the plugins directory exists at all
export async function isPluginSystemAvailable() {
  try {
    await access(PLUGINS_DIR)
    return true
  } catch {
    return false
  }
}
```

**Step 2: Verify module loads**

Run: `node -e "import('./lib/data.js').then(m => console.log(Object.keys(m)))"`
Expected: Array of exported function names

**Step 3: Commit**

```bash
git add lib/data.js
git commit -m "feat: add shared data access module for Claude plugin files"
```

---

## Task 2: Write `plugin_search` Tool

**Files:**
- Modify: `index.js` (replace entire file)

This is the core discovery tool. It searches across all marketplace catalogs by name, description, category, and tags.

**Step 1: Write the search tool in `index.js`**

Start fresh — replace entire `index.js`:

```javascript
// OpenCode Plugin Marketplace — Native Discovery
// Reads ~/.claude/plugins/ for cross-compatible plugin browsing

import { tool } from "@opencode-ai/plugin/tool"
import {
  getAllAvailablePlugins,
  isPluginSystemAvailable,
} from "./lib/data.js"

function formatInstalls(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const plugin_search = tool({
  description: "Search available plugins across all registered Claude Code marketplaces. Returns matching plugins with install counts, categories, and installation status. Use without a query to browse popular plugins.",
  args: {
    query: tool.schema.string().optional().describe("Search term (matches name, description, category, tags). Omit to list popular plugins."),
    category: tool.schema.string().optional().describe("Filter by category: development, productivity, design, testing, security, database, monitoring, deployment, learning, integration"),
    marketplace: tool.schema.string().optional().describe("Filter to specific marketplace (e.g. claude-plugins-official, superpowers-marketplace)"),
    installed_only: tool.schema.boolean().optional().describe("If true, only show already-installed plugins"),
    limit: tool.schema.number().optional().describe("Max results (default: 20)"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "**Plugin system not found.** Claude Code needs to be installed and have run `/plugin` at least once to populate `~/.claude/plugins/`."
    }

    let plugins = await getAllAvailablePlugins()
    const limit = args.limit ?? 20

    // Filter: installed_only
    if (args.installed_only) {
      plugins = plugins.filter(p => p.installed)
    }

    // Filter: marketplace
    if (args.marketplace) {
      const m = args.marketplace.toLowerCase()
      plugins = plugins.filter(p => p.marketplace.toLowerCase().includes(m))
    }

    // Filter: category
    if (args.category) {
      const c = args.category.toLowerCase()
      plugins = plugins.filter(p => p.category?.toLowerCase() === c)
    }

    // Filter: query (fuzzy match across name, description, category, tags)
    if (args.query) {
      const q = args.query.toLowerCase()
      plugins = plugins.filter(p => {
        const searchable = [
          p.name, p.description, p.category,
          p.marketplace, p.author, ...p.tags
        ].filter(Boolean).join(" ").toLowerCase()
        return searchable.includes(q)
      })
    }

    // Sort: installed first, then by install count desc
    plugins.sort((a, b) => {
      if (a.installed && !b.installed) return -1
      if (!a.installed && b.installed) return 1
      return b.installs - a.installs
    })

    plugins = plugins.slice(0, limit)

    if (plugins.length === 0) {
      const suggestion = args.query
        ? `No plugins found for "${args.query}". Try a broader query or omit the query to browse popular plugins.`
        : "No plugins found with the given filters."
      return suggestion
    }

    const lines = [`**Found ${plugins.length} plugin${plugins.length === 1 ? "" : "s"}:**\n`]

    for (const p of plugins) {
      const status = p.installed ? "✅" : "  "
      const installs = p.installs > 0 ? ` (${formatInstalls(p.installs)} installs)` : ""
      const cat = p.category ? ` [${p.category}]` : ""
      const ver = p.installedVersion ? ` v${p.installedVersion}` : p.version ? ` v${p.version}` : ""

      lines.push(`${status} **${p.name}**${ver}${cat}${installs}`)
      lines.push(`   ${p.description}`)
      lines.push(`   📦 ${p.marketplace}`)
      lines.push("")
    }

    lines.push("---")
    lines.push("Use `plugin_info` for details. Use `plugin_install` to install.")

    return lines.join("\n")
  }
})

export { plugin_search }
```

Note: We'll add the remaining tools and the export default function in subsequent tasks. For now this file just exports the search tool for testing.

**Step 2: Verify it loads**

Run: `node -e "import('./index.js').then(m => console.log('search:', typeof m.plugin_search))"`
Expected: `search: object`

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add plugin_search tool with multi-marketplace discovery"
```

---

## Task 3: Write `plugin_info` Tool

**Files:**
- Modify: `index.js` (add after `plugin_search`)

Provides detailed info about a specific plugin — description, install status, homepage, marketplace, version history, install count, and what it contains (skills, LSP, commands, agents).

**Step 1: Add `plugin_info` to `index.js`**

Add after the `plugin_search` definition:

```javascript
import {
  getAllAvailablePlugins,
  getInstalledPlugins,
  getInstallCounts,
  isPluginSystemAvailable,
  getPluginsDir,
} from "./lib/data.js"
import { readdir } from "fs/promises"
import { join } from "path"

const plugin_info = tool({
  description: "Get detailed information about a specific plugin including description, install status, homepage, version, install count, and contents (skills, commands, agents, MCPs).",
  args: {
    name: tool.schema.string().describe("Plugin name (e.g. 'superpowers', 'feature-dev', 'playwright')"),
    marketplace: tool.schema.string().optional().describe("Marketplace name if disambiguation needed"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "Plugin system not found. Run Claude Code's `/plugin` first."
    }

    const plugins = await getAllAvailablePlugins()
    const q = args.name.toLowerCase()

    let matches = plugins.filter(p => p.name.toLowerCase() === q)
    if (matches.length === 0) {
      matches = plugins.filter(p => p.name.toLowerCase().includes(q))
    }
    if (args.marketplace) {
      const m = args.marketplace.toLowerCase()
      matches = matches.filter(p => p.marketplace.toLowerCase().includes(m))
    }

    if (matches.length === 0) {
      return `No plugin found matching "${args.name}". Use \`plugin_search\` to browse available plugins.`
    }

    // If multiple matches across marketplaces, show all
    const lines = []
    for (const p of matches) {
      lines.push(`# ${p.name}`)
      lines.push("")
      lines.push(`**Description:** ${p.description || "No description"}`)
      lines.push(`**Marketplace:** ${p.marketplace}`)
      lines.push(`**Author:** ${p.author || "Unknown"}`)
      if (p.category) lines.push(`**Category:** ${p.category}`)
      if (p.version) lines.push(`**Latest Version:** ${p.version}`)
      if (p.homepage) lines.push(`**Homepage:** ${p.homepage}`)
      if (p.tags.length > 0) lines.push(`**Tags:** ${p.tags.join(", ")}`)
      lines.push(`**Downloads:** ${p.installs > 0 ? p.installs.toLocaleString() : "N/A"}`)
      lines.push(`**Strict Mode:** ${p.strict ? "Yes" : "No"}`)
      lines.push("")

      // Installation status
      if (p.installed) {
        lines.push("## Installed ✅")
        lines.push(`- **Version:** ${p.installedVersion ?? "unknown"}`)
        lines.push(`- **Installed:** ${p.installedAt ? new Date(p.installedAt).toLocaleDateString() : "unknown"}`)
        lines.push(`- **Updated:** ${p.lastUpdated ? new Date(p.lastUpdated).toLocaleDateString() : "never"}`)

        // Try to list contents of the installed plugin
        const pluginsDir = await getPluginsDir()
        const installed = await getInstalledPlugins()
        const installInfo = installed[p.key]?.[0]
        if (installInfo?.installPath) {
          try {
            const contents = await readdir(installInfo.installPath, { recursive: false })
            const hasDirs = { skills: false, commands: false, agents: false, hooks: false, mcps: false }
            for (const item of contents) {
              if (item === "skills" || item.endsWith("SKILL.md")) hasDirs.skills = true
              if (item === "commands" || item === "command") hasDirs.commands = true
              if (item === "agents" || item === "agent") hasDirs.agents = true
              if (item === "hooks" || item.endsWith(".js")) hasDirs.hooks = true
              if (item === "mcps" || item === "mcp.json") hasDirs.mcps = true
            }
            const provides = Object.entries(hasDirs).filter(([, v]) => v).map(([k]) => k)
            if (provides.length > 0) {
              lines.push(`- **Provides:** ${provides.join(", ")}`)
            }
          } catch {
            // installPath might not exist or be inaccessible
          }
        }
      } else {
        lines.push("## Not Installed")
        lines.push(`To install: \`plugin_install name="${p.name}" marketplace="${p.marketplace}"\``)
      }

      if (p.hasLsp) lines.push("\n⚙️ **Includes LSP server** (language intelligence)")
      if (p.hasSkills) lines.push("📚 **Includes skills** (knowledge/workflow)")

      lines.push("")
      lines.push("---")
      lines.push("")
    }

    return lines.join("\n")
  }
})

export { plugin_search, plugin_info }
```

**Note:** Update the import at the top of the file to include the additional exports from `./lib/data.js` and the `readdir`/`join` imports.

**Step 2: Verify**

Run: `node -e "import('./index.js').then(m => console.log('info:', typeof m.plugin_info))"`
Expected: `info: object`

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add plugin_info tool with detailed plugin inspection"
```

---

## Task 4: Write `plugin_list` Tool

**Files:**
- Modify: `index.js`

Lists installed plugins grouped by marketplace, with version and update dates.

**Step 1: Add `plugin_list` to `index.js`**

```javascript
const plugin_list = tool({
  description: "List all currently installed plugins with version, marketplace, and update dates. Shows what's active in your environment.",
  args: {
    marketplace: tool.schema.string().optional().describe("Filter to specific marketplace"),
    sort: tool.schema.enum(["name", "date", "marketplace"]).optional().describe("Sort order (default: marketplace)"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "Plugin system not found."
    }

    const installed = await getInstalledPlugins()
    const keys = Object.keys(installed)

    if (keys.length === 0) {
      return "No plugins installed. Use `plugin_search` to discover plugins."
    }

    let entries = keys.map(key => {
      const [name, marketplace] = key.includes("@") ? key.split("@") : [key, "unknown"]
      const info = installed[key][0] ?? {}
      return {
        key,
        name,
        marketplace,
        version: info.version ?? "?",
        scope: info.scope ?? "?",
        installedAt: info.installedAt ?? null,
        lastUpdated: info.lastUpdated ?? null,
        projectPath: info.projectPath ?? null,
      }
    })

    // Filter by marketplace
    if (args.marketplace) {
      const m = args.marketplace.toLowerCase()
      entries = entries.filter(e => e.marketplace.toLowerCase().includes(m))
    }

    // Sort
    const sort = args.sort ?? "marketplace"
    if (sort === "name") entries.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === "date") entries.sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""))
    else entries.sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.name.localeCompare(b.name))

    if (entries.length === 0) {
      return `No installed plugins matching marketplace "${args.marketplace}".`
    }

    const lines = [`**${entries.length} installed plugin${entries.length === 1 ? "" : "s"}:**\n`]

    let currentMarketplace = ""
    for (const e of entries) {
      if (sort === "marketplace" && e.marketplace !== currentMarketplace) {
        currentMarketplace = e.marketplace
        lines.push(`### 📦 ${currentMarketplace}`)
      }
      const updated = e.lastUpdated ? new Date(e.lastUpdated).toLocaleDateString() : "—"
      lines.push(`- **${e.name}** v${e.version} (updated: ${updated}, scope: ${e.scope})`)
    }

    return lines.join("\n")
  }
})
```

**Step 2: Add to exports and verify**

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add plugin_list tool for installed plugins overview"
```

---

## Task 5: Write `plugin_status` Tool

**Files:**
- Modify: `index.js`

High-level dashboard: total installed, per-marketplace counts, plugin system config, last update times.

**Step 1: Add `plugin_status` to `index.js`**

```javascript
const plugin_status = tool({
  description: "Show plugin system status: total installed, per-marketplace counts, configuration, and available marketplace statistics.",
  args: {},
  async execute() {
    if (!await isPluginSystemAvailable()) {
      return "**Plugin system not found.**\n\nEnsure Claude Code is installed and has run `/plugin` at least once."
    }

    const installed = await getInstalledPlugins()
    const marketplaces = await getKnownMarketplaces()
    const config = await getConfig()
    const catalogs = await getAllMarketplaceCatalogs()
    const claudeAvailable = await isClaudeAvailable()

    const installedKeys = Object.keys(installed)
    const marketplaceNames = Object.keys(marketplaces)

    // Count installed per marketplace
    const perMarketplace = {}
    for (const key of installedKeys) {
      const [, mp] = key.includes("@") ? key.split("@") : [key, "unknown"]
      perMarketplace[mp] = (perMarketplace[mp] ?? 0) + 1
    }

    // Count available per marketplace
    const availablePerMarketplace = {}
    for (const { marketplaceName, catalog } of catalogs) {
      availablePerMarketplace[marketplaceName] = catalog.plugins?.length ?? 0
    }

    const lines = [
      "# Plugin System Status\n",
      `**Installed:** ${installedKeys.length} plugins`,
      `**Marketplaces:** ${marketplaceNames.length} registered`,
      `**Claude CLI:** ${claudeAvailable ? "✅ Available" : "❌ Not found"}`,
      `**Sync mode:** ${config.sync_mode ?? "unknown"}`,
      `**Enabled agents:** ${(config.enabled_agents ?? []).join(", ") || "none"}`,
      "",
      "## Marketplaces\n",
    ]

    for (const name of marketplaceNames) {
      const mp = marketplaces[name]
      const installed = perMarketplace[name] ?? 0
      const available = availablePerMarketplace[name] ?? "?"
      const updated = mp.lastUpdated ? new Date(mp.lastUpdated).toLocaleDateString() : "never"
      const sourceType = mp.source?.source ?? "unknown"
      lines.push(`### ${name}`)
      lines.push(`- Source: ${sourceType} (${mp.source?.repo ?? mp.source?.url ?? "?"})`)
      lines.push(`- Installed: ${installed}/${available} plugins`)
      lines.push(`- Last updated: ${updated}`)
      lines.push(`- Auto-update: ${mp.autoUpdate ? "yes" : "no"}`)
      lines.push("")
    }

    if (!claudeAvailable) {
      lines.push("---")
      lines.push("⚠️ Claude CLI not found. Install operations require `claude` command in PATH.")
    }

    return lines.join("\n")
  }
})
```

**Step 2: Add to exports and verify**

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add plugin_status tool for system dashboard"
```

---

## Task 6: Write Mutating Plugin Lifecycle Tools (Claude CLI Bridge + Verification)

**Files:**
- Modify: `index.js`

These are bridge tools — they delegate actual mutation operations to Claude CLI and then verify on-disk state changed as expected. Since Claude Code's lifecycle involves git cloning, symlink management, and registry updates, we don't replicate internals.

**Step 1: Add parity lifecycle tools to `index.js`**

Add:
- `plugin_install` -> `claude plugin install <name@marketplace> [--scope ...]`
- `plugin_uninstall` -> `claude plugin uninstall <name@marketplace> [--scope ...]`
- `plugin_enable` -> `claude plugin enable <name@marketplace> [--scope ...]`
- `plugin_disable` -> `claude plugin disable <name@marketplace> [--scope ...]`

All four tools must:
1. Validate target exists (or is installed for uninstall/enable/disable)
2. Execute Claude CLI command
3. Re-read `installed_plugins.json` and confirm expected state transition
4. Return a clear verification block:
   - `cli_exit`: success/failure
   - `state_before`
   - `state_after`
   - `verified`: true/false

If CLI reports success but file-state verification disagrees, return **warning** and include futureproofing guidance (possible Claude CLI behavior/schema drift).

```javascript
import { execSync } from "child_process"

const plugin_install = tool({
  description: "Install a plugin using Claude Code's CLI. Requires the `claude` command to be available. After installation, restart OpenCode for the plugin to take effect.",
  args: {
    name: tool.schema.string().describe("Plugin name to install (e.g. 'superpowers', 'feature-dev')"),
    marketplace: tool.schema.string().optional().describe("Marketplace name (e.g. 'claude-plugins-official'). If omitted, searches all marketplaces."),
    scope: tool.schema.enum(["user", "project"]).optional().describe("Installation scope (default: user)"),
  },
  async execute(args) {
    if (!await isClaudeAvailable()) {
      return "**Claude CLI not found.** The `claude` command is required for plugin installation.\n\nInstall Claude Code: https://claude.ai/code"
    }

    // Verify plugin exists before attempting install
    const plugins = await getAllAvailablePlugins()
    const q = args.name.toLowerCase()
    let match = plugins.find(p => p.name.toLowerCase() === q && (!args.marketplace || p.marketplace.toLowerCase().includes(args.marketplace.toLowerCase())))

    if (!match) {
      // Fuzzy search
      const fuzzy = plugins.filter(p => p.name.toLowerCase().includes(q))
      if (fuzzy.length === 0) {
        return `Plugin "${args.name}" not found in any marketplace. Use \`plugin_search\` to browse available plugins.`
      }
      if (fuzzy.length === 1) {
        match = fuzzy[0]
      } else {
        const list = fuzzy.map(p => `- ${p.name} (${p.marketplace})`).join("\n")
        return `Multiple plugins match "${args.name}":\n${list}\n\nSpecify the exact name and marketplace.`
      }
    }

    if (match.installed) {
      return `**${match.name}** is already installed (v${match.installedVersion ?? "?"} from ${match.marketplace}).\n\nTo update, use Claude Code's \`/plugin\` command.`
    }

    // Build the install command
    // Claude CLI syntax: claude plugin install <name> --marketplace <marketplace> --scope <scope>
    const parts = ["claude", "plugin", "install", match.name]
    if (match.marketplace) parts.push("--marketplace", match.marketplace)
    if (args.scope) parts.push("--scope", args.scope)
    const cmd = parts.join(" ")

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 120_000,
        stdio: ["pipe", "pipe", "pipe"],
      })

      return `# Installed: ${match.name}\n\n${output}\n\n**Next:** Restart OpenCode for the plugin to load (oh-my-opencode will auto-discover it).`
    } catch (err) {
      const stderr = err.stderr ?? err.message ?? "Unknown error"
      return `**Installation failed:**\n\n\`\`\`\n${stderr}\n\`\`\`\n\nTry running manually: \`${cmd}\``
    }
  }
})
```

**Step 2: Verify**

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add plugin_install tool with Claude CLI bridge"
```

---

## Task 7: Write Marketplace Lifecycle Tools (Read + Mutations + Verification)

**Files:**
- Modify: `index.js`

Adds full marketplace lifecycle parity with Claude commands.

**Step 1: Add marketplace tools to `index.js`**

Add:
- `marketplace_list` -> read-only summary
- `marketplace_add` -> `claude plugin marketplace add <source>`
- `marketplace_update` -> `claude plugin marketplace update <name>` (or all)
- `marketplace_remove` -> `claude plugin marketplace remove <name>`

Mutation tools must perform post-action verification by re-reading `known_marketplaces.json` and confirming the expected state transition.

```javascript
const marketplace_list = tool({
  description: "List all registered plugin marketplaces with their sources, plugin counts, and update dates.",
  args: {},
  async execute() {
    if (!await isPluginSystemAvailable()) {
      return "Plugin system not found."
    }

    const marketplaces = await getKnownMarketplaces()
    const catalogs = await getAllMarketplaceCatalogs()
    const names = Object.keys(marketplaces)

    if (names.length === 0) {
      return "No marketplaces registered. Use Claude Code's `/plugin` to add marketplaces."
    }

    const lines = [`**${names.length} registered marketplace${names.length === 1 ? "" : "s"}:**\n`]

    for (const name of names) {
      const mp = marketplaces[name]
      const catalog = catalogs.find(c => c.marketplaceName === name)?.catalog
      const pluginCount = catalog?.plugins?.length ?? 0
      const desc = catalog?.description ?? mp.description ?? ""
      const owner = catalog?.owner?.name ?? ""
      const source = mp.source?.repo ?? mp.source?.url ?? "local"
      const updated = mp.lastUpdated ? new Date(mp.lastUpdated).toLocaleDateString() : "never"

      lines.push(`### ${name}`)
      if (desc) lines.push(`${desc}`)
      if (owner) lines.push(`**By:** ${owner}`)
      lines.push(`**Source:** ${source}`)
      lines.push(`**Plugins:** ${pluginCount}`)
      lines.push(`**Updated:** ${updated}`)
      lines.push(`**Auto-update:** ${mp.autoUpdate ? "yes" : "no"}`)
      lines.push("")
    }

    lines.push("---")
    lines.push("To add a marketplace, use Claude Code: `claude marketplace add <github-url>`")

    return lines.join("\n")
  }
})
```

**Step 2: Verify**

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add marketplace_list tool"
```

---

## Task 8: Assemble Plugin Entry Point

**Files:**
- Modify: `index.js` (wrap all tools into the default export)

The OpenCode plugin SDK expects a default export function `Plugin = (input: PluginInput) => Promise<Hooks>`.

**Step 1: Restructure `index.js` as proper plugin**

The final `index.js` should have:
1. All imports at the top
2. All tool definitions
3. Default export function that returns `{ tool: { ... } }`

Replace the per-tool exports with a single default export:

```javascript
// At the bottom of index.js, replace individual exports with:

export default async function plugin(input) {
  return {
    tool: {
      plugin_search,
      plugin_info,
      plugin_list,
      plugin_status,
      plugin_install,
      plugin_uninstall,
      plugin_enable,
      plugin_disable,
      marketplace_list,
      marketplace_add,
      marketplace_update,
      marketplace_remove,
    }
  }
}
```

Remove the old `export { plugin_search, plugin_info, ... }` named exports. The SDK expects only the default export.

Also, the old `ClaudeMarketplaceBridge` export and `claude_plugin_browser`/`claude_sessions` tools should be removed entirely — they're replaced by native tools.

**Step 2: Verify full plugin loads**

Run: `node -e "import('./index.js').then(m => m.default({}).then(h => console.log('tools:', Object.keys(h.tool))))"`
Expected: `tools: [ 'plugin_search', 'plugin_info', 'plugin_list', 'plugin_status', 'plugin_install', 'marketplace_list' ]`

**Step 3: Commit**

```bash
git add index.js
git commit -m "refactor: assemble all tools into proper plugin default export"
```

---

## Task 9: Rewrite the `/plugin` Slash Command

**Files:**
- Modify: `~/.config/opencode/command/plugin.md`

The current command shells out to `claude "/plugin"` via WezTerm/tmux. Replace with a conversational command that uses the new tools.

**Step 1: Write the new command**

```markdown
---
description: Browse, search, and install plugins from Claude Code marketplaces
---

Plugin marketplace browser. What would you like to do?

## Instructions

### Step 1: Show the user what's available

Start by running `plugin_status` to show the current state, then ask what they'd like to do.

### Step 2: Handle user intent

Based on what the user asks, use the appropriate tool:

| Intent | Tool | Example |
|--------|------|---------|
| Browse / discover | `plugin_search` | "Show me popular plugins" |
| Search for something specific | `plugin_search query="..."` | "Find testing plugins" |
| Filter by category | `plugin_search category="development"` | "Show development plugins" |
| Get details about a plugin | `plugin_info name="..."` | "Tell me about superpowers" |
| See what's installed | `plugin_list` | "What do I have installed?" |
| Check system status | `plugin_status` | "How's my plugin setup?" |
| Install a plugin | `plugin_install name="..."` | "Install feature-dev" |
| View marketplaces | `marketplace_list` | "What marketplaces are registered?" |

### Step 3: Guide installation

When the user wants to install a plugin:
1. Use `plugin_info` to show details first
2. Confirm they want to proceed
3. Use `plugin_install` to install via Claude CLI
4. Remind them to restart OpenCode for the plugin to load

### Available categories

development, productivity, design, testing, security, database, monitoring, deployment, learning, integration

### Notes

- All data is read from `~/.claude/plugins/` — the same files Claude Code uses
- Installation requires the `claude` CLI to be available
- After installing, restart OpenCode so oh-my-opencode discovers the new plugin
- Use `plugin_search` without a query to browse the most popular plugins
```

**Step 2: Commit**

```bash
git add ~/.config/opencode/command/plugin.md
git commit -m "feat: rewrite /plugin command as native conversational marketplace"
```

---

## Task 10: Activate Plugin in OpenCode Config

**Files:**
- Modify: `~/.config/opencode/opencode.json` (add plugin to array)

**Step 1: Read current opencode.json**

Check current `plugin` array and add the bridge.

The plugin can be referenced by local path during development:
```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "/home/jordans/github/opencode-claude-marketplace-bridge"
  ]
}
```

Or after npm publish:
```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "opencode-claude-marketplace-bridge"
  ]
}
```

**Step 2: Add to config**

Add the local path to the `plugin` array in `opencode.json`.

**Step 3: Commit**

Do NOT commit opencode.json (it's not in this repo). Just note it was changed.

---

## Task 11: Update Package Metadata

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/ARCHITECTURE.md`

**Step 1: Update `package.json`**

```json
{
  "name": "opencode-claude-marketplace-bridge",
  "version": "3.0.0",
  "description": "Native plugin marketplace for OpenCode — browse, search, and install Claude Code plugins without leaving your conversation",
  "main": "./index.js",
  "type": "module",
  "license": "MIT",
  "author": "Jordan",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jms830/opencode-claude-marketplace-bridge.git"
  },
  "keywords": [
    "opencode",
    "claude",
    "plugin",
    "marketplace",
    "discovery",
    "claude-code"
  ],
  "homepage": "https://github.com/jms830/opencode-claude-marketplace-bridge#readme",
  "bugs": {
    "url": "https://github.com/jms830/opencode-claude-marketplace-bridge/issues"
  },
  "files": [
    "index.js",
    "lib/",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "^0.15.0"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^0.15.31"
  }
}
```

Key changes:
- Version bump to 3.0.0 (breaking: new API, removed old tools)
- Updated description
- Added `lib/` to `files` array
- Updated keywords

**Step 2: Update README.md**

Rewrite to reflect the new native experience. Cover:
- What it does (native discovery, not a tmux launcher)
- Installation (opencode.json + optional `/plugin` command)
- Usage examples (search, browse, info, install)
- Tool reference table
- How it works (reads `~/.claude/plugins/`, delegates install to Claude CLI)
- Cross-compatibility explanation

**Step 3: Update AGENTS.md**

Update tool table, architecture description, build/test commands.

**Step 4: Update docs/ARCHITECTURE.md**

Remove "reduced scope" language, update to reflect native discovery architecture. The bridge is now a first-class native experience, not a CLI wrapper.

**Step 5: Commit**

```bash
git add package.json README.md AGENTS.md docs/ARCHITECTURE.md
git commit -m "docs: update package metadata, README, and architecture for v3.0"
```

---

## Task 12: End-to-End Verification

**Step 1: Verify plugin loads in Node.js**

```bash
cd /home/jordans/github/opencode-claude-marketplace-bridge
node -e "
import('./index.js').then(async (m) => {
  const hooks = await m.default({})
  const tools = Object.keys(hooks.tool)
  console.log('Tools:', tools)
  console.log('Count:', tools.length)
  if (tools.length !== 6) throw new Error('Expected 6 tools, got ' + tools.length)
  console.log('OK')
})
"
```
Expected: `Tools: [ 'plugin_search', ... ] Count: 6 OK`

**Step 2: Smoke-test each tool**

```bash
node -e "
import('./index.js').then(async (m) => {
  const hooks = await m.default({})
  const ctx = { sessionID: 'test', messageID: 'test', agent: 'test', directory: '.', worktree: '.', abort: new AbortController().signal, metadata: () => {}, ask: async () => {} }

  // Test search
  const search = await hooks.tool.plugin_search.execute({}, ctx)
  console.log('search OK:', search.includes('plugin'))

  // Test list
  const list = await hooks.tool.plugin_list.execute({}, ctx)
  console.log('list OK:', list.includes('installed'))

  // Test status
  const status = await hooks.tool.plugin_status.execute({}, ctx)
  console.log('status OK:', status.includes('Marketplace'))

  // Test marketplace_list
  const mp = await hooks.tool.marketplace_list.execute({}, ctx)
  console.log('marketplace OK:', mp.includes('marketplace'))

  // Test info
  const info = await hooks.tool.plugin_info.execute({ name: 'superpowers' }, ctx)
  console.log('info OK:', info.includes('superpowers'))

  console.log('ALL SMOKE TESTS PASSED')
})
"
```

**Step 3: Test in OpenCode**

1. Start OpenCode
2. Type `/plugin`
3. Verify status shows
4. Try `plugin_search query="code review"`
5. Try `plugin_info name="feature-dev"`
6. Try `plugin_list`

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify all tools load and return expected output"
```

---

## Summary of Deliverables

| File | Action | Purpose |
|------|--------|---------|
| `lib/data.js` | CREATE | Shared data access for `~/.claude/plugins/` |
| `index.js` | REWRITE | 6 native tools replacing 2 tmux-based tools |
| `~/.config/opencode/command/plugin.md` | REWRITE | Conversational marketplace command |
| `~/.config/opencode/opencode.json` | MODIFY | Add plugin to array |
| `package.json` | MODIFY | v3.0.0, updated metadata |
| `README.md` | REWRITE | New docs |
| `AGENTS.md` | MODIFY | Updated tool table |
| `docs/ARCHITECTURE.md` | MODIFY | Updated architecture |

**Tools provided:**

| Tool | Purpose |
|------|---------|
| `plugin_search` | Search/browse all marketplace plugins |
| `plugin_info` | Detailed plugin inspection |
| `plugin_list` | List installed plugins |
| `plugin_status` | System dashboard |
| `plugin_install` | Install via Claude CLI bridge + verification |
| `plugin_uninstall` | Uninstall via Claude CLI bridge + verification |
| `plugin_enable` | Enable installed plugin + verification |
| `plugin_disable` | Disable installed plugin + verification |
| `marketplace_list` | List registered marketplaces |
| `marketplace_add` | Add marketplace + verification |
| `marketplace_update` | Update marketplace(s) + verification |
| `marketplace_remove` | Remove marketplace + verification |

## Futureproofing Requirements (Mandatory)

1. **Schema-tolerant reads:** use defensive JSON parsing and optional chaining; do not crash on missing fields.
2. **CLI adapter boundary:** centralize CLI verb mapping in one helper so command changes are isolated.
3. **Verification after every mutation:** always compare before/after state from files, not just CLI output.
4. **Drift surfacing:** if CLI succeeds but file state mismatch occurs, return a structured warning with raw stdout/stderr snippets.
5. **Graceful fallback:** when unknown schema/flags are encountered, degrade to read-only recommendations instead of failing hard.

**Zero new dependencies.** Only `@opencode-ai/plugin` (existing peer dep) + Node.js built-ins.
