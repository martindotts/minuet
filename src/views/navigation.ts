import * as vscode from 'vscode';
import { toOneBased } from '../core/lines';
import { Step } from '../core/model';

/** Opens the step's file with the cursor on its breakpoint line. */
export async function openStep(step: Step, preserveFocus = false): Promise<vscode.TextEditor> {
  const uri = vscode.Uri.parse(step.location.uri);
  const position = new vscode.Position(step.location.line, 0);
  const editor = await vscode.window.showTextDocument(uri, {
    selection: new vscode.Range(position, position),
    preserveFocus,
  });
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}

/** Lines (0-based, inclusive) covered by an editor selection; a trailing line at column 0 is excluded. */
export function selectionLines(selection: vscode.Selection): { startLine: number; endLine: number } {
  const startLine = selection.start.line;
  let endLine = selection.end.line;
  if (endLine > startLine && selection.end.character === 0) {
    endLine--;
  }
  return { startLine, endLine };
}

/** Selects and reveals a line range in the step's file. */
export async function revealLines(step: Step, startLine: number, endLine: number): Promise<void> {
  const uri = vscode.Uri.parse(step.location.uri);
  const editor = await vscode.window.showTextDocument(uri, { preserveFocus: false });
  const end = Math.min(endLine, editor.document.lineCount - 1);
  const range = new vscode.Range(startLine, 0, end, editor.document.lineAt(end).text.length);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** "src/orders.js:14" */
export function stepLocation(step: Step): string {
  return `${vscode.workspace.asRelativePath(vscode.Uri.parse(step.location.uri))}:${toOneBased(step.location.line)}`;
}
