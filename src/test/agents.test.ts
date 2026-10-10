import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { claudeSkillDir } from '../commands';
import { parseTourJson } from '../tourFormat';
import { parseUriRequest } from '../uriHandler';

const SKILL = path.resolve(__dirname, '../../resources/claude-skill/SKILL.md');

suite('agents: import URI', () => {
  test('parses an import request with an absolute file', () => {
    // VS Code hands the query already percent-decoded.
    assert.deepStrictEqual(parseUriRequest('/import', 'file=/tmp/x.tour.json'), {
      action: 'import',
      file: '/tmp/x.tour.json',
    });
  });

  test('accepts a trailing slash in the action', () => {
    assert.deepStrictEqual(parseUriRequest('/import/', 'file=/tmp/x.json'), { action: 'import', file: '/tmp/x.json' });
  });

  test('rejects a missing or relative file', () => {
    assert.match((parseUriRequest('/import', '') as { error: string }).error, /needs "file"/);
    assert.match((parseUriRequest('/import', 'file=tmp/x.json') as { error: string }).error, /absolute path/);
  });

  test('rejects unknown actions', () => {
    assert.match((parseUriRequest('/delete', 'file=/tmp/x.json') as { error: string }).error, /unknown action/);
  });
});

suite('agents: Claude Code skill', () => {
  const text = fs.readFileSync(SKILL, 'utf8');

  test('has the frontmatter Claude Code needs', () => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(match, 'frontmatter block');
    assert.match(match[1], /^name: stepwise$/m);
    assert.match(match[1], /^description: .{40,}$/m);
  });

  test('the format example in the skill is a valid tour', () => {
    const example = /```jsonc\n([\s\S]*?)```/.exec(text);
    assert.ok(example, 'jsonc example');
    const result = parseTourJson(example[1]);
    assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
  });

  test('documents the import URI the extension handles', () => {
    const uri = /vscode:\/\/martindotts\.stepwise\/import\?file=([^"\s]+)/.exec(text);
    assert.ok(uri, 'import URI in the skill');
    const request = parseUriRequest('/import', `file=${decodeURIComponent(uri[1])}`);
    assert.deepStrictEqual(request, { action: 'import', file: '/tmp/x.tour.json' });
  });

  test('is installed under ~/.claude/skills/stepwise', () => {
    assert.strictEqual(claudeSkillDir('/home/u'), path.join('/home/u', '.claude', 'skills', 'stepwise'));
  });
});
