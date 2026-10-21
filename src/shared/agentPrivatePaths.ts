/**
 * Paths under `<harnessHome>/private/` that agents must not share through the
 * hive folder (issue #63). Kept pure so tests can pin the layout without
 * Electron or a live office.
 */
import { join } from 'node:path';

/** App-private root beside `hive/`, never inside an agent workspace. */
export function privateRoot(harnessHome: string): string {
  return join(harnessHome, 'private');
}

/** Per-agent MCP config that holds that agent's broker token (md-mail). */
export function agentMcpDir(harnessHome: string, agentId: string): string {
  return join(privateRoot(harnessHome), 'agent-mcp', agentId);
}

export function mdMailMcpPath(harnessHome: string, agentId: string): string {
  return join(agentMcpDir(harnessHome, agentId), 'md-mail.mcp.json');
}

/** Legacy hive path that sibling agents (and Michael) could read. */
export function legacyMdMailMcpPath(hiveRoot: string, agentId: string): string {
  return join(hiveRoot, 'agents', agentId, 'md-mail.mcp.json');
}

/** Owner dock mail and state: was under `hive/agents/human/`. */
export function privateOwnerDir(harnessHome: string): string {
  return join(privateRoot(harnessHome), 'owner');
}

export function privateOwnerSentDir(harnessHome: string): string {
  return join(privateOwnerDir(harnessHome), 'outbox', '.sent');
}

export function privateOwnerStatePath(harnessHome: string): string {
  return join(privateOwnerDir(harnessHome), 'state.json');
}

export function legacyOwnerSentDir(hiveRoot: string): string {
  return join(hiveRoot, 'agents', 'human', 'outbox', '.sent');
}

export function legacyOwnerStatePath(hiveRoot: string): string {
  return join(hiveRoot, 'agents', 'human', 'state.json');
}

/**
 * Map every plugin the owner has turned on to `false`, so a per-session
 * settings file can turn them off without editing ~/.claude. Empty when none
 * are on or the file is missing.
 */
export function pluginsDisabledForSession(enabledPlugins: unknown): Record<string, false> {
  if (!enabledPlugins || typeof enabledPlugins !== 'object' || Array.isArray(enabledPlugins)) return {};
  const out: Record<string, false> = {};
  for (const [id, on] of Object.entries(enabledPlugins as Record<string, unknown>)) {
    if (on === true || on === 'true') out[id] = false;
  }
  return out;
}
