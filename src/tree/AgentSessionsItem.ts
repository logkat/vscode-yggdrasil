import * as vscode from 'vscode';
import { AgentSession } from '../agents/IAgentProvider';

export class AgentSessionsItem extends vscode.TreeItem {
  constructor(public readonly sessions: AgentSession[]) {
    super('Agent Sessions', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'agentSessionsNode';
    this.iconPath = new vscode.ThemeIcon('robot');
    this.tooltip = 'Coding agent sessions associated with this worktree';
  }
}

export class AgentSessionItem extends vscode.TreeItem {
  constructor(public readonly session: AgentSession) {
    const statusPart = session.status
      ? ` · ${session.status}`
      : session.isArchived
        ? ' · archived'
        : '';
    super(`${session.agentLabel}${statusPart}`, vscode.TreeItemCollapsibleState.None);

    const idShort = session.sessionId.slice(0, 8);
    const namePart = session.name ? ` "${session.name}"` : '';
    this.description = `${idShort}${namePart}`;

    this.iconPath = AgentSessionItem.iconFor(session);
    this.contextValue = session.resumeCommand ? 'agentSessionItemCli' : 'agentSessionItem';
    this.tooltip = AgentSessionItem.buildTooltip(session);
    this.command = {
      command: session.resumeCommand ? 'ygg.copyAgentResumeCommand' : 'ygg.copyAgentSessionId',
      title: session.resumeCommand ? 'Copy Resume Command' : 'Copy Session ID',
      arguments: [session],
    };
  }

  private static iconFor(session: AgentSession): vscode.ThemeIcon {
    if (session.isArchived) {
      return new vscode.ThemeIcon('archive');
    }
    if (session.status === 'busy') {
      return new vscode.ThemeIcon('debug-alt', new vscode.ThemeColor('charts.green'));
    }
    if (session.status === 'idle') {
      return new vscode.ThemeIcon('circle-large-outline');
    }
    return new vscode.ThemeIcon('robot');
  }

  private static buildTooltip(session: AgentSession): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${session.agentLabel}\n\n`);
    md.appendMarkdown(`**Session:** \`${session.sessionId}\`\n\n`);
    if (session.name) {
      md.appendMarkdown(`**Name:** ${session.name}\n\n`);
    }
    if (session.status) {
      md.appendMarkdown(`**Status:** ${session.status}\n\n`);
    }
    if (session.isArchived) {
      md.appendMarkdown(`**Archived:** yes\n\n`);
    }
    if (session.resumeCommand) {
      md.appendMarkdown(`**Resume:** \`${session.resumeCommand}\`\n\n`);
      md.appendMarkdown(`*Click to copy resume command.*`);
    } else {
      md.appendMarkdown(`*Click to copy session ID.*`);
    }
    return md;
  }
}
