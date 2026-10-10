---
name: stepwise
description: Explain how a JavaScript/TypeScript code flow works with a step-by-step tour in the VS Code debugger (Stepwise extension), running the real code through an existing test or, if there is none, a temporary one. Use when the user asks to explain, understand or walk through a flow "with the debugger", "with Stepwise", "step by step with real values", or asks for a tour/walkthrough of the code.
---

# Tours with Stepwise

Stepwise is a VS Code extension that adds annotations to the breakpoints of the JavaScript/TypeScript
debugger. Each step of a tour is a breakpoint with a title, a markdown comment, highlighted ranges and
expressions that are evaluated with the real values when execution stops there.

Your job: understand the flow, find a **run** that goes through it (an existing test or, if there is none, a
temporary one), write the **tour** as JSON, **import** it into VS Code and tell the user how to run it. The user
runs it in their debugger.

## 1. Understand the flow

- Read the code from the entry point (handler, public function) to whatever the user wants to understand.
- Pick **5 to 8 steps**: the places where something is decided or transformed. Not one per function.

## 2. What to run

The extension stops in any run of the JS/TS debugger. Choose in this order:

1. **An existing test** that goes through the flow. This is the first choice: it already has mocks and
   fixtures, it represents a real case and it leaves nothing to clean up.
   - Search by the entry point or the functions of the flow (`grep -rn "functionName" --include=*.test.*`).
   - If the file has several tests, pick one and note its name so it can run alone (`-t "<name>"` in
     vitest/jest); that way the debugger does not stop at the steps from other cases.
   - **Run it once without the debugger** and confirm it goes through the path you need to explain. If it takes
     a different branch, it is not useful.
2. **A temporary test**, only if no existing test covers the path or a specific input is needed. Tell the user
   ("I did not find a test that goes through X, so I created a temporary one").
   - Put it **next to the existing tests of the package**, so it picks up the same setup (vitest/jest, mocks,
     in-memory database). Name: `<something>.tour.test.ts` (or `.js`), so it is easy to recognize and delete.
   - Call the **real entry point** with a realistic input (event, request, object) that goes through the path.
     Reuse the repository's fixtures and helpers; do not mock the logic you want to show.
   - **Run it once without the debugger** (`npx vitest run <file>`) and confirm it takes the expected path.
   - **Do not modify existing tests** for this: if a different input is needed, write a new temporary test.
3. **Another local run** (a script, the dev server), if the user prefers it or already has it running. In that
   case tell them what to do so the flow runs.

## 3. Tour (JSON)

Write it **outside the repository**, in the temporary directory (`/tmp/<name>.tour.json` or `$TMPDIR`). Use an
absolute path without spaces or special characters.

```jsonc
{
  "version": 1,
  "title": "How the order confirmation email is built",
  "context": "markdown with the starting point: which test or run is used, with which input, and what to look at",
  "steps": [
    {
      "order": 1,
      "file": "packages/orders/src/confirmationEmail.ts",
      "line": 42,
      "anchorText": "const { orderId, customer } = event.body;",
      "title": "The order event arrives",
      "comment": "markdown...",
      "highlights": [{ "startLine": 48, "endLine": 61, "note": "data taken from the body" }],
      "watches": ["event.body.orderId", "customer.email"]
    }
  ]
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `version` | yes | Always `1`. |
| `title`, `context` | no | Text and markdown. `context` is shown first: explain the starting point. |
| `steps[].order` | yes | Integer ≥ 1, no repeats. **Execution order**, not reading order. |
| `steps[].file` | yes | Path **relative to the folder open in VS Code** (the repository root), with `/`. |
| `steps[].line` | yes | Line of the breakpoint, **starting at 1**. One step per line. |
| `steps[].anchorText` | recommended | Exact text of that line, without leading or trailing spaces. |
| `steps[].title` | yes | Short title. |
| `steps[].comment` | no | Short markdown: what happens here and what to look at in the values. |
| `steps[].highlights` | no | Ranges in the **same file**, `startLine`/`endLine` starting at 1 and inclusive; optional short `note`. |
| `steps[].watches` | no | JavaScript expressions evaluated at that point. |

`//` comments are allowed in the JSON.

### Rules that get broken the most

1. **The breakpoint goes on a statement in the body, not on the signature.** On `export const handler = async (event) => {`
   execution stops when the *module loads*, not when the function is called, and `event` does not exist. Use
   the first line of the body.
2. **Execution stops before the line runs.** On `const total = compute(x);`, `total` does not exist yet and `x`
   does. To show `total`, put the step on the next line.
3. **The order is the execution order.** If the line of step 1 calls a function that contains step 2, step 2
   runs before the line after step 1.
4. Expressions only see the scope of that line: parameters, locals already assigned, closures, globals. Whole
   objects are fine (`event.body`): they can be expanded in the view. Nothing with side effects.
5. One step per line, and only on lines that actually run code (not comments, lone braces or blank lines).

### Check before importing

For each step, confirm the line is the one you think:

```bash
sed -n '42p' packages/orders/src/confirmationEmail.ts
```

And that the JSON parses:

```bash
node -e "JSON.parse(require('fs').readFileSync('/tmp/x.tour.json','utf8'))"
```

(If you used `//` comments, this check fails; in that case leave the comments out.)

## 4. Import

Open the extension's URI with the **absolute**, URL-encoded path of the JSON:

```bash
# macOS
open "vscode://martindotts.stepwise/import?file=%2Ftmp%2Fx.tour.json"
# Linux
xdg-open "vscode://martindotts.stepwise/import?file=%2Ftmp%2Fx.tour.json"
# Windows (PowerShell)
Start-Process "vscode://martindotts.stepwise/import?file=C%3A%5CUsers%5C...%5Cx.tour.json"
```

VS Code asks the user to confirm (Import, or Replace / Append if there is already a tour). If several VS Code
windows are open, the URI goes to the one that last had focus: ask the user to bring the repository's window
to the front.

If the user sees an import error, the message says which field failed (`steps[2].line: …`); fix it and open
the URI again.

## 5. Tell the user how to run it

A short message with:

- that they should accept the import in VS Code,
- the command to run the test **from a "JavaScript Debug Terminal"** (Command Palette → *Debug: JavaScript Debug
  Terminal*), without a timeout because it will be paused at breakpoints:
  - vitest: `npx vitest run <file> --testTimeout=0` (with `-t "<test name>"` if it is one of several)
  - jest: `npx jest <file> --testTimeout=0` (with `-t "<test name>"` if it is one of several)
  - node:test: `node --test <file>`
- if it is an existing test, which one and why; if it is temporary, that you created it and where,
- that they move forward with **F5** (Continue); each step is shown in the **Current Step** view (in Run and
  Debug),
- that if the steps run in a different order, the extension offers **Order by Execution**.

Do not repeat the comment of each step in the chat: it is already in the tour. A one or two line summary of the
flow is fine.

## 6. Clean up

When the user is done (or asks for it):

- delete **only what you created**: the tour JSON and, if there was one, the temporary test. Existing tests are
  not touched,
- remind them that in VS Code they can run **Stepwise: Delete All Annotations** (it also offers to
  delete the breakpoints).

Annotations live in VS Code's state, not in the repository: there is nothing else to clean up.
