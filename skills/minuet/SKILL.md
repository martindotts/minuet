---
name: minuet
description: Explain how a code flow works with a step-by-step tour in the VS Code debugger (minuet extension), running the real code through an existing test or, if there is none, a temporary one. Works with any language VS Code can debug. Use when the user asks to explain, understand or walk through a flow "with the debugger", "with minuet", "step by step with real values", or asks for a tour/walkthrough of the code.
---

# Tours with minuet

minuet is a VS Code extension that turns breakpoints of the VS Code debugger into explained steps, in any language
it can debug (JavaScript/TypeScript, Python, Go, Java, C#…). Each step of a tour is a breakpoint with a title,
an explanation (markdown, or a markdown or HTML file), highlighted ranges and expressions that are evaluated with
the real values when execution stops there.

Your job: understand the flow, find a **run** that goes through it (an existing test or, if there is none, a
temporary one), write the **tour** as a JSON file in the repository's `.minuet/` folder, **open** it in VS Code
and tell the user how to run it. The user runs it in their debugger.

## 1. Understand the flow

- Read the code from the entry point (handler, public function) to whatever the user wants to understand.
- Pick **5 to 8 steps**: the places where something is decided or transformed. Not one per function.

## 2. What to run

minuet stops in any debug session of VS Code. Choose in this order:

1. **An existing test** that goes through the flow. This is the first choice: it already has mocks and
   fixtures, it represents a real case and it leaves nothing to clean up.
   - Search by the entry point or the functions of the flow.
   - If the file has several tests, pick one and find out how to run it alone with this repository's test
     runner; that way the debugger does not stop at the steps from other cases.
   - **Run it once without the debugger**, the way this repository runs its tests, and confirm it goes through
     the path you need to explain. If it takes a different branch, it is not useful.
2. **A temporary test**, only if no existing test covers the path or a specific input is needed. Tell the user
   ("I did not find a test that goes through X, so I created a temporary one").
   - Put it **next to the existing tests**, following their conventions, so it picks up the same setup (runner,
     mocks, fixtures, in-memory database). Put `tour` in its name (for example `orders.tour.test.ts` or
     `test_orders_tour.py`), so it is easy to recognize and delete.
   - Call the **real entry point** with a realistic input (event, request, object) that goes through the path.
     Reuse the repository's fixtures and helpers; do not mock the logic you want to show.
   - **Run it once without the debugger** and confirm it takes the expected path.
   - **Do not modify existing tests** for this: if a different input is needed, write a new temporary test.
3. **Another local run** (a script, the dev server), if the user prefers it or already has it running. In that
   case tell them what to do so the flow runs.

How to run tests depends on the repository: read its configuration and scripts. What does not depend on it is
that the run will be **paused at breakpoints inside VS Code's debugger**, which needs:

- **No test timeout.** Disable it for this run (for example `--testTimeout=0` in vitest and jest, `--timeout 0`
  in mocha, `-p no:timeout` with pytest-timeout); otherwise the runner kills the test while it is paused.
- **One test, one process.** Run only the chosen test, without parallel workers or sharding, so the debugger
  stops only where it should and does not miss child processes.
- **VS Code's debugger, not a plain terminal.** Write it as the tour's `run`: a debug configuration (the same
  object as in `.vscode/launch.json`) that runs that one test with the timeout off. The user starts it with ▶
  on the tour. Check the configuration types the repository already uses in `.vscode/launch.json`.
- **The language's debug extension installed** in VS Code (Python, Go, Java, C#…). If it is missing, tell the
  user which one to install.

## 3. Tour (JSON)

Each tour is a folder in the **`.minuet/` folder at the repository root** (the folder open in VS Code), with the
tour in `tour.json` and the files of its steps next to it:

```
.minuet/order-confirmation-email/tour.json
.minuet/order-confirmation-email/step-3.html
```

The folder name is lowercase words and hyphens taken from the title. Create the folders if they do not exist. If
the repository sets another folder in `minuet.toursFolder` (`.vscode/settings.json`), use that one.

Never overwrite a tour that is already there: they can be the user's or the team's. Pick a new name.

```jsonc
{
  "version": 1,
  "title": "How the order confirmation email is built",
  "context": "markdown with the starting point: which test or run is used, with which input, and what to look at",
  "run": { "type": "node", "request": "launch", "program": "${workspaceFolder}/test/orders.test.js" },
  "steps": [
    {
      "order": 1,
      "file": "packages/orders/src/confirmationEmail.ts",
      "line": 42,
      "anchorText": "const { orderId, customer } = event.body;",
      "title": "The order event arrives",
      "content": "markdown...",
      "highlights": [{ "startLine": 48, "endLine": 61, "note": "data taken from the body" }],
      "watches": ["event.body.orderId", "customer.email"]
    }
  ]
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `version` | yes | Always `1`. |
| `title` | no | Text. |
| `context` | no | Like `content`. Shown first: explain the starting point. |
| `run` | recommended | How to run the flow under the debugger: a debug configuration, the same object as in `launch.json` (`type`, `request`, `program`/`module`/`args`…), or the name of one in `.vscode/launch.json`. It must run only the chosen test, with no timeout. The user runs it with ▶ on the tour. |
| `steps[].order` | yes | Integer ≥ 1, no repeats. **Execution order**, not reading order. |
| `steps[].file` | yes | Path **relative to the folder open in VS Code** (the repository root), with `/`. |
| `steps[].line` | yes | Line of the breakpoint, **starting at 1**. One step per line. |
| `steps[].anchorText` | recommended | Exact text of that line, without leading or trailing spaces. |
| `steps[].title` | yes | Short title. |
| `steps[].content` | no | Short markdown: what happens here and what to look at in the values. Or `{ "file": "step-3.html" }`: a `.md` or `.html` file, relative to the tour's folder. |
| `steps[].highlights` | no | Ranges in the **same file**, `startLine`/`endLine` starting at 1 and inclusive; optional short `note`. |
| `steps[].watches` | no | Expressions in the program's language, evaluated at that point. |

`//` comments are allowed in the JSON, but VS Code does not keep them when it rewrites the file.

### Markdown or a page

Use inline markdown for almost every step: a few sentences, `code`, a short list. Use an **HTML page** only when a
picture explains it better than text: a small diagram of the data flow, a table of cases, a before/after. It is
shown inside the step, in a narrow panel. Keep it simple and self-contained:

- **static HTML and CSS only: scripts never run.** For diagrams write SVG inline; for things to expand use
  `<details>`; write tables and data directly in the HTML,
- put it next to `tour.json`, with any css or images it needs; refer to them with relative paths,
- nothing from the network (no CDNs, no remote fonts or images): only the tour's own files are loaded,
- skip the title: the step's title is already shown above the page.

### Rules that get broken the most

1. **The breakpoint goes on a statement in the body, not on the signature.** On `export const handler = async (event) => {`
   (or `def handler(event):`) execution stops when the *module loads*, not when the function is called, and
   `event` does not exist. Use the first line of the body.
2. **Execution stops before the line runs.** On `const total = compute(x);`, `total` does not exist yet and `x`
   does. To show `total`, put the step on the next line.
3. **The order is the execution order.** If the line of step 1 calls a function that contains step 2, step 2
   runs before the line after step 1.
4. Expressions only see the scope of that line: parameters, locals already assigned, closures, globals. Whole
   objects are fine (`event.body`): they can be expanded in the view. Nothing with side effects.
5. One step per line, and only on lines that actually run code (not comments, lone braces or blank lines).

### Check before opening

For each step, confirm the line is the one you think:

```bash
sed -n '42p' packages/orders/src/confirmationEmail.ts
```

And that the JSON parses:

```bash
node -e "JSON.parse(require('fs').readFileSync('.minuet/x/tour.json','utf8'))"
```

(If you used `//` comments, this check fails; in that case leave the comments out.)

## 4. Open

Open the extension's URI with the **absolute**, URL-encoded path of the tour file:

```bash
# macOS
open "vscode://martindotts.minuet/open?file=%2Fpath%2Fto%2Frepo%2F.minuet%2Fx%2Ftour.json"
# Linux
xdg-open "vscode://martindotts.minuet/open?file=%2Fpath%2Fto%2Frepo%2F.minuet%2Fx%2Ftour.json"
# Windows (PowerShell)
Start-Process "vscode://martindotts.minuet/open?file=C%3A%5Cpath%5Cto%5Crepo%5C.minuet%5Cx%5Ctour.json"
```

VS Code asks the user to confirm, then sets a breakpoint for each step. If several VS Code windows are open,
the URI goes to the one that last had focus: ask the user to bring the repository's window to the front.

If the user sees an error, the message says which field failed (`steps[2].line: …`); fix the file and open the
URI again. Once the tour is open, VS Code follows its folder: if you edit `tour.json` or a step's file again (to
fix or add a step), the tour and the step reload by themselves, with no need to open the URI again.

## 5. Tell the user how to run it

A short message with:

- that they should accept opening the tour in VS Code and click ▶ on it in **Tours** (it runs the `run`
  configuration you wrote). If you could not write a `run` configuration, tell them how to run the test under
  the debugger instead,
- if it is an existing test, which one and why; if it is temporary, that you created it and where,
- that they move forward with **F5** (Continue); each step is shown in the **Current Step** view (in Run and
  Debug), and they can add a variable to the step from the Variables view (right click → **Add to Step**),
- that if the steps run in a different order, the extension offers **Order by Execution**.

Do not repeat the content of each step in the chat: it is already in the tour. A one or two line summary of the
flow is fine.

## 6. Clean up

When the user is done (or asks for it):

- delete the temporary test, if you created one. Existing tests are not touched,
- ask whether to keep the tour. It is a folder in `.minuet/`: committed, it lets the team walk the same flow; if
  they do not want it, delete the folder (VS Code closes the tour and removes its breakpoints),
- **minuet: Close Tour** takes the tour out of VS Code (with its breakpoints) and keeps its files.
