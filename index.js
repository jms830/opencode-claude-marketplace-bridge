// Claude Plugin Browser for OpenCode
// Launches Claude's /plugin marketplace TUI natively

import { tool } from "@opencode-ai/plugin/tool"
import { execSync } from "child_process"

function isTmuxInstalled() {
  try {
    execSync("which tmux", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}

function getTmuxInstallInstructions() {
  const platform = process.platform
  if (platform === "darwin") return "brew install tmux"
  if (platform === "linux") {
    try { execSync("which apt-get", { stdio: ["pipe", "pipe", "pipe"] }); return "sudo apt-get install tmux" } catch {}
    try { execSync("which dnf", { stdio: ["pipe", "pipe", "pipe"] }); return "sudo dnf install tmux" } catch {}
    try { execSync("which pacman", { stdio: ["pipe", "pipe", "pipe"] }); return "sudo pacman -S tmux" } catch {}
    return "Install tmux using your package manager"
  }
  return "Install tmux for your system"
}

function launchPluginBrowser() {
  const sessionName = `claude-plugins-${Date.now().toString(36)}`
  
  try {
    execSync(`tmux new-session -d -s "${sessionName}" 'claude "/plugin"'`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    })
    return { success: true, sessionName }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function listClaudeSessions() {
  try {
    const result = execSync("tmux list-sessions 2>/dev/null", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    return result.trim().split('\n').filter(s => s.startsWith('claude-'))
  } catch {
    return []
  }
}

function killSession(name) {
  try {
    execSync(`tmux kill-session -t "${name}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}

export const ClaudeMarketplaceBridge = async () => {
  return {
    tool: {
      claude_plugin_browser: tool({
        description: "Launch Claude's plugin marketplace browser. Opens the /plugin TUI where you can browse, search, and install plugins.",
        args: {},
        async execute() {
          if (!isTmuxInstalled()) {
            return `**tmux required but not installed.**\n\nInstall: \`${getTmuxInstallInstructions()}\``
          }
          
          const result = launchPluginBrowser()
          
          if (!result.success) {
            return `Failed to launch: ${result.error}`
          }
          
          return `# Claude Plugin Marketplace

**Session:** \`${result.sessionName}\`

## Attach now:
\`\`\`bash
tmux attach -t ${result.sessionName}
\`\`\`

**Controls:**
- Arrow keys to navigate
- Enter to select/install
- \`q\` to exit
- \`Ctrl+b d\` to detach without closing

Installed plugins auto-load on OpenCode restart (via oh-my-opencode).`
        }
      }),

      claude_sessions: tool({
        description: "Manage Claude tmux sessions",
        args: {
          action: tool.schema.enum(["list", "kill", "kill-all"]).optional().describe("Action (default: list)"),
          session: tool.schema.string().optional().describe("Session name for kill")
        },
        async execute(args) {
          if (!isTmuxInstalled()) return "tmux not installed."
          
          const action = args.action || "list"
          const sessions = listClaudeSessions()
          
          if (action === "list") {
            if (sessions.length === 0) return "No active Claude sessions."
            return `# Active Sessions\n\n${sessions.map(s => `- \`${s.split(':')[0]}\``).join('\n')}\n\n**Attach:** \`tmux attach -t <name>\``
          }
          
          if (action === "kill") {
            if (!args.session) return "Specify session name."
            return killSession(args.session) ? `Killed: ${args.session}` : "Failed."
          }
          
          if (action === "kill-all") {
            if (sessions.length === 0) return "No sessions to kill."
            let killed = 0
            for (const s of sessions) { if (killSession(s.split(':')[0])) killed++ }
            return `Killed ${killed}/${sessions.length} sessions.`
          }
          
          return "Unknown action."
        }
      })
    }
  }
}
