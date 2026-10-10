import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export const SKILL_NAME = 'minuet';

export interface Agent {
  label: string;
  /** User-level skills folder, relative to the home directory. */
  skillsDir: string;
  /** Folders whose presence means the agent is installed, relative to the home directory. */
  markers: string[];
}

/** User-level skills folders of the agents that follow the Agent Skills standard (agentskills.io). */
export const AGENTS: Agent[] = [
  { label: 'Claude Code', skillsDir: '.claude/skills', markers: ['.claude'] },
  { label: 'Codex, Cline, Zed, Warp', skillsDir: '.agents/skills', markers: ['.codex', '.agents', '.cline'] },
  { label: 'Cursor', skillsDir: '.cursor/skills', markers: ['.cursor'] },
  { label: 'GitHub Copilot', skillsDir: '.copilot/skills', markers: ['.copilot'] },
  { label: 'Gemini CLI', skillsDir: '.gemini/skills', markers: ['.gemini'] },
  { label: 'Antigravity', skillsDir: '.gemini/antigravity/skills', markers: ['.gemini/antigravity'] },
  { label: 'Windsurf', skillsDir: '.codeium/windsurf/skills', markers: ['.codeium/windsurf'] },
  { label: 'OpenCode', skillsDir: '.config/opencode/skills', markers: ['.config/opencode'] },
];

/** Folder where the skill goes for an agent. */
export function skillDir(agent: Agent, home = os.homedir()): string {
  return path.join(home, agent.skillsDir, SKILL_NAME);
}

export function isDetected(agent: Agent, home = os.homedir(), exists: (p: string) => boolean = fs.existsSync): boolean {
  return agent.markers.some((marker) => exists(path.join(home, marker)));
}

async function readIfExists(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
}

interface AgentPick extends vscode.QuickPickItem {
  dir?: string;
}

/** Asks which agents get the skill. The detected ones come preselected. */
async function pickTargets(): Promise<string[] | undefined> {
  const home = os.homedir();
  const items: AgentPick[] = AGENTS.map((agent) => ({
    label: agent.label,
    description: `~/${agent.skillsDir}`,
    picked: isDetected(agent, home),
    dir: skillDir(agent, home),
  }));
  items.push({ label: 'Other agent…', description: 'choose its skills folder' });
  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Install the minuet skill',
    placeHolder: 'Agents to install it for (the ones found on this machine are selected)',
  });
  if (!picks || picks.length === 0) {
    return undefined;
  }
  const dirs = picks.flatMap((pick) => (pick.dir ? [pick.dir] : []));
  if (picks.some((pick) => !pick.dir)) {
    const folder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      defaultUri: vscode.Uri.file(home),
      openLabel: 'Install Here',
      title: "Choose the agent's skills folder",
    });
    if (!folder) {
      return undefined;
    }
    dirs.push(path.join(folder[0].fsPath, SKILL_NAME));
  }
  return dirs;
}

/** Copies the bundled skill so coding agents know how to build and import tours, in any repository. */
export async function installAgentSkill(extensionUri: vscode.Uri): Promise<void> {
  const dirs = await pickTargets();
  if (!dirs) {
    return;
  }
  const content = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'skills', SKILL_NAME, 'SKILL.md'));
  const targets = dirs.map((dir) => vscode.Uri.file(path.join(dir, 'SKILL.md')));
  const existing = await Promise.all(targets.map(readIfExists));
  const pending = targets.filter((_, i) => !existing[i] || !Buffer.from(existing[i]).equals(Buffer.from(content)));
  const replaced = targets.filter((_, i) => existing[i] && pending.includes(targets[i]));
  const tilde = (uri: vscode.Uri): string => uri.fsPath.replace(os.homedir(), '~');

  if (pending.length === 0) {
    void vscode.window.showInformationMessage('The minuet skill is already installed and up to date.');
    return;
  }
  if (replaced.length > 0) {
    const replace = 'Replace';
    const choice = await vscode.window.showWarningMessage(
      'A "minuet" skill with different content is already installed.',
      {
        modal: true,
        detail: `${replaced.map(tilde).join('\n')}\n\nIt will be replaced with the version bundled with the extension.`,
      },
      replace,
    );
    if (choice !== replace) {
      return;
    }
  }
  for (const target of pending) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await vscode.workspace.fs.writeFile(target, content);
  }
  const open = 'Open';
  const choice = await vscode.window.showInformationMessage(
    `Skill installed in ${pending.map(tilde).join(', ')}. Agents use it when you ask them to explain a flow with the debugger (in new sessions).`,
    open,
  );
  if (choice === open) {
    await vscode.window.showTextDocument(pending[0]);
  }
}
