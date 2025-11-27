// Claude Marketplace Bridge Plugin for OpenCode
// Bridges Claude Code's plugin/marketplace ecosystem into OpenCode
// 
// Features:
// - Discovers and registers commands/skills/agents from Claude marketplaces
// - Provides tools to manage Claude marketplaces (add, remove, update, list)
// - Provides tools to manage Claude plugins (install, uninstall, enable, disable)
// - Wraps the `claude` CLI for full marketplace management from within OpenCode
// - No file copying or symlinking - pure dynamic discovery

import fs from "fs/promises"
import path from "path"
import { tool } from "@opencode-ai/plugin/tool"
import matter from "gray-matter"
import { execSync } from "child_process"

// ============================================================================
// Utility Functions
// ============================================================================

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function* walk(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(full)
    } else if (e.isFile()) {
      yield full
    }
  }
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function truncateToolName(name, maxLen) {
  if (name.length <= maxLen) return name
  return name.substring(0, maxLen)
}

function getMarketplaceName(filePath, marketplacesRoot) {
  const rel = path.relative(marketplacesRoot, filePath).split(path.sep)
  return rel.length ? rel[0] : "unknown"
}

function isCommandFile(filePath) {
  if (!filePath.endsWith(".md")) return false
  const p = filePath.replace(/\\/g, "/")
  if (p.toLowerCase().endsWith("/readme.md")) return false
  return p.includes("/commands/") || p.includes("/workflows/")
}

function isSkillFile(filePath) {
  return path.basename(filePath).toUpperCase() === "SKILL.md"
}

// ============================================================================
// Claude CLI Wrapper
// ============================================================================

function runClaudeCLI(args, timeout = 30000) {
  try {
    const result = execSync(`claude ${args}`, {
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"]
    })
    return { success: true, output: result.trim() }
  } catch (err) {
    const stderr = err.stderr?.toString() || ""
    const stdout = err.stdout?.toString() || ""
    return { 
      success: false, 
      output: stderr || stdout || err.message,
      error: err.message
    }
  }
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Fallback frontmatter parser for files with YAML syntax issues
 * Extracts key-value pairs line by line, handles unquoted special chars
 */
function parseFrontmatterLoose(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { data: {}, content: content }
  }
  
  const frontmatter = match[1]
  const body = match[2]
  const data = {}
  
  for (const line of frontmatter.split('\n')) {
    // Match key: value, handling colons in the value
    const keyMatch = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (keyMatch) {
      const key = keyMatch[1].trim()
      let value = keyMatch[2].trim()
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      data[key] = value
    }
  }
  
  return { data, content: body }
}

async function parseCommand(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8")
    let data, template
    
    try {
      // Try strict YAML parsing first
      const parsed = matter(content)
      data = parsed.data
      template = parsed.content
    } catch (yamlErr) {
      // Fallback to loose parsing for files with YAML issues
      const parsed = parseFrontmatterLoose(content)
      data = parsed.data
      template = parsed.content
    }
    
    return {
      template: template.trim(),
      description: data.description || "Command from Claude marketplace",
      agent: data.agent,
      model: data.model,
      subtask: data.subtask
    }
  } catch (err) {
    console.error(`[claude-bridge] Failed to parse command ${filePath}:`, err.message)
    return null
  }
}

async function parseSkill(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8")
    let data, instructions
    
    try {
      // Try strict YAML parsing first
      const parsed = matter(content)
      data = parsed.data
      instructions = parsed.content
    } catch (yamlErr) {
      // Fallback to loose parsing for files with YAML issues
      const parsed = parseFrontmatterLoose(content)
      data = parsed.data
      instructions = parsed.content
    }
    
    const skillDir = path.dirname(filePath)
    const skillName = data.name || path.basename(skillDir)
    
    if (!data.description || data.description.length < 10) {
      return null
    }
    
    return {
      name: skillName,
      description: data.description,
      instructions: instructions.trim(),
      baseDir: skillDir,
      allowedTools: data["allowed-tools"] || [],
      license: data.license,
      metadata: data.metadata || {}
    }
  } catch (err) {
    console.error(`[claude-bridge] Failed to parse skill ${filePath}:`, err.message)
    return null
  }
}

// ============================================================================
// Discovery Functions
// ============================================================================

async function discoverMarketplaces(marketplacesRoot) {
  const commands = new Map()
  const skills = new Map()
  
  if (!await exists(marketplacesRoot)) {
    console.log(`[claude-bridge] Claude marketplaces directory not found: ${marketplacesRoot}`)
    return { commands, skills }
  }
  
  for await (const file of walk(marketplacesRoot)) {
    const marketplace = getMarketplaceName(file, marketplacesRoot)
    
    if (isCommandFile(file)) {
      const basename = path.basename(file, ".md")
      const commandName = slug(basename)
      const namespacedName = `${commandName}__${slug(marketplace)}`
      
      const config = await parseCommand(file)
      if (config) {
        commands.set(namespacedName, {
          filePath: file,
          marketplace,
          basename,
          config
        })
      }
    }
    
    if (isSkillFile(file)) {
      const skillConfig = await parseSkill(file)
      if (skillConfig) {
        const namespacedName = `${slug(skillConfig.name)}_${slug(marketplace)}`
        skills.set(namespacedName, {
          filePath: file,
          marketplace,
          config: skillConfig
        })
      }
    }
  }
  
  return { commands, skills }
}

// ============================================================================
// Plugin Entry Point
// ============================================================================

export const ClaudeMarketplaceBridge = async ({ client, $ }) => {
  const home = process.env.HOME || process.env.USERPROFILE || "/home/jordan"
  const marketplacesRoot = path.join(home, ".claude/plugins/marketplaces")
  
  // Discover on initialization
  const { commands, skills } = await discoverMarketplaces(marketplacesRoot)
  
  console.log(`[claude-bridge] Discovered ${commands.size} commands and ${skills.size} skills from Claude marketplaces`)
  
  // Build dynamic tools object
  const dynamicTools = {}
  
  // ========================================================================
  // MARKETPLACE MANAGEMENT TOOLS (wrapping claude CLI)
  // ========================================================================
  
  dynamicTools.claude_marketplace_list = tool({
    description: "List all configured Claude Code marketplaces",
    args: {},
    async execute() {
      const result = runClaudeCLI("plugin marketplace list")
      return result.output
    }
  })
  
  dynamicTools.claude_marketplace_add = tool({
    description: "Add a new Claude Code marketplace from a URL, path, or GitHub repo (e.g., 'anthropics/skills' or 'https://github.com/user/repo.git')",
    args: {
      source: tool.schema.string().describe("GitHub repo (user/repo), git URL, or local path")
    },
    async execute(args) {
      const result = runClaudeCLI(`plugin marketplace add "${args.source}"`)
      if (result.success) {
        return `Successfully added marketplace: ${args.source}\n\n${result.output}`
      }
      return `Failed to add marketplace: ${result.output}`
    }
  })
  
  dynamicTools.claude_marketplace_remove = tool({
    description: "Remove a configured Claude Code marketplace",
    args: {
      name: tool.schema.string().describe("Name of the marketplace to remove")
    },
    async execute(args) {
      const result = runClaudeCLI(`plugin marketplace remove "${args.name}"`)
      if (result.success) {
        return `Successfully removed marketplace: ${args.name}\n\n${result.output}`
      }
      return `Failed to remove marketplace: ${result.output}`
    }
  })
  
  dynamicTools.claude_marketplace_update = tool({
    description: "Update Claude Code marketplace(s) from their source. Updates all if no name specified.",
    args: {
      name: tool.schema.string().optional().describe("Name of marketplace to update (optional, updates all if omitted)")
    },
    async execute(args) {
      const cmd = args.name 
        ? `plugin marketplace update "${args.name}"`
        : "plugin marketplace update"
      const result = runClaudeCLI(cmd, 60000) // longer timeout for updates
      return result.output
    }
  })
  
  // ========================================================================
  // PLUGIN MANAGEMENT TOOLS (wrapping claude CLI)
  // ========================================================================
  
  dynamicTools.claude_plugin_install = tool({
    description: "Install a plugin from Claude Code marketplaces. Use plugin@marketplace for specific marketplace.",
    args: {
      plugin: tool.schema.string().describe("Plugin name (or plugin@marketplace for specific source)")
    },
    async execute(args) {
      const result = runClaudeCLI(`plugin install "${args.plugin}"`, 60000)
      if (result.success) {
        return `Successfully installed plugin: ${args.plugin}\n\n${result.output}\n\nRestart OpenCode to activate new commands/skills.`
      }
      return `Failed to install plugin: ${result.output}`
    }
  })
  
  dynamicTools.claude_plugin_uninstall = tool({
    description: "Uninstall an installed Claude Code plugin",
    args: {
      plugin: tool.schema.string().describe("Plugin name to uninstall")
    },
    async execute(args) {
      const result = runClaudeCLI(`plugin uninstall "${args.plugin}"`)
      if (result.success) {
        return `Successfully uninstalled plugin: ${args.plugin}\n\n${result.output}`
      }
      return `Failed to uninstall plugin: ${result.output}`
    }
  })
  
  dynamicTools.claude_plugin_enable = tool({
    description: "Enable a disabled Claude Code plugin",
    args: {
      plugin: tool.schema.string().describe("Plugin name to enable")
    },
    async execute(args) {
      const result = runClaudeCLI(`plugin enable "${args.plugin}"`)
      return result.output
    }
  })
  
  dynamicTools.claude_plugin_disable = tool({
    description: "Disable an enabled Claude Code plugin",
    args: {
      plugin: tool.schema.string().describe("Plugin name to disable")
    },
    async execute(args) {
      const result = runClaudeCLI(`plugin disable "${args.plugin}"`)
      return result.output
    }
  })
  
  dynamicTools.claude_plugin_validate = tool({
    description: "Validate a Claude Code plugin or marketplace manifest",
    args: {
      path: tool.schema.string().describe("Path to plugin or marketplace to validate")
    },
    async execute(args) {
      const result = runClaudeCLI(`plugin validate "${args.path}"`)
      return result.output
    }
  })
  
  // ========================================================================
  // MCP SERVER MANAGEMENT TOOLS (wrapping claude CLI)
  // ========================================================================
  
  dynamicTools.claude_mcp_list = tool({
    description: "List all configured MCP servers in Claude Code",
    args: {},
    async execute() {
      const result = runClaudeCLI("mcp list")
      return result.output
    }
  })
  
  dynamicTools.claude_mcp_add = tool({
    description: "Add an MCP server to Claude Code",
    args: {
      name: tool.schema.string().describe("Name for the MCP server"),
      command_or_url: tool.schema.string().describe("Command to run or URL for HTTP/SSE server"),
      transport: tool.schema.enum(["stdio", "http", "sse"]).optional().describe("Transport type (default: stdio)"),
      args: tool.schema.string().optional().describe("Additional arguments for the command")
    },
    async execute(args) {
      let cmd = `mcp add`
      if (args.transport) {
        cmd += ` --transport ${args.transport}`
      }
      cmd += ` "${args.name}" "${args.command_or_url}"`
      if (args.args) {
        cmd += ` ${args.args}`
      }
      const result = runClaudeCLI(cmd)
      return result.output
    }
  })
  
  dynamicTools.claude_mcp_remove = tool({
    description: "Remove an MCP server from Claude Code",
    args: {
      name: tool.schema.string().describe("Name of the MCP server to remove")
    },
    async execute(args) {
      const result = runClaudeCLI(`mcp remove "${args.name}"`)
      return result.output
    }
  })
  
  dynamicTools.claude_mcp_get = tool({
    description: "Get details about a specific MCP server",
    args: {
      name: tool.schema.string().describe("Name of the MCP server")
    },
    async execute(args) {
      const result = runClaudeCLI(`mcp get "${args.name}"`)
      return result.output
    }
  })
  
  // ========================================================================
  // DISCOVERY & REFRESH TOOLS
  // ========================================================================
  
  dynamicTools.claude_marketplace_refresh = tool({
    description: "Refresh and rediscover Claude marketplace commands and skills (shows what's available)",
    args: {},
    async execute() {
      const { commands: newCmds, skills: newSkills } = await discoverMarketplaces(marketplacesRoot)
      
      let output = `# Claude Marketplace Discovery\n\n`
      output += `**Commands:** ${newCmds.size}\n`
      output += `**Skills:** ${newSkills.size}\n\n`
      
      // Group by marketplace
      const byMarketplace = {}
      for (const [name, data] of newCmds) {
        const mp = data.marketplace
        if (!byMarketplace[mp]) byMarketplace[mp] = { commands: [], skills: [] }
        byMarketplace[mp].commands.push(data.basename)
      }
      for (const [name, data] of newSkills) {
        const mp = data.marketplace
        if (!byMarketplace[mp]) byMarketplace[mp] = { commands: [], skills: [] }
        byMarketplace[mp].skills.push(data.config.name)
      }
      
      for (const [mp, content] of Object.entries(byMarketplace)) {
        output += `## ${mp}\n`
        if (content.commands.length) {
          output += `Commands: ${content.commands.slice(0, 10).join(", ")}${content.commands.length > 10 ? ` (+${content.commands.length - 10} more)` : ""}\n`
        }
        if (content.skills.length) {
          output += `Skills: ${content.skills.join(", ")}\n`
        }
        output += "\n"
      }
      
      output += `\nRestart OpenCode to activate newly discovered content.`
      return output
    }
  })
  
  dynamicTools.claude_search_commands = tool({
    description: "Search for Claude marketplace commands by name or description",
    args: {
      query: tool.schema.string().describe("Search query")
    },
    async execute(args) {
      const { commands } = await discoverMarketplaces(marketplacesRoot)
      const query = args.query.toLowerCase()
      const matches = []
      
      for (const [name, data] of commands) {
        if (name.includes(query) || data.config.description.toLowerCase().includes(query)) {
          matches.push({
            name: data.basename,
            marketplace: data.marketplace,
            description: data.config.description.slice(0, 100),
            tool: `claude_cmd_${name}`
          })
        }
      }
      
      if (matches.length === 0) {
        return `No commands found matching "${args.query}"`
      }
      
      let output = `# Found ${matches.length} commands matching "${args.query}"\n\n`
      for (const m of matches.slice(0, 20)) {
        output += `- **${m.name}** (${m.marketplace})\n  ${m.description}\n  Tool: \`${m.tool}\`\n\n`
      }
      
      if (matches.length > 20) {
        output += `\n...and ${matches.length - 20} more`
      }
      
      return output
    }
  })
  
  dynamicTools.claude_search_skills = tool({
    description: "Search for Claude marketplace skills by name or description",
    args: {
      query: tool.schema.string().describe("Search query")
    },
    async execute(args) {
      const { skills } = await discoverMarketplaces(marketplacesRoot)
      const query = args.query.toLowerCase()
      const matches = []
      
      for (const [name, data] of skills) {
        if (name.includes(query) || data.config.description.toLowerCase().includes(query)) {
          matches.push({
            name: data.config.name,
            marketplace: data.marketplace,
            description: data.config.description.slice(0, 100),
            tool: `claude_skill_${name}`
          })
        }
      }
      
      if (matches.length === 0) {
        return `No skills found matching "${args.query}"`
      }
      
      let output = `# Found ${matches.length} skills matching "${args.query}"\n\n`
      for (const m of matches) {
        output += `- **${m.name}** (${m.marketplace})\n  ${m.description}\n  Tool: \`${m.tool}\`\n\n`
      }
      
      return output
    }
  })
  
  // ========================================================================
  // SKILL TOOLS (dynamically registered)
  // Skills return their instructions for the LLM to follow
  // ========================================================================
  
  for (const [toolName, skillData] of skills.entries()) {
    const { config, marketplace } = skillData
    const truncatedName = truncateToolName(toolName, 51)  // 64 - 13 ("claude_skill_")

    dynamicTools[`claude_skill_${truncatedName}`] = tool({
      description: `[Skill: ${marketplace}] ${config.description}`,
      args: {},
      async execute() {
        // Return the skill instructions for the LLM to process
        return `# Skill: ${config.name}\n\n**Base directory:** ${config.baseDir}\n\n---\n\n${config.instructions}`
      }
    })
  }
  
  // ========================================================================
  // COMMAND TOOLS (dynamically registered)
  // Commands return expanded templates for the LLM to execute
  // ========================================================================
  
  for (const [cmdName, cmdData] of commands.entries()) {
    const { config, marketplace, basename } = cmdData
    const truncatedName = truncateToolName(cmdName, 53)  // 64 - 11 ("claude_cmd_")

    dynamicTools[`claude_cmd_${truncatedName}`] = tool({
      description: `[Cmd: ${marketplace}] ${config.description}`,
      args: {
        arguments: tool.schema.string().optional().describe("Arguments to pass to the command")
      },
      async execute(args) {
        let template = config.template
        
        // Replace $ARGUMENTS placeholder
        if (args.arguments) {
          template = template.replace(/\$ARGUMENTS/g, args.arguments)
          
          // Replace positional args ($1, $2, etc.)
          const argParts = args.arguments.split(/\s+/)
          argParts.forEach((arg, i) => {
            template = template.replace(new RegExp(`\\$${i + 1}`, 'g'), arg)
          })
        }
        
        // Return the expanded template for the LLM to execute
        return `# Command: ${basename} (${marketplace})\n\n${template}`
      }
    })
  }
  
  return {
    tool: dynamicTools
  }
}
