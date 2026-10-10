# Stepwise

**Step-by-step debugging, explained.**

Ask your AI agent how a piece of code works and get a guided tour you can actually run. Stepwise turns the
breakpoints of the VS Code JavaScript/TypeScript debugger into explained steps: each one with a comment,
highlighted code and the **real values** of that run.

- **Your agent builds the tour.** It reads the code, picks the steps, finds (or writes) a test that runs the flow
  and imports the tour into VS Code. You confirm once.
- **You run it for real.** Start the test in the debugger. At each step you see what happens, why it matters and
  the actual values, objects included.
- **Nothing to set up in your repo.** Tours live in VS Code, like breakpoints. Nothing is written to the
  repository unless you export it.

You can also build tours by hand, share them as JSON, and use them with any JS/TS program or test runner.

## How it works

Each step is a breakpoint with:

- a **title** and a markdown **comment**,
- one or more **highlighted code ranges** (with an optional note),
- **expressions to evaluate** for that step (for example `event.body.orderId`).

When execution stops at an annotated breakpoint, the extension:

- highlights the ranges in the code,
- shows the step in the **Current Step** view: title, comment and the real value of each expression, evaluated
  against the current frame. Objects can be expanded.

It is not a new debugger. Execution is the usual one (a program, a vitest/jest/mocha test, a
"JavaScript Debug Terminal") and everything is built on the public VS Code API.

---

## Installation

From a `.vsix`:

```bash
code --install-extension stepwise-0.1.0.vsix
```

Or in VS Code: **Extensions → … → Install from VSIX…**

Requires VS Code 1.90 or later.

---

## Usage

### Building a tour by hand

All commands are in the Command Palette (**Stepwise: …**). They are also in the editor context menu
(*Stepwise* submenu) and in the line number context menu (right-click the gutter).

| Command | What it does |
| --- | --- |
| **Annotate Breakpoint on This Line** | Creates a breakpoint on the cursor line if there is none. Asks for a title and a comment. |
| **Highlight Selection in Annotation…** | Adds the selected lines to an annotation in the same file. Suggests the nearest one above by default. Asks for an optional note. |
| **Add Expression to Evaluate…** | Adds an expression to the step. If text is selected, it is used as the initial value. |
| **Edit Annotation** | Changes the title, comment, order, expressions or highlights. If the step is outdated, it can be re-anchored. |
| **Delete Annotation** | Deletes the annotation. The breakpoint is kept. |
| **Order Steps by Last Run** | Renumbers the tour following the order in which the last run stopped at each step. Steps that did not run go to the end. Shows the new order before applying it. |
| **Import Tour… / Export Tour…** | See [Import and export](#import-and-export). |
| **Delete All Annotations** | Asks whether to delete only the annotations or their breakpoints too. |
| **Install Claude Code Skill** | See [Using it with agents](#using-it-with-agents-claude-code). |

### In the code

A CodeLens appears above each annotated line: `◆ Step 3 of 6 · title` (with ⚠ if it is outdated). Clicking it
shows the step in **Current Step**, inside Run and Debug. When you go back to **Tour**, that step is selected.
Placing the cursor on an annotated line also selects its step (turn it off with `stepwise.followCursor`).

### The "Tour" panel

The panel has its own icon in the Activity Bar. It shows:

- the tour **context**, if there is one (first node; click it to open it as markdown),
- the steps **in order**: `1. title  file:line`,
- a ⚠ icon on **outdated** steps,
- during a session, the step where execution is **stopped**.

Clicking a step opens the file at that line and shows it in Current Step. Step actions: move up, move down, edit
and delete. Panel actions: import, export, order by execution, delete all and install the Claude Code skill.

### The "Current Step" view

It lives in **Run and Debug**, next to Variables, Watch and Call Stack, so it stays visible when VS Code opens
Run and Debug at every stop. It shows the step where execution is stopped or, when there is no stop, the
selected step. It contains:

- **Header:** "Step 3 of 6", the title and `file:line`, which opens the code when clicked.
  - Without a debug session, the ◀ ▶ buttons browse the tour so you can read it. They do not run code.
  - During a session only "Step X of Y" is shown. Use the native debugger controls to move forward.
- **Outdated warning**, with a **Re-anchor** button.
- **Comment** in markdown. ✎ edits the title and the comment. ⌘/Ctrl+Enter saves and Esc cancels.
- **Expressions** as a tree: each one with its value, colored by type.
  - Objects expand on click and their children are loaded on demand, with no depth limit.
  - Hovering a row shows buttons to copy the value or remove the expression.
  - A field at the bottom adds a new expression.
  - When execution is not stopped at the step, the expressions are listed without values.
- **Highlights:** each range (`L9–13`) with its note.
  - Click a range to select and reveal it in the editor.
  - Hovering shows ✎ (edit the note) and ✕ (remove the range).
  - **+ Highlight the editor selection** adds the lines selected in the step's file and asks for an optional note.

### Highlights in the code

- **Without a debug session:** the ranges of the selected step are highlighted, so you can see how the tour
  looks while you build it.
- **During a session:** only the ranges of the step where execution is stopped are highlighted. Nothing is
  highlighted while it runs.

Highlights use a subtle violet background with a stronger left border, a color VS Code does not use for other
line highlights. Notes are shown at the end of the first line of the range, after ◆.

### While debugging

1. Run the program or the test with the usual JS/TS debugger.
2. When execution stops at an annotated breakpoint:
   - the step's ranges are highlighted,
   - **Current Step** shows the step and evaluates its expressions with `evaluate` (`watch` context) against the
     current frame. If an expression fails, its error is shown and the others are still evaluated.
3. When you continue or step, the highlights of the previous step go away and the values are cleared.
4. If execution stops at a line without an annotation, nothing happens (regular debugging).
5. Execution follows the code, not the step numbers. If an annotated line calls a function that has another
   step inside, that step runs first. When the session ends, if the steps ran in a different order, the
   extension says so and offers **Order by Execution**.

   A run is a root session (a launch configuration, or each process started from a JavaScript Debug Terminal)
   together with its child processes. Only the first stop at each step counts. Selecting another frame in the
   call stack does not count.

It works with `vscode-js-debug` sessions: `node`/`pwa-node`, `chrome`/`pwa-chrome`, `msedge`, the JavaScript
Debug Terminal and their child processes (vitest workers, `node --test`, etc.).

---

## Using it with vitest

Both options stop at the annotated breakpoints.

**Option 1: JavaScript Debug Terminal.**

1. Open the Command Palette → **Debug: JavaScript Debug Terminal**.
2. Run the test in that terminal:

   ```bash
   npx vitest run path/to/file.test.ts --testTimeout=0
   ```

**Option 2: a launch configuration** in `.vscode/launch.json`:

```jsonc
{
  "type": "node",
  "request": "launch",
  "name": "Debug vitest (current file)",
  "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
  "args": ["run", "${relativeFile}", "--testTimeout=0"],
  "autoAttachChildProcesses": true,
  "smartStep": true,
  "skipFiles": ["<node_internals>/**", "**/node_modules/**"],
  "console": "integratedTerminal"
}
```

Notes:

- `--testTimeout=0` disables the test timeout. Without it, vitest stops the test (5 s by default) while it is
  paused at a breakpoint.
- In a monorepo, point `program` to the right `vitest.mjs` (the root one or the package's) and add `"cwd"` with
  the package folder.

---

## Import and export

- **Export Tour** saves all annotations to a JSON file chosen by the user. Paths are written relative to the
  workspace folder.
- **Import Tour** reads a JSON file (also available by right-clicking a `.json` file in the Explorer).
  - Validates the whole file before changing anything.
  - Resolves the paths against the workspace and creates the missing breakpoints.
  - If there are annotations already, asks whether to **replace** them or **append** the new steps. Replacing
    keeps the breakpoints of the previous annotations.

### Tour file format

This is the contract agents use.

```jsonc
{
  "version": 1,
  "title": "How the order confirmation email is built",
  "context": "markdown with the starting point (optional)",
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

Root:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `version` | `1` | yes | Format version. |
| `title` | string | no | Tour title. Shown in the panel. |
| `context` | string (markdown) | no | Starting point. It is the first node of the panel. |
| `steps` | list | yes | At least one step. |

Each step:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `order` | integer ≥ 1 | yes | Position in the tour. Must be unique. Gaps (1, 2, 5) are renumbered. |
| `file` | string | yes | Path **relative to the workspace folder**, with `/`. Absolute paths are accepted too. In multi-root workspaces it can start with the folder name. |
| `line` | integer ≥ 1 | yes | Breakpoint line, **starting at 1** (as shown in the editor). One step per line. |
| `anchorText` | string | recommended | Text of that line as it is in the file (compared without leading or trailing spaces, and with inner whitespace collapsed). If it does not match, the step is still imported and marked as outdated. If missing, the current text of the line is used. |
| `title` | string | yes | Short step title. |
| `comment` | string (markdown) | no | Explanation of the step. |
| `highlights` | list | no | Ranges in the **same file**: `{ "startLine", "endLine", "note"? }`, starting at 1, `endLine` inclusive. |
| `watches` | list of strings | no | JavaScript expressions evaluated in the stopped frame, with the same rules as the *Watch* view. |

All lines in the file start at 1; internally they are stored starting at 0. `//` and `/* */` comments are
allowed in the JSON.

If the file has errors, nothing is imported. The list of problems is shown with the exact field, for example:

```
steps[2].line: must be an integer >= 1 (lines start at 1) (got 0).
steps[3].file: file "src/foo.ts" does not exist (looked for /path/to/workspace/src/foo.ts).
```

### Guide for agents that generate tours

1. **Anchor each step on an executable statement inside the function body, not on the signature.** A
   breakpoint on `export const handler = async (event) => {` stops when the module *loads*, not when the
   function is called. At that point `event` does not exist. Use the first line of the body.
2. **The debugger stops before the line runs.** On `const total = compute(x);`, `total` has no value yet and `x`
   does. The expressions of a step should use values computed **before** that line. If the result matters,
   put the step on the next line.
3. Expressions only see the scope of that line: parameters, locals already assigned, closures and globals.
4. `anchorText` must be the exact text of the line (it can be copied with `sed -n '<line>p' file`). It is used to
   detect that the code changed.
5. **`order` must follow the execution order, not the reading order.** If the step on line 29 calls a function
   that has a step inside, that step goes right after it, before the step on line 30. If the order ends up
   wrong, the user can fix it with **Order Steps by Last Run**.
6. Few steps (5 to 8) with short comments. Whole objects can be used as expressions (`event.body`): they expand
   in the view.
7. Avoid expressions with side effects (calls that change state). They are evaluated in the real run.

A complete example is in `examples/sample-node/tour.json`.

---

## Using it with agents (Claude Code)

An agent can build the whole tour: it reads the code, decides what to run, writes the tour JSON and imports it
into VS Code. To run the flow it first looks for an existing test that goes through it; if there is none, it
creates a temporary one and tells you. You accept the import and run the test in the debugger.

1. **Install the skill** (once): Command Palette → **Stepwise: Install Claude Code Skill**, or from the
   `…` menu of the Tour panel. It copies `SKILL.md` to `~/.claude/skills/stepwise/`, so it works in any
   repository. It contains the format, the rules of the guide for agents and the whole procedure. Claude Code
   picks it up in new sessions.
2. **Ask the agent**, for example: *"Explain with Stepwise how the order confirmation email is built"*.
3. **The agent imports the tour** by opening a URI of the extension. VS Code always asks you to confirm before
   importing.

### Import URI

```
vscode://martinthompson.stepwise/import?file=<absolute, URL-encoded path of the JSON>
```

For example, from a terminal on macOS:

```bash
open "vscode://martinthompson.stepwise/import?file=%2Ftmp%2Fmy.tour.json"
```

On Linux use `xdg-open`, on Windows `Start-Process`.

- The path must be absolute. Step paths inside the JSON are resolved against the folder open in the window that
  receives the URI.
- With several VS Code windows open, the URI goes to the one that last had focus.
- The development window (F5) and an installation from the `.vsix` register the same URI. To try it with F5,
  keep the development window in front.

---

## Where annotations are stored

- In the extension's `workspaceState`: per workspace, on the user's machine, like breakpoints. **Nothing is
  written to the repository** and nothing shows up in git, except what the user exports.
- Each annotation is linked to its breakpoint by file and line. Breakpoint ids change between sessions.
- **Deleting the breakpoint deletes its annotation.** Deleting the annotation keeps the breakpoint.
- If the breakpoint moves (for example, when lines are added above it), the annotation and its highlights move
  with it.
- If the text of the line no longer matches the annotated text, the step becomes **outdated**: it shows ⚠ in the
  panel, in the CodeLens and in Current Step, but it is not deleted. **Re-anchor** (in Current Step or in **Edit
  Annotation**) marks it as up to date again.
- When VS Code starts, if an annotation has no breakpoint, the breakpoint is created again. VS Code delivers the
  breakpoint list to extensions asynchronously; deleting the annotation at that point could wipe the whole tour
  because of a startup race.

---

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `stepwise.showCodeLens` | `true` | Show `◆ Step N of M · title` above each annotated line. |
| `stepwise.followCursor` | `true` | Select a step when the cursor is placed on its line. |
| `stepwise.suggestExecutionOrder` | `true` | When a session ends, offer to reorder if execution went through the steps in a different order. |

Colors can be changed in `workbench.colorCustomizations`:

- `stepwise.highlightBackground`
- `stepwise.highlightBorder`
- `stepwise.noteForeground`

---

## Sample project

`examples/sample-node` has a module (`src/orders.js`) that builds the notification text of an order, a test
(`node --test`) and a 5-step tour (`tour.json`).

1. Press **F5** in this project. A development window opens with the sample.
2. **Tour** panel → **Import Tour** → `tour.json`.
3. **Run and Debug** → *Debug: orders test*.
4. Execution stops at each step. **Continue** (F5) moves to the next one.

---

## Development

```bash
npm install
npm run compile    # types + lint + bundle (dist/extension.js, dist/webview.js)
npm run lint
npm test           # unit and integration tests (includes a real debug session of the sample)
npm run package    # builds the .vsix
```

Structure:

| File | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation and wiring. |
| `src/model.ts` | Data model. |
| `src/store.ts` | Persistence in `workspaceState`. |
| `src/tourFormat.ts` | Validation and conversion of the import/export JSON. |
| `src/paths.ts` | Paths relative to the workspace. |
| `src/reconcile.ts` | Annotation ↔ breakpoint re-association (pure logic). |
| `src/breakpointSync.ts` | Applies the re-association on breakpoint events. |
| `src/staleness.ts` | Outdated step detection (pure logic). |
| `src/staleTracker.ts` | Outdated step detection (reads the documents). |
| `src/stopController.ts` | Detects stops, finds the step, evaluates expressions and records the execution order. |
| `src/executionOrder.ts` | Reordering by execution (pure logic). |
| `src/decorations.ts` | Highlights and notes. |
| `src/codeLens.ts` | CodeLens of each step. |
| `src/selection.ts` | Selected step (panel, CodeLens, cursor or stop). |
| `src/tourView.ts` | "Tour" panel. |
| `src/stepState.ts` | What Current Step shows (pure logic). |
| `src/stepView.ts` | "Current Step" view (extension side). |
| `src/webview/` | "Current Step" view (webview script and message protocol). |
| `src/navigation.ts` | Opening a step in the editor. |
| `src/importExport.ts` | Import and export. |
| `src/commands.ts` | Commands. |
| `src/uriHandler.ts` | `vscode://martinthompson.stepwise/import` URI. |
| `resources/claude-skill/SKILL.md` | Claude Code skill installed by the command. |

### Troubleshooting

If the development window shows *Can't find Node.js binary "node"*, it started without your shell `PATH`. This
can happen when VS Code is opened from the Dock and Node was installed with fnm, nvm or Homebrew. The
*Run Extension* configuration already passes `"env": { "PATH": "${env:PATH}" }`; if the error persists, add
`"runtimeExecutable"` with the output of `which node` to the sample's launch configuration.

### Out of scope

- Recording a run to replay it without executing anything.
- Headless execution.
- Debuggers other than the JavaScript/TypeScript one.

---

## License

MIT © Martin Thompson. See the `LICENSE` file.
