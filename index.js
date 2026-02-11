import { tool } from "@opencode-ai/plugin/tool"
import { spawnSync } from "node:child_process"
import { readdir } from "node:fs/promises"
import {
  getAvailablePlugins,
  getAllMarketplaceCatalogs,
  getConfig,
  getEnabledPluginsMap,
  getInstalledPlugins,
  getKnownMarketplaces,
  getPluginsRoot,
  isPluginSystemAvailable,
  normalizePluginIdentifier,
  summarizeInstalled,
} from "./lib/data.js"

function formatNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function runClaude(args, options = {}) {
  const spawnOptions = {
    encoding: "utf-8",
    timeout: options.timeout ?? 180_000,
    stdio: ["pipe", "pipe", "pipe"],
  }
  if (options.cwd) spawnOptions.cwd = options.cwd

  const result = spawnSync("claude", args, spawnOptions)

  if (result.error) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: result.error.message,
      command: `claude ${args.join(" ")}`,
    }
  }

  return {
    ok: result.status === 0,
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    command: `claude ${args.join(" ")}`,
  }
}

function formatVerificationBlock(input) {
  const lines = []
  lines.push("## Verification")
  lines.push(`- cli_exit: ${input.exitCode}`)
  lines.push(`- verified: ${input.verified ? "true" : "false"}`)
  lines.push(`- state_before: ${input.before}`)
  lines.push(`- state_after: ${input.after}`)
  if (input.reason) {
    lines.push(`- reason: ${input.reason}`)
  }
  if (input.warning) {
    lines.push("")
    lines.push(`⚠️ ${input.warning}`)
  }
  return lines.join("\n")
}

async function isClaudeAvailable() {
  const result = runClaude(["--version"])
  return result.ok
}

function findMatchingPlugins(plugins, pluginName, marketplace) {
  const normalized = normalizePluginIdentifier(pluginName, marketplace)
  if (!normalized) return []

  if (normalized.includes("@")) {
    return plugins.filter((p) => p.key === normalized)
  }

  const byName = plugins.filter((p) => p.name.toLowerCase() === normalized.toLowerCase())
  if (marketplace) {
    const marketplaceLower = marketplace.toLowerCase()
    return byName.filter((p) => p.marketplace.toLowerCase() === marketplaceLower)
  }

  return byName
}

function dedupeByKey(plugins) {
  const map = new Map()
  for (const plugin of plugins) {
    map.set(plugin.key, plugin)
  }
  return Array.from(map.values())
}

async function inspectInstallPath(installPath) {
  if (!installPath) return []

  try {
    const entries = await readdir(installPath)
    const found = []
    for (const entry of entries) {
      if (entry === "skills") found.push("skills")
      if (entry === "commands" || entry === "command") found.push("commands")
      if (entry === "agents" || entry === "agent") found.push("agents")
      if (entry === "hooks" || entry.endsWith(".js")) found.push("hooks")
      if (entry === ".mcp.json" || entry === "mcp.json") found.push("mcp")
      if (entry === ".lsp.json") found.push("lsp")
    }
    return Array.from(new Set(found)).sort()
  } catch {
    return []
  }
}

function sortPluginsForSearch(plugins) {
  return [...plugins].sort((a, b) => {
    if (a.installed && !b.installed) return -1
    if (!a.installed && b.installed) return 1
    if (b.installs !== a.installs) return b.installs - a.installs
    return a.name.localeCompare(b.name)
  })
}

function summarizePluginState(installed, key) {
  const rows = installed[key] ?? []
  const versions = rows.map((row) => row?.version).filter(Boolean)
  return `${rows.length} row(s), versions=[${versions.join(", ")}]`
}

function summarizeMarketplaceState(known, key) {
  const entry = known[key]
  if (!entry) return "missing"
  const updated = entry.lastUpdated ?? "unknown"
  const source = entry.source?.repo ?? entry.source?.url ?? entry.source?.source ?? "unknown"
  return `present(lastUpdated=${updated}, source=${source})`
}

function renderCommandResult(result) {
  const lines = []
  lines.push("## CLI")
  lines.push(`- command: \`${result.command}\``)
  lines.push(`- exit_code: ${result.exitCode}`)
  if (result.stdout.trim()) {
    lines.push("")
    lines.push("### stdout")
    lines.push("```text")
    lines.push(result.stdout.trim())
    lines.push("```")
  }
  if (result.stderr.trim()) {
    lines.push("")
    lines.push("### stderr")
    lines.push("```text")
    lines.push(result.stderr.trim())
    lines.push("```")
  }
  return lines.join("\n")
}

function outputSuggestsNoopUpdate(result) {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase()
  return (
    text.includes("up to date") ||
    text.includes("already up-to-date") ||
    text.includes("already up to date") ||
    text.includes("already at the latest") ||
    text.includes("no updates") ||
    text.includes("no change")
  )
}

const plugin_search = tool({
  description: "Search available plugins across registered Claude Code marketplaces. Supports query/category filters and returns install popularity + installed status.",
  args: {
    query: tool.schema.string().optional().describe("Search query over plugin name, description, tags, author, and marketplace"),
    category: tool.schema.string().optional().describe("Filter by category (development, productivity, design, testing, security, etc.)"),
    marketplace: tool.schema.string().optional().describe("Filter by marketplace name"),
    installed_only: tool.schema.boolean().optional().describe("Only show currently installed plugins"),
    limit: tool.schema.number().int().min(1).max(200).optional().describe("Max results, default 20"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "**Plugin system not found.** Run Claude Code once so `~/.claude/plugins` is initialized."
    }

    let rows = await getAvailablePlugins()
    const q = args.query?.trim().toLowerCase()
    const category = args.category?.trim().toLowerCase()
    const marketplace = args.marketplace?.trim().toLowerCase()
    const limit = args.limit ?? 20

    if (q) {
      rows = rows.filter((row) => {
        const haystack = [
          row.name,
          row.description,
          row.category,
          row.marketplace,
          row.author,
          ...row.tags,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return haystack.includes(q)
      })
    }

    if (category) {
      rows = rows.filter((row) => (row.category ?? "").toLowerCase() === category)
    }

    if (marketplace) {
      rows = rows.filter((row) => row.marketplace.toLowerCase() === marketplace)
    }

    if (args.installed_only) {
      rows = rows.filter((row) => row.installed)
    }

    rows = sortPluginsForSearch(rows).slice(0, limit)

    if (rows.length === 0) {
      return "No plugins matched. Try broader filters or call `plugin_search` without filters."
    }

    const lines = []
    lines.push(`**Found ${rows.length} plugin(s)**`)
    lines.push("")

    for (const row of rows) {
      const status = row.installed ? "✅" : "•"
      const version = row.installedVersion ?? row.version ?? "unknown"
      const categoryText = row.category ? `[${row.category}]` : "[uncategorized]"
      const installs = row.installs > 0 ? `${formatNumber(row.installs)} installs` : "installs unknown"

      lines.push(`${status} **${row.name}** @ ${row.marketplace} - v${version} ${categoryText}`)
      lines.push(`  ${row.description || "No description"}`)
      lines.push(`  ${installs}`)
      lines.push("")
    }

    lines.push("Use `plugin_info` for details. Use `plugin_install` to install.")
    return lines.join("\n")
  },
})

const plugin_info = tool({
  description: "Show detailed metadata and install status for one plugin.",
  args: {
    plugin: tool.schema.string().describe("Plugin identifier, ideally plugin@marketplace. Name-only is allowed if unambiguous."),
    marketplace: tool.schema.string().optional().describe("Marketplace override when plugin is specified by name only"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "Plugin system not found."
    }

    const available = await getAvailablePlugins()
    const installed = summarizeInstalled(await getInstalledPlugins())
    const merged = dedupeByKey([
      ...available,
      ...installed.map((row) => ({
        ...row,
        description: "",
        installs: 0,
        installed: true,
        installedRows: [],
        installedVersion: row.version,
        hasSkills: false,
        hasLsp: false,
        strict: false,
        tags: [],
      })),
    ])

    const matches = findMatchingPlugins(merged, args.plugin, args.marketplace)

    if (matches.length === 0) {
      return `No plugin matched \`${args.plugin}\`. Try \`plugin_search query="${args.plugin}"\`.`
    }

    if (matches.length > 1) {
      const lines = ["Multiple plugins matched. Specify plugin@marketplace:", ""]
      for (const match of matches) {
        lines.push(`- ${match.key}`)
      }
      return lines.join("\n")
    }

    const target = matches[0]
    const provides = await inspectInstallPath(target.installPath)

    const lines = []
    lines.push(`# ${target.key}`)
    lines.push("")
    lines.push(`- installed: ${target.installed ? "yes" : "no"}`)
    lines.push(`- version: ${target.installedVersion ?? target.version ?? "unknown"}`)
    lines.push(`- category: ${target.category ?? "unknown"}`)
    lines.push(`- author: ${target.author ?? "unknown"}`)
    lines.push(`- strict: ${target.strict ? "true" : "false"}`)
    lines.push(`- installs: ${target.installs > 0 ? target.installs.toLocaleString() : "unknown"}`)
    if (target.homepage) lines.push(`- homepage: ${target.homepage}`)
    if (target.installedAt) lines.push(`- installed_at: ${target.installedAt}`)
    if (target.lastUpdated) lines.push(`- last_updated: ${target.lastUpdated}`)
    if (target.installPath) lines.push(`- install_path: ${target.installPath}`)
    if (target.description) {
      lines.push("")
      lines.push(target.description)
    }
    if (target.tags?.length) {
      lines.push("")
      lines.push(`tags: ${target.tags.join(", ")}`)
    }
    if (provides.length) {
      lines.push("")
      lines.push(`provides: ${provides.join(", ")}`)
    }

    return lines.join("\n")
  },
})

const plugin_list = tool({
  description: "List installed plugins, optionally filtered by marketplace and scope.",
  args: {
    marketplace: tool.schema.string().optional().describe("Filter by marketplace"),
    scope: tool.schema.enum(["user", "project", "local", "managed"]).optional().describe("Filter by install scope"),
    sort: tool.schema.enum(["marketplace", "name", "updated"]).optional().describe("Sort mode, default marketplace"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "Plugin system not found."
    }

    let rows = summarizeInstalled(await getInstalledPlugins())
    const marketplace = args.marketplace?.trim().toLowerCase()

    if (marketplace) {
      rows = rows.filter((row) => (row.marketplace ?? "").toLowerCase() === marketplace)
    }

    if (args.scope) {
      rows = rows.filter((row) => row.scope === args.scope)
    }

    const sort = args.sort ?? "marketplace"
    if (sort === "name") {
      rows.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === "updated") {
      rows.sort((a, b) => (b._lastUpdatedDate?.getTime() ?? 0) - (a._lastUpdatedDate?.getTime() ?? 0))
    } else {
      rows.sort((a, b) => {
        const marketplaceOrder = (a.marketplace ?? "").localeCompare(b.marketplace ?? "")
        if (marketplaceOrder !== 0) return marketplaceOrder
        return a.name.localeCompare(b.name)
      })
    }

    if (!rows.length) {
      return "No installed plugins matched your filters."
    }

    const lines = []
    lines.push(`**Installed plugins: ${rows.length}**`)
    lines.push("")

    for (const row of rows) {
      lines.push(`- ${row.key} (scope=${row.scope ?? "unknown"}, version=${row.version ?? "unknown"})`)
    }

    return lines.join("\n")
  },
})

const plugin_status = tool({
  description: "Show current plugin system status including marketplace coverage and CLI availability.",
  args: {},
  async execute() {
    if (!await isPluginSystemAvailable()) {
      return "**Plugin system not found.** Run Claude Code once to initialize `~/.claude/plugins`."
    }

    const claudeReady = await isClaudeAvailable()
    const installed = summarizeInstalled(await getInstalledPlugins())
    const marketplaces = await getKnownMarketplaces()
    const catalogs = await getAllMarketplaceCatalogs()
    const config = await getConfig()

    const installedByMarketplace = {}
    for (const row of installed) {
      const key = row.marketplace ?? "unknown"
      installedByMarketplace[key] = (installedByMarketplace[key] ?? 0) + 1
    }

    const lines = []
    lines.push("# Plugin status")
    lines.push("")
    lines.push(`- plugins_root: ${getPluginsRoot()}`)
    lines.push(`- claude_cli_available: ${claudeReady ? "yes" : "no"}`)
    lines.push(`- installed_plugins: ${installed.length}`)
    lines.push(`- known_marketplaces: ${Object.keys(marketplaces).length}`)
    lines.push(`- catalogs_loaded: ${catalogs.length}`)
    lines.push(`- sync_mode: ${config.sync_mode ?? "unknown"}`)
    lines.push(`- enabled_agents: ${(config.enabled_agents ?? []).join(", ") || "none"}`)
    lines.push("")
    lines.push("## Marketplace coverage")
    lines.push("")

    const names = new Set([...Object.keys(marketplaces), ...catalogs.map((c) => c.marketplaceName)])
    for (const name of Array.from(names).sort()) {
      const meta = marketplaces[name]
      const catalog = catalogs.find((c) => c.marketplaceName === name)
      const catalogCount = catalog?.catalog?.plugins?.length ?? 0
      const installedCount = installedByMarketplace[name] ?? 0
      const source = meta?.source?.repo ?? meta?.source?.url ?? meta?.source?.source ?? "unknown"
      lines.push(`- ${name}: installed ${installedCount}, available ${catalogCount}, source ${source}`)
    }

    return lines.join("\n")
  },
})

async function resolvePluginTarget(plugin, marketplace) {
  const available = await getAvailablePlugins()
  const installed = summarizeInstalled(await getInstalledPlugins())
  const merged = dedupeByKey([
    ...available,
    ...installed.map((row) => ({
      ...row,
      description: "",
      installs: 0,
      installed: true,
      installedRows: [],
      installedVersion: row.version,
      hasSkills: false,
      hasLsp: false,
      strict: false,
      tags: [],
    })),
  ])

  const matches = findMatchingPlugins(merged, plugin, marketplace)
  if (!matches.length) {
    return {
      ok: false,
      reason: `No plugin matched \`${plugin}\``,
    }
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "Multiple plugins matched; use plugin@marketplace",
      candidates: matches.map((m) => m.key),
    }
  }

  return {
    ok: true,
    target: matches[0],
  }
}

function buildMutationReply(title, cliResult, verification) {
  const lines = []
  lines.push(`# ${title}`)
  lines.push("")
  lines.push(renderCommandResult(cliResult))
  lines.push("")
  lines.push(formatVerificationBlock(verification))
  if (cliResult.ok && verification.verified) {
    lines.push("")
    lines.push("Restart OpenCode to ensure newly installed/updated content is reloaded by plugins.")
  }
  return lines.join("\n")
}

const plugin_install = tool({
  description: "Install plugin via Claude CLI and verify the installed_plugins.json state transition.",
  args: {
    plugin: tool.schema.string().describe("Plugin identifier plugin@marketplace, or name if unique"),
    marketplace: tool.schema.string().optional().describe("Marketplace for name-only plugin value"),
    scope: tool.schema.enum(["user", "project", "local"]).optional().describe("Install scope"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "Plugin system not found."
    }
    if (!await isClaudeAvailable()) {
      return "Claude CLI not available. Install command `claude` first."
    }

    const resolved = await resolvePluginTarget(args.plugin, args.marketplace)
    if (!resolved.ok) {
      const extra = resolved.candidates?.length ? `\nCandidates:\n- ${resolved.candidates.join("\n- ")}` : ""
      return `${resolved.reason}${extra}`
    }

    const pluginKey = resolved.target.key
    const before = await getInstalledPlugins()
    const beforeSummary = summarizePluginState(before, pluginKey)

    const cliArgs = ["plugin", "install", pluginKey]
    if (args.scope) cliArgs.push("--scope", args.scope)
    const cliResult = runClaude(cliArgs)

    const after = await getInstalledPlugins()
    const afterSummary = summarizePluginState(after, pluginKey)
    const verified = (after[pluginKey]?.length ?? 0) > (before[pluginKey]?.length ?? 0)
    const warning = cliResult.ok && !verified
      ? "CLI reported success but installed_plugins.json did not show a new row. Possible Claude CLI schema/behavior change."
      : null

    return buildMutationReply(
      `Install ${pluginKey}`,
      cliResult,
      {
        exitCode: cliResult.exitCode,
        verified,
        before: beforeSummary,
        after: afterSummary,
        reason: verified ? "install row count increased" : "install row count did not increase",
        warning,
      },
    )
  },
})

const plugin_uninstall = tool({
  description: "Uninstall plugin via Claude CLI and verify installed_plugins.json state transition.",
  args: {
    plugin: tool.schema.string().describe("Plugin identifier plugin@marketplace, or name if unique"),
    marketplace: tool.schema.string().optional().describe("Marketplace for name-only plugin value"),
    scope: tool.schema.enum(["user", "project", "local"]).optional().describe("Scope if needed by Claude CLI"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) {
      return "Plugin system not found."
    }
    if (!await isClaudeAvailable()) {
      return "Claude CLI not available."
    }

    const resolved = await resolvePluginTarget(args.plugin, args.marketplace)
    if (!resolved.ok) {
      const extra = resolved.candidates?.length ? `\nCandidates:\n- ${resolved.candidates.join("\n- ")}` : ""
      return `${resolved.reason}${extra}`
    }

    const pluginKey = resolved.target.key
    const before = await getInstalledPlugins()
    const beforeSummary = summarizePluginState(before, pluginKey)

    const cliArgs = ["plugin", "uninstall", pluginKey]
    if (args.scope) cliArgs.push("--scope", args.scope)
    const cliResult = runClaude(cliArgs)

    const after = await getInstalledPlugins()
    const afterSummary = summarizePluginState(after, pluginKey)
    const verified = (after[pluginKey]?.length ?? 0) < (before[pluginKey]?.length ?? 0)
    const warning = cliResult.ok && !verified
      ? "CLI reported success but installed_plugins.json did not show a row decrease. Possible Claude CLI schema/behavior change."
      : null

    return buildMutationReply(
      `Uninstall ${pluginKey}`,
      cliResult,
      {
        exitCode: cliResult.exitCode,
        verified,
        before: beforeSummary,
        after: afterSummary,
        reason: verified ? "install row count decreased" : "install row count did not decrease",
        warning,
      },
    )
  },
})

const plugin_update = tool({
  description: "Update a single installed plugin to latest version via Claude CLI. Verifies version or lastUpdated change in installed_plugins.json.",
  args: {
    plugin: tool.schema.string().describe("Plugin identifier plugin@marketplace, or name if unique"),
    marketplace: tool.schema.string().optional().describe("Marketplace for name-only plugin value"),
    scope: tool.schema.enum(["user", "project", "local", "managed"]).optional().describe("Install scope override. Auto-detected from installed_plugins.json if omitted."),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."
    if (!await isClaudeAvailable()) return "Claude CLI not available."

    const resolved = await resolvePluginTarget(args.plugin, args.marketplace)
    if (!resolved.ok) {
      const extra = resolved.candidates?.length ? `\nCandidates:\n- ${resolved.candidates.join("\n- ")}` : ""
      return `${resolved.reason}${extra}`
    }

    const pluginKey = resolved.target.key
    const before = await getInstalledPlugins()
    const beforeRows = before[pluginKey] ?? []

    if (!beforeRows.length) {
      return `Plugin \`${pluginKey}\` is not installed. Use \`plugin_install\` first.`
    }

    const firstRow = beforeRows[0]
    const scope = args.scope ?? firstRow.scope ?? "user"
    const projectPath = firstRow.projectPath ?? null
    const beforeSummary = summarizePluginState(before, pluginKey)

    const cliArgs = ["plugin", "update", pluginKey, "--scope", scope]
    const cliOptions = {}
    if (scope === "project" && projectPath) {
      cliOptions.cwd = projectPath
    }
    const cliResult = runClaude(cliArgs, cliOptions)

    const after = await getInstalledPlugins()
    const afterRows = after[pluginKey] ?? []
    const afterSummary = summarizePluginState(after, pluginKey)

    const afterFirst = afterRows[0] ?? {}
    const versionChanged = firstRow.version !== afterFirst.version
    const updatedChanged = firstRow.lastUpdated !== afterFirst.lastUpdated
    const outputNoop = outputSuggestsNoopUpdate(cliResult)
    const verified = versionChanged || updatedChanged || outputNoop

    const reason = versionChanged
      ? `version changed: ${firstRow.version} -> ${afterFirst.version}`
      : updatedChanged
        ? `lastUpdated changed: ${firstRow.lastUpdated} -> ${afterFirst.lastUpdated}`
        : outputNoop
          ? "CLI output indicates already at latest version"
          : "could not confirm update from state or CLI output"

    const warning = cliResult.ok && !verified
      ? "CLI reported success but no version/lastUpdated change detected and output didn't indicate no-op. Possible CLI/schema drift."
      : null

    return buildMutationReply(
      `Update ${pluginKey}`,
      cliResult,
      { exitCode: cliResult.exitCode, verified, before: beforeSummary, after: afterSummary, reason, warning },
    )
  },
})

const update_all = tool({
  description: "Update all marketplaces and all installed plugins to latest versions in one operation. Returns per-item results.",
  args: {},
  async execute() {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."
    if (!await isClaudeAvailable()) return "Claude CLI not available."

    const lines = []
    lines.push("# Update All")
    lines.push("")

    // Phase 1: Update all marketplaces
    lines.push("## Phase 1: Marketplace Catalogs")
    lines.push("")

    const marketplacesBefore = await getKnownMarketplaces()
    const marketplaceCli = runClaude(["plugin", "marketplace", "update"])
    const marketplacesAfter = await getKnownMarketplaces()

    const mpTargets = Object.keys(marketplacesAfter)
    let mpChanged = 0
    for (const target of mpTargets) {
      const bs = summarizeMarketplaceState(marketplacesBefore, target)
      const as = summarizeMarketplaceState(marketplacesAfter, target)
      if (bs !== as) mpChanged += 1
    }

    const mpNoop = outputSuggestsNoopUpdate(marketplaceCli)
    const mpVerified = mpTargets.length > 0 && (mpChanged > 0 || mpNoop)

    if (marketplaceCli.ok) {
      lines.push(`✅ Marketplaces: ${mpChanged > 0 ? `${mpChanged} updated` : "all up to date"} (exit ${marketplaceCli.exitCode})`)
    } else {
      lines.push(`❌ Marketplaces: failed (exit ${marketplaceCli.exitCode})`)
      if (marketplaceCli.stderr.trim()) {
        lines.push(`   ${marketplaceCli.stderr.trim().split("\n")[0]}`)
      }
    }
    lines.push("")

    // Phase 2: Update all installed plugins
    lines.push("## Phase 2: Installed Plugins")
    lines.push("")

    const installedBefore = await getInstalledPlugins()
    const pluginKeys = Object.keys(installedBefore)

    if (!pluginKeys.length) {
      lines.push("No installed plugins to update.")
      return lines.join("\n")
    }

    let updated = 0
    let alreadyLatest = 0
    let failed = 0
    let unverified = 0
    const pluginResults = []

    for (const pluginKey of pluginKeys.sort()) {
      const rows = installedBefore[pluginKey] ?? []
      const firstRow = rows[0] ?? {}
      const scope = firstRow.scope ?? "user"
      const projectPath = firstRow.projectPath ?? null

      const cliArgs = ["plugin", "update", pluginKey, "--scope", scope]
      const cliOptions = { timeout: 120_000 }
      if (scope === "project" && projectPath) {
        cliOptions.cwd = projectPath
      }

      const result = runClaude(cliArgs, cliOptions)

      const afterData = await getInstalledPlugins()
      const afterRows = afterData[pluginKey] ?? []
      const afterFirst = afterRows[0] ?? {}

      const versionChanged = firstRow.version !== afterFirst.version
      const updatedChanged = firstRow.lastUpdated !== afterFirst.lastUpdated
      const noop = outputSuggestsNoopUpdate(result)
      const verified = versionChanged || updatedChanged || noop

      if (!result.ok) {
        failed += 1
        const errLine = result.stderr.trim().split("\n")[0] || "unknown error"
        lines.push(`❌ ${pluginKey}: ${errLine}`)
        pluginResults.push({ key: pluginKey, status: "failed", verified: false })
      } else if (versionChanged) {
        updated += 1
        lines.push(`🔄 ${pluginKey}: ${firstRow.version} → ${afterFirst.version}`)
        pluginResults.push({ key: pluginKey, status: "updated", verified: true })
      } else if (noop) {
        alreadyLatest += 1
        lines.push(`✅ ${pluginKey}: latest (${firstRow.version})`)
        pluginResults.push({ key: pluginKey, status: "latest", verified: true })
      } else if (updatedChanged) {
        updated += 1
        lines.push(`🔄 ${pluginKey}: metadata updated (${firstRow.version})`)
        pluginResults.push({ key: pluginKey, status: "updated", verified: true })
      } else {
        unverified += 1
        lines.push(`⚠️ ${pluginKey}: exit 0 but could not verify (${firstRow.version})`)
        pluginResults.push({ key: pluginKey, status: "unverified", verified: false })
      }
    }

    const allPluginsVerified = failed === 0 && unverified === 0
    const overallVerified = mpVerified && allPluginsVerified

    lines.push("")
    lines.push("## Verification")
    lines.push(`- overall_verified: ${overallVerified}`)
    lines.push(`- marketplaces_verified: ${mpVerified}`)
    lines.push(`- plugins_verified: ${allPluginsVerified} (${pluginKeys.length - failed - unverified}/${pluginKeys.length})`)
    lines.push("")
    lines.push("## Summary")
    lines.push(`- marketplaces: ${mpVerified ? "ok" : "unverified"} (${mpTargets.length} total, ${mpChanged} changed)`)
    lines.push(`- plugins_updated: ${updated}`)
    lines.push(`- plugins_already_latest: ${alreadyLatest}`)
    lines.push(`- plugins_failed: ${failed}`)
    lines.push(`- plugins_unverified: ${unverified}`)
    lines.push(`- total_plugins: ${pluginKeys.length}`)

    if (unverified > 0) {
      lines.push("")
      lines.push(`⚠️ ${unverified} plugin(s) could not be verified. CLI reported success but no version, lastUpdated, or output change detected. Possible CLI/schema drift.`)
    }

    if (updated > 0) {
      lines.push("")
      lines.push("Restart OpenCode to load updated plugin content.")
    }

    return lines.join("\n")
  },
})

function verifyEnableDisableOutput(cliResult, keyword, pluginKey) {
  const combined = `${cliResult.stdout}\n${cliResult.stderr}`.toLowerCase()
  const keywordOk = combined.includes(keyword)
  const pluginMention = combined.includes(pluginKey.toLowerCase())
  return keywordOk && pluginMention
}

function summarizeEnabledState(map, pluginKey) {
  if (!(pluginKey in map)) {
    return "missing"
  }
  return map[pluginKey] ? "enabled" : "disabled"
}

const plugin_enable = tool({
  description: "Enable plugin via Claude CLI. Verifies by checking CLI output for explicit enable confirmation.",
  args: {
    plugin: tool.schema.string().describe("Plugin identifier plugin@marketplace, or name if unique"),
    marketplace: tool.schema.string().optional().describe("Marketplace for name-only plugin value"),
    scope: tool.schema.enum(["user", "project", "local", "managed"]).optional().describe("Scope if needed by Claude CLI"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."
    if (!await isClaudeAvailable()) return "Claude CLI not available."

    const resolved = await resolvePluginTarget(args.plugin, args.marketplace)
    if (!resolved.ok) {
      const extra = resolved.candidates?.length ? `\nCandidates:\n- ${resolved.candidates.join("\n- ")}` : ""
      return `${resolved.reason}${extra}`
    }

    const pluginKey = resolved.target.key
    const beforeInstalled = await getInstalledPlugins()
    const beforeEnabled = await getEnabledPluginsMap()
    const beforeSummary = `${summarizePluginState(beforeInstalled, pluginKey)}; enabled_state=${summarizeEnabledState(beforeEnabled, pluginKey)}`

    const cliArgs = ["plugin", "enable", pluginKey]
    if (args.scope) cliArgs.push("--scope", args.scope)
    const cliResult = runClaude(cliArgs)

    const afterInstalled = await getInstalledPlugins()
    const afterEnabled = await getEnabledPluginsMap()
    const afterSummary = `${summarizePluginState(afterInstalled, pluginKey)}; enabled_state=${summarizeEnabledState(afterEnabled, pluginKey)}`
    const outputVerified = verifyEnableDisableOutput(cliResult, "enable", pluginKey)
    const stateVerified = beforeEnabled[pluginKey] === false && afterEnabled[pluginKey] === true
    const verified = stateVerified || outputVerified
    const warning = cliResult.ok && !verified
      ? "Enable command succeeded but neither settings state nor CLI output provided unambiguous confirmation. This may indicate CLI/settings schema drift."
      : null

    return buildMutationReply(
      `Enable ${pluginKey}`,
      cliResult,
      {
        exitCode: cliResult.exitCode,
        verified,
        before: beforeSummary,
        after: afterSummary,
        reason: stateVerified
          ? "enabledPlugins state transitioned false->true"
          : outputVerified
            ? "CLI output confirms enable operation"
            : "could not confirm enable transition from settings or output",
        warning,
      },
    )
  },
})

const plugin_disable = tool({
  description: "Disable plugin via Claude CLI. Verifies by checking CLI output for explicit disable confirmation.",
  args: {
    plugin: tool.schema.string().describe("Plugin identifier plugin@marketplace, or name if unique"),
    marketplace: tool.schema.string().optional().describe("Marketplace for name-only plugin value"),
    scope: tool.schema.enum(["user", "project", "local", "managed"]).optional().describe("Scope if needed by Claude CLI"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."
    if (!await isClaudeAvailable()) return "Claude CLI not available."

    const resolved = await resolvePluginTarget(args.plugin, args.marketplace)
    if (!resolved.ok) {
      const extra = resolved.candidates?.length ? `\nCandidates:\n- ${resolved.candidates.join("\n- ")}` : ""
      return `${resolved.reason}${extra}`
    }

    const pluginKey = resolved.target.key
    const beforeInstalled = await getInstalledPlugins()
    const beforeEnabled = await getEnabledPluginsMap()
    const beforeSummary = `${summarizePluginState(beforeInstalled, pluginKey)}; enabled_state=${summarizeEnabledState(beforeEnabled, pluginKey)}`

    const cliArgs = ["plugin", "disable", pluginKey]
    if (args.scope) cliArgs.push("--scope", args.scope)
    const cliResult = runClaude(cliArgs)

    const afterInstalled = await getInstalledPlugins()
    const afterEnabled = await getEnabledPluginsMap()
    const afterSummary = `${summarizePluginState(afterInstalled, pluginKey)}; enabled_state=${summarizeEnabledState(afterEnabled, pluginKey)}`
    const outputVerified = verifyEnableDisableOutput(cliResult, "disable", pluginKey)
    const stateVerified = beforeEnabled[pluginKey] === true && afterEnabled[pluginKey] === false
    const verified = stateVerified || outputVerified
    const warning = cliResult.ok && !verified
      ? "Disable command succeeded but neither settings state nor CLI output provided unambiguous confirmation. This may indicate CLI/settings schema drift."
      : null

    return buildMutationReply(
      `Disable ${pluginKey}`,
      cliResult,
      {
        exitCode: cliResult.exitCode,
        verified,
        before: beforeSummary,
        after: afterSummary,
        reason: stateVerified
          ? "enabledPlugins state transitioned true->false"
          : outputVerified
            ? "CLI output confirms disable operation"
            : "could not confirm disable transition from settings or output",
        warning,
      },
    )
  },
})

const marketplace_list = tool({
  description: "List registered marketplaces and loaded catalog details.",
  args: {},
  async execute() {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."

    const known = await getKnownMarketplaces()
    const catalogs = await getAllMarketplaceCatalogs()
    const names = new Set([...Object.keys(known), ...catalogs.map((c) => c.marketplaceName)])

    if (!names.size) {
      return "No marketplaces registered."
    }

    const lines = []
    lines.push(`**Marketplaces: ${names.size}**`)
    lines.push("")

    for (const name of Array.from(names).sort()) {
      const meta = known[name]
      const catalog = catalogs.find((row) => row.marketplaceName === name)
      const source = meta?.source?.repo ?? meta?.source?.url ?? meta?.source?.source ?? "unknown"
      const count = catalog?.catalog?.plugins?.length ?? 0
      const updated = meta?.lastUpdated ?? catalog?.mtime ?? "unknown"
      lines.push(`- ${name}: plugins=${count}, source=${source}, updated=${updated}`)
    }

    return lines.join("\n")
  },
})

const marketplace_add = tool({
  description: "Add marketplace using Claude CLI (`claude plugin marketplace add`) and verify known_marketplaces.json changed.",
  args: {
    source: tool.schema.string().describe("Marketplace source (owner/repo, git URL, local path, or marketplace.json URL)"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."
    if (!await isClaudeAvailable()) return "Claude CLI not available."

    const before = await getKnownMarketplaces()
    const cliResult = runClaude(["plugin", "marketplace", "add", args.source])
    const after = await getKnownMarketplaces()

    const beforeKeys = new Set(Object.keys(before))
    const afterKeys = new Set(Object.keys(after))
    const added = Array.from(afterKeys).filter((key) => !beforeKeys.has(key))
    const verified = added.length > 0
    const warning = cliResult.ok && !verified
      ? "CLI reported success but no new marketplace key appeared in known_marketplaces.json. Possible CLI/schema drift."
      : null
    const afterSummary = `${afterKeys.size} marketplace key(s)${added.length ? `, added=[${added.join(", ")}]` : ""}`

    return buildMutationReply(
      `Add marketplace ${args.source}`,
      cliResult,
      {
        exitCode: cliResult.exitCode,
        verified,
        before: `${beforeKeys.size} marketplace key(s)`,
        after: afterSummary,
        reason: verified ? "new marketplace key detected" : "no new key detected",
        warning,
      },
    )
  },
})

const marketplace_update = tool({
  description: "Update one marketplace or all marketplaces using Claude CLI and verify known_marketplaces.json timestamps.",
  args: {
    marketplace: tool.schema.string().optional().describe("Marketplace name. Omit to update all."),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."
    if (!await isClaudeAvailable()) return "Claude CLI not available."

    const before = await getKnownMarketplaces()
    const cliArgs = ["plugin", "marketplace", "update"]
    if (args.marketplace) cliArgs.push(args.marketplace)
    const cliResult = runClaude(cliArgs)
    const after = await getKnownMarketplaces()

    const targets = args.marketplace ? [args.marketplace] : Object.keys(after)
    let changed = 0
    let existingTargets = 0
    for (const target of targets) {
      if (!after[target]) continue
      existingTargets += 1
      const beforeState = summarizeMarketplaceState(before, target)
      const afterState = summarizeMarketplaceState(after, target)
      if (beforeState !== afterState) {
        changed += 1
      }
    }

    const outputNoop = outputSuggestsNoopUpdate(cliResult)
    const verified = existingTargets > 0 && (changed > 0 || outputNoop)
    const warning = cliResult.ok && !verified
      ? "CLI reported success but marketplace state could not be confirmed from known_marketplaces.json."
      : null

    return buildMutationReply(
      `Update marketplace${args.marketplace ? ` ${args.marketplace}` : "s"}`,
      cliResult,
      {
        exitCode: cliResult.exitCode,
        verified,
        before: `${Object.keys(before).length} marketplace key(s)`,
        after: `${Object.keys(after).length} marketplace key(s), changed=${changed}`,
        reason: changed > 0
          ? "one or more marketplace state entries changed"
          : outputNoop
            ? "CLI output indicates no-op update (already up-to-date)"
            : "could not confirm update/no-op from state or CLI output",
        warning,
      },
    )
  },
})

const marketplace_remove = tool({
  description: "Remove marketplace via Claude CLI and verify key removal in known_marketplaces.json.",
  args: {
    marketplace: tool.schema.string().describe("Marketplace name to remove"),
  },
  async execute(args) {
    if (!await isPluginSystemAvailable()) return "Plugin system not found."
    if (!await isClaudeAvailable()) return "Claude CLI not available."

    const before = await getKnownMarketplaces()
    const cliResult = runClaude(["plugin", "marketplace", "remove", args.marketplace])
    const after = await getKnownMarketplaces()

    const verified = Boolean(before[args.marketplace]) && !after[args.marketplace]
    const warning = cliResult.ok && !verified
      ? "CLI reported success but marketplace key still exists. Removal semantics may have changed."
      : null

    return buildMutationReply(
      `Remove marketplace ${args.marketplace}`,
      cliResult,
      {
        exitCode: cliResult.exitCode,
        verified,
        before: summarizeMarketplaceState(before, args.marketplace),
        after: summarizeMarketplaceState(after, args.marketplace),
        reason: verified ? "marketplace key removed" : "marketplace key still present or missing before remove",
        warning,
      },
    )
  },
})

export const ClaudeMarketplaceBridge = async () => {
  return {
    tool: {
      plugin_search,
      plugin_info,
      plugin_list,
      plugin_status,
      plugin_install,
      plugin_uninstall,
      plugin_update,
      plugin_enable,
      plugin_disable,
      marketplace_list,
      marketplace_add,
      marketplace_update,
      marketplace_remove,
      update_all,
    },
  }
}

export default ClaudeMarketplaceBridge
