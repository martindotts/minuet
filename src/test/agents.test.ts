import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AGENTS, isDetected, skillDir } from '../agentSkills';
import { parseTourJson } from '../tourFormat';
import { parseUriRequest } from '../uriHandler';

const SKILL = path.resolve(__dirname, '../../skills/minuet/SKILL.md');

suite('agents: open URI', () => {
  test('parses an open request with an absolute file', () => {
    // VS Code hands the query already percent-decoded.
    assert.deepStrictEqual(parseUriRequest('/open', 'file=/repo/.minuet/x.tour.json'), {
      action: 'open',
      file: '/repo/.minuet/x.tour.json',
    });
  });

  test('accepts a trailing slash in the action', () => {
    assert.deepStrictEqual(parseUriRequest('/open/', 'file=/tmp/x.json'), { action: 'open', file: '/tmp/x.json' });
  });

  test('rejects a missing or relative file', () => {
    assert.match((parseUriRequest('/open', '') as { error: string }).error, /needs "file"/);
    assert.match((parseUriRequest('/open', 'file=tmp/x.json') as { error: string }).error, /absolute path/);
  });

  test('rejects unknown actions', () => {
    assert.match((parseUriRequest('/delete', 'file=/tmp/x.json') as { error: string }).error, /unknown action/);
  });
});

suite('agents: skill', () => {
  const text = fs.readFileSync(SKILL, 'utf8');

  test('has the Agent Skills frontmatter', () => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(match, 'frontmatter block');
    assert.match(match[1], /^name: minuet$/m);
    assert.match(match[1], /^description: .{40,}$/m);
  });

  test('the format example in the skill is a valid tour', () => {
    const example = /```jsonc\n([\s\S]*?)```/.exec(text);
    assert.ok(example, 'jsonc example');
    const result = parseTourJson(example[1]);
    assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
  });

  test('documents the open URI the extension handles', () => {
    const uri = /vscode:\/\/martindotts\.minuet\/open\?file=([^"\s]+)/.exec(text);
    assert.ok(uri, 'open URI in the skill');
    const request = parseUriRequest('/open', `file=${decodeURIComponent(uri[1])}`);
    assert.ok('file' in request && request.file.endsWith('.minuet/x.tour.json'), JSON.stringify(request));
  });

  test('is installed in each agent skills folder under the minuet name', () => {
    const claude = AGENTS.find((agent) => agent.label === 'Claude Code');
    assert.ok(claude);
    assert.strictEqual(skillDir(claude, '/home/u'), path.join('/home/u', '.claude', 'skills', 'minuet'));
    const dirs = AGENTS.map((agent) => skillDir(agent, '/home/u'));
    assert.strictEqual(new Set(dirs).size, dirs.length, 'no two agents share a folder');
  });

  test('detects an agent by any of its folders', () => {
    const codex = AGENTS.find((agent) => agent.skillsDir === '.agents/skills');
    assert.ok(codex);
    assert.ok(isDetected(codex, '/home/u', (p) => p === path.join('/home/u', '.codex')));
    assert.ok(!isDetected(codex, '/home/u', () => false));
  });
});
