import * as assert from 'assert';
import * as vscode from 'vscode';
import { AgentSessionsItem, AgentSessionItem } from '../../tree/AgentSessionsItem';
import { AgentSession } from '../../agents/IAgentProvider';

function sess(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    agent: 'claude-code',
    agentLabel: 'Claude Code',
    sessionId: 'abc123de-0000-0000-0000-000000000000',
    ...overrides,
  };
}

suite('AgentSessionsItem', () => {
  test('label is "Agent Sessions"', () => {
    assert.strictEqual(new AgentSessionsItem([]).label, 'Agent Sessions');
  });

  test('contextValue is agentSessionsNode', () => {
    assert.strictEqual(new AgentSessionsItem([]).contextValue, 'agentSessionsNode');
  });

  test('stores sessions array', () => {
    const item = new AgentSessionsItem([sess()]);
    assert.strictEqual(item.sessions.length, 1);
  });

  test('collapsibleState is Collapsed', () => {
    assert.strictEqual(
      new AgentSessionsItem([sess()]).collapsibleState,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
  });
});

suite('AgentSessionItem', () => {
  test('label includes agentLabel and status when status present', () => {
    const item = new AgentSessionItem(sess({ status: 'busy' }));
    assert.strictEqual(item.label, 'Claude Code · busy');
  });

  test('label is agentLabel only when status absent', () => {
    const item = new AgentSessionItem(sess({ agent: 'claude-desktop', agentLabel: 'Claude Desktop' }));
    assert.strictEqual(item.label, 'Claude Desktop');
  });

  test('description contains 8-char sessionId prefix', () => {
    const item = new AgentSessionItem(sess());
    assert.ok((item.description as string).includes('abc123de'));
  });

  test('description contains quoted name when name present', () => {
    const item = new AgentSessionItem(sess({ name: 'Fix auth' }));
    assert.ok((item.description as string).includes('"Fix auth"'));
  });

  test('description omits quotes when name absent', () => {
    const item = new AgentSessionItem(sess());
    assert.ok(!(item.description as string).includes('"'));
  });

  test('description is just the 8-char id when no name', () => {
    const item = new AgentSessionItem(sess());
    assert.strictEqual(item.description as string, 'abc123de');
  });

  test('command is ygg.copyAgentResumeCommand when resumeCommand present', () => {
    const item = new AgentSessionItem(sess({ resumeCommand: 'claude --resume abc123de' }));
    assert.strictEqual(item.command?.command, 'ygg.copyAgentResumeCommand');
    assert.deepStrictEqual(item.command?.arguments?.[0].sessionId, 'abc123de-0000-0000-0000-000000000000');
  });

  test('command is ygg.copyAgentSessionId when no resumeCommand', () => {
    const item = new AgentSessionItem(sess({ agent: 'claude-desktop', agentLabel: 'Claude Desktop' }));
    assert.strictEqual(item.command?.command, 'ygg.copyAgentSessionId');
  });

  test('contextValue is agentSessionItemCli when resumeCommand present', () => {
    const item = new AgentSessionItem(sess({ resumeCommand: 'claude --resume id' }));
    assert.strictEqual(item.contextValue, 'agentSessionItemCli');
  });

  test('contextValue is agentSessionItem when no resumeCommand', () => {
    const item = new AgentSessionItem(sess());
    assert.strictEqual(item.contextValue, 'agentSessionItem');
  });

  test('icon is $(debug-alt) for busy Claude Code', () => {
    const item = new AgentSessionItem(sess({ status: 'busy' }));
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'debug-alt');
  });

  test('icon is $(circle-large-outline) for idle', () => {
    const item = new AgentSessionItem(sess({ status: 'idle' }));
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'circle-large-outline');
  });

  test('icon is $(archive) when isArchived', () => {
    const item = new AgentSessionItem(sess({ agent: 'claude-desktop', agentLabel: 'Claude Desktop', isArchived: true }));
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'archive');
  });
});
