import { access, readFile, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const pluginsRoot = join(homedir(), ".claude", "plugins")

function safeDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, "utf-8")
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function getPluginsRoot() {
  return pluginsRoot
}

export async function isPluginSystemAvailable() {
  try {
    await access(pluginsRoot)
    return true
  } catch {
    return false
  }
}

export async function getKnownMarketplaces() {
  return await readJson(join(pluginsRoot, "known_marketplaces.json"), {})
}

export async function getInstalledPluginsData() {
  return await readJson(join(pluginsRoot, "installed_plugins.json"), { version: 0, plugins: {} })
}

export async function getInstalledPlugins() {
  const data = await getInstalledPluginsData()
  return data?.plugins ?? {}
}

export async function getConfig() {
  return await readJson(join(pluginsRoot, "config.json"), {})
}

export async function getClaudeSettings() {
  return await readJson(join(homedir(), ".claude", "settings.json"), {})
}

export async function getProjectClaudeSettings() {
  const cwd = process.cwd()
  return await readJson(join(cwd, ".claude", "settings.json"), {})
}

export async function getEnabledPluginsMap() {
  const userSettings = await getClaudeSettings()
  const projectSettings = await getProjectClaudeSettings()
  const userMap = userSettings?.enabledPlugins ?? {}
  const projectMap = projectSettings?.enabledPlugins ?? {}
  // Project-level overrides user-level (Claude CLI writes project-scope
  // enable/disable to <project>/.claude/settings.json, not ~/.claude/)
  const merged = {}
  if (typeof userMap === "object") Object.assign(merged, userMap)
  if (typeof projectMap === "object") Object.assign(merged, projectMap)
  return merged
}

export async function getInstallCountsMap() {
  const data = await readJson(join(pluginsRoot, "install-counts-cache.json"), { counts: [] })
  const map = {}
  for (const row of data?.counts ?? []) {
    if (row?.plugin && typeof row?.unique_installs === "number") {
      map[row.plugin] = row.unique_installs
    }
  }
  return map
}

async function discoverMarketplaceNames() {
  const known = await getKnownMarketplaces()
  const knownNames = Object.keys(known)
  const discovered = new Set(knownNames)

  try {
    const entries = await readdir(join(pluginsRoot, "marketplaces"), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        discovered.add(entry.name)
      }
    }
  } catch {
    // ignore
  }

  return Array.from(discovered)
}

export async function getMarketplaceCatalog(marketplaceName) {
  const path = join(pluginsRoot, "marketplaces", marketplaceName, ".claude-plugin", "marketplace.json")
  const catalog = await readJson(path, null)
  if (!catalog) return null

  let mtime = null
  try {
    const s = await stat(path)
    mtime = s.mtime.toISOString()
  } catch {
    // ignore
  }

  return { marketplaceName, path, mtime, catalog }
}

export async function getAllMarketplaceCatalogs() {
  const marketplaceNames = await discoverMarketplaceNames()
  const result = []

  for (const name of marketplaceNames) {
    const item = await getMarketplaceCatalog(name)
    if (item) {
      result.push(item)
    }
  }

  return result
}

export function normalizePluginIdentifier(inputPlugin, marketplace) {
  const trimmed = (inputPlugin ?? "").trim()
  if (!trimmed) return ""
  if (trimmed.includes("@")) return trimmed
  if (!marketplace) return trimmed
  return `${trimmed}@${marketplace}`
}

export function splitPluginIdentifier(identifier) {
  if (!identifier?.includes("@")) {
    return { name: identifier, marketplace: null }
  }
  const index = identifier.lastIndexOf("@")
  return {
    name: identifier.slice(0, index),
    marketplace: identifier.slice(index + 1),
  }
}

export async function getAvailablePlugins() {
  const catalogs = await getAllMarketplaceCatalogs()
  const installs = await getInstallCountsMap()
  const installed = await getInstalledPlugins()
  const rows = []

  for (const { marketplaceName, catalog } of catalogs) {
    for (const plugin of catalog?.plugins ?? []) {
      if (!plugin?.name) continue
      const key = `${plugin.name}@${marketplaceName}`
      const installRows = installed[key] ?? []
      const firstInstall = installRows[0] ?? null

      rows.push({
        key,
        name: plugin.name,
        marketplace: marketplaceName,
        description: plugin.description ?? "",
        version: plugin.version ?? null,
        category: plugin.category ?? null,
        homepage: plugin.homepage ?? null,
        tags: Array.isArray(plugin.tags) ? plugin.tags : [],
        author: plugin.author?.name ?? catalog.owner?.name ?? null,
        strict: Boolean(plugin.strict),
        installs: installs[key] ?? 0,
        installed: installRows.length > 0,
        installedRows: installRows,
        installPath: firstInstall?.installPath ?? null,
        installedVersion: firstInstall?.version ?? null,
        installedAt: firstInstall?.installedAt ?? null,
        lastUpdated: firstInstall?.lastUpdated ?? null,
        hasSkills: Boolean(plugin.skills),
        hasLsp: Boolean(plugin.lspServers),
      })
    }
  }

  return rows
}

export function summarizeInstalled(installed) {
  const result = []
  for (const [key, rows] of Object.entries(installed ?? {})) {
    const { name, marketplace } = splitPluginIdentifier(key)
    const first = rows?.[0] ?? {}
    result.push({
      key,
      name,
      marketplace,
      scope: first.scope ?? null,
      projectPath: first.projectPath ?? null,
      installPath: first.installPath ?? null,
      version: first.version ?? null,
      installedAt: first.installedAt ?? null,
      lastUpdated: first.lastUpdated ?? null,
      _installedAtDate: safeDate(first.installedAt),
      _lastUpdatedDate: safeDate(first.lastUpdated),
    })
  }
  return result
}
