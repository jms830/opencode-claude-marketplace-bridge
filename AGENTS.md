# AGENTS.md - Coding Agent Guidelines

## Build & Run Commands
- **Install:** `npm install`
- **Run test:** `node -e "import('./index.js').then(m => m.ClaudeMarketplaceBridge({client:{},\$:{}}))"` (no test framework)
- **Lint:** None configured

## Code Style
- **Module type:** ES Modules (`"type": "module"` in package.json)
- **Imports:** Use explicit `.js` extension for local imports; use `@opencode-ai/plugin/tool` subpath import
- **Formatting:** 2-space indent, semicolons used
- **Naming:** camelCase for functions/variables, PascalCase for exports (e.g., `ClaudeMarketplaceBridge`)
- **Types:** Plain JavaScript with JSDoc comments where helpful
- **Error handling:** Use try/catch, log errors with `console.error("[claude-bridge] ...")`, return gracefully

## Key Patterns
- **Tool names:** Max 64 chars, pattern `^[a-zA-Z0-9_-]+$`, use `__` as namespace separator
- **CLI wrapper:** Use `execSync` with timeout, return `{ success, output, error }` objects
- **Async generators:** `async function* walk(dir)` for directory traversal
- **Tool registration:** Use `tool()` from `@opencode-ai/plugin/tool` with `tool.schema` for Zod schemas

## Plugin Usage
- `claude_run <command>` - Run command by name (e.g., `claude_run commit`)
- `claude_list` - List all commands by marketplace
- `claude_search_commands <query>` - Search commands
