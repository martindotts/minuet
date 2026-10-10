<p align="center">
  <img src="media/icon.png" width="112" alt="minuet">
</p>

<h1 align="center">minuet</h1>

<p align="center">
  <strong>Step-by-step debugging, explained.</strong><br>
  Ask your AI agent how a piece of code works. Get a guided tour you run in the VS Code debugger,<br>
  with the real values of that run.
</p>

<p align="center">
  <a href="https://github.com/martindotts/minuet/releases"><img src="https://img.shields.io/github/v/release/martindotts/minuet?include_prereleases&label=release&color=6a32a0" alt="Release"></a>
  <a href="https://github.com/martindotts/minuet/actions/workflows/release.yml"><img src="https://github.com/martindotts/minuet/actions/workflows/release.yml/badge.svg" alt="Build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/martindotts/minuet?color=6a32a0" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.90%2B-6a32a0" alt="VS Code 1.90+">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#using-it-with-agents">Agents</a> ·
  <a href="#tour-file-format">Tour format</a> ·
  <a href="https://github.com/martindotts/minuet/releases">Releases</a>
</p>

---

## Quick start

1. **Install.** Download the `.vsix` of the latest build from
   [Releases](https://github.com/martindotts/minuet/releases) and run:

   ```bash
   code --install-extension minuet-*.vsix
   ```

   Or in VS Code: **Extensions → … → Install from VSIX…** Requires VS Code 1.90 or later.

2. **Install the agent skill** (once): Command Palette → **minuet: Install Agent Skill**. Works with Claude Code,
   Codex, Cursor, GitHub Copilot, Gemini CLI and any agent that supports [Agent Skills](https://agentskills.io).

3. **Ask your agent:**

   > Explain with minuet how the order confirmation email is built

4. **Run it.** Accept opening the tour and start the test the agent picked in the debugger. Each stop shows the step,
   its explanation and the real values.

## Why minuet

- **Your agent builds the tour.** It reads the code, picks the steps, finds (or writes) a test that runs the flow
  and saves the tour in `.minuet/`. VS Code opens it after you confirm.
- **You run it for real.** Start the test in the debugger. At each step you see what happens, why it matters and
  the actual values, objects included.
- **Tours are plain files.** Each tour is a `.tour.json` in the `.minuet/` folder of the project. Commit it to
  share the walkthrough with your team, or keep it on your machine.

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

## Using it with agents

An agent can build the whole tour: it reads the code, decides what to run, writes the tour to `.minuet/` and
opens it in VS Code. To run the flow it first looks for an existing test that goes through it; if there is none,
it creates a temporary one and tells you. You accept opening the tour and run the test in the debugger.

1. **Install the skill** (once): Command Palette → **minuet: Install Agent Skill**, or from the `…` menu of the
   Steps view. Pick the agents you use; the ones found on your machine come selected. It copies `SKILL.md` to
   each agent's user-level skills folder, so it works in any repository. It contains the format, the rules of
   the guide for agents and the whole procedure. Agents pick it up in new sessions.

   | Agent | Folder |
   | --- | --- |
   | Claude Code | `~/.claude/skills/minuet/` |
   | Codex, Cline, Zed, Warp | `~/.agents/skills/minuet/` |
   | Cursor | `~/.cursor/skills/minuet/` |
   | GitHub Copilot | `~/.copilot/skills/minuet/` |
   | Gemini CLI | `~/.gemini/skills/minuet/` |
   | Antigravity | `~/.gemini/antigravity/skills/minuet/` |
   | Windsurf | `~/.codeium/windsurf/skills/minuet/` |
   | OpenCode | `~/.config/opencode/skills/minuet/` |

   For any other agent, choose **Other agent…** and pick its skills folder, or use the
   [`skills`](https://github.com/vercel-labs/skills) CLI, which knows about 70+ agents:

   ```bash
   npx skills add martindotts/minuet -g
   ```
2. **Ask the agent**, for example: *"Explain with minuet how the order confirmation email is built"*.
3. **The agent opens the tour** through a URI of the extension. VS Code always asks you to confirm first. If the
   agent edits the file later (to fix or add a step), the open tour reloads by itself.

### Open URI

```
vscode://martindotts.minuet/open?file=<absolute, URL-encoded path of the tour file>
```

For example, from a terminal on macOS:

```bash
open "vscode://martindotts.minuet/open?file=%2Fpath%2Fto%2Frepo%2F.minuet%2Fmy.tour.json"
```

On Linux use `xdg-open`, on Windows `Start-Process`.

- The path must be absolute. Step paths inside the JSON are resolved against the folder open in the window that
  receives the URI. A file outside the tours folder is copied into it, so tours always live in one place.
- With several VS Code windows open, the URI goes to the one that last had focus.
- The development window (F5) and an installation from the `.vsix` register the same URI. To try it with F5,
  keep the development window in front.

---

## Usage

### Building a tour by hand

All commands are in the Command Palette (**minuet: …**). They are also in the editor context menu
(*minuet* submenu) and in the line number context menu (right-click the gutter).

| Command | What it does |
| --- | --- |
| **Annotate Breakpoint on This Line** | Creates a breakpoint on the cursor line if there is none. Asks for a title and a comment. If no tour is open, asks which one to add the step to, or creates a new one. |
| **Highlight Selection in Annotation…** | Adds the selected lines to an annotation in the same file. Suggests the nearest one above by default. Asks for an optional note. |
| **Add Expression to Evaluate…** | Adds an expression to the step. If text is selected, it is used as the initial value. |
| **Edit Annotation** | Changes the title, comment, order, expressions or highlights. If the step is outdated, it can be re-anchored. |
| **Delete Annotation** | Deletes the annotation. The breakpoint is kept. |
| **Order Steps by Last Run** | Renumbers the tour following the order in which the last run stopped at each step. Steps that did not run go to the end. Shows the new order before applying it. |
| **New Tour…** | Asks for a title and creates `.minuet/<title>.tour.json`, empty, and opens it. |
| **Open Tour…** | Opens a tour of the tours folder (also by clicking it in **Tours**, or right-clicking a `.tour.json` in the Explorer). A file from elsewhere is copied into the folder first. |
| **Close Tour** | Takes the tour out of VS Code with the breakpoints of its steps. Its file is kept. |
| **Delete Tour…** | Deletes the tour file (to the trash). |
| **Open Tour File** | Opens the tour's JSON in the editor. |
| **Install Agent Skill** | See [Using it with agents](#using-it-with-agents). |

### In the code

A CodeLens appears above each annotated line: `◆ Step 3 of 6 · title` (with ⚠ if it is outdated). Clicking it
shows the step in **Current Step**, inside Run and Debug. When you go back to **Tour**, that step is selected.
Placing the cursor on an annotated line also selects its step (turn it off with `minuet.followCursor`).

### The minuet panel

The panel has its own icon in the Activity Bar, with two views:

- **Tours**: the `.tour.json` files of the tours folder. The open one is marked. Click a tour to open it (the
  current one is closed first). ✕ closes it; the context menu opens its file or deletes it. The list follows
  the folder: a tour copied there, committed by a teammate or written by an agent shows up by itself.
- **Steps**: the open tour.
  - the tour **context**, if there is one (first node; click it to open it as markdown),
  - the steps **in order**: `1. title  file:line`,
  - a ⚠ icon on **outdated** steps,
  - during a session, the step where execution is **stopped**.

  Clicking a step opens the file at that line and shows it in Current Step. Step actions: move up, move down,
  edit and delete. View actions: close the tour, open its file, order by execution and install the agent skill.

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

## Tour files

A tour is a `.tour.json` file in the tours folder: `.minuet/` at the root of the project, or the folder set in
`minuet.toursFolder`. That folder is the only place tours live:

- **To add a tour**, put its file in the folder: copy it, pull it from git, or let an agent write it. To share
  one, commit it. To get rid of one, delete it.
- **One tour is open at a time.** Opening it sets a breakpoint for each step; closing it (or opening another)
  removes them, so only the open tour stops your debug sessions.
- **Every change is written to the file right away**: a new step, an edited comment, a breakpoint that moves
  when you edit the code above it. The tour stays in sync with the code it describes, and a commit that moves
  code also updates its tours.
- **Changes to the file are picked up.** If the open tour's file changes on disk (a `git pull`, an agent, a hand
  edit), the tour reloads and its breakpoints follow. If the file is deleted, the tour is closed.
- The first time the folder is created in a git repository, minuet asks whether to share the tours or keep them
  local. Keeping them local adds the folder to `.git/info/exclude`, an ignore list that is not committed.

When the extension rewrites a file, `//` comments in it are not kept.

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
| `anchorText` | string | recommended | Text of that line as it is in the file (compared without leading or trailing spaces, and with inner whitespace collapsed). If it does not match, the step is still opened and marked as outdated. If missing, the current text of the line is used. |
| `title` | string | yes | Short step title. |
| `comment` | string (markdown) | no | Explanation of the step. |
| `highlights` | list | no | Ranges in the **same file**: `{ "startLine", "endLine", "note"? }`, starting at 1, `endLine` inclusive. |
| `watches` | list of strings | no | JavaScript expressions evaluated in the stopped frame, with the same rules as the *Watch* view. |

All lines in the file start at 1; internally they are stored starting at 0. `//` and `/* */` comments are
allowed in the JSON.

If the file has errors, the tour is not opened. The list of problems is shown with the exact field, for example:

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

A complete example is in `examples/sample-node/.minuet/orders.tour.json`.

---

## How steps follow breakpoints

- The tour's content lives only in its file (see [Tour files](#tour-files)). VS Code only remembers which tour
  is open in each workspace.
- Each annotation is linked to its breakpoint by file and line. Breakpoint ids change between sessions.
- **Deleting the breakpoint deletes its annotation.** Deleting the annotation keeps the breakpoint.
- If the breakpoint moves (for example, when lines are added above it), the annotation and its highlights move
  with it.
- If the text of the line no longer matches the annotated text, the step becomes **outdated**: it shows ⚠ in the
  panel, in the CodeLens and in Current Step, but it is not deleted. **Re-anchor** (in Current Step or in **Edit
  Annotation**) marks it as up to date again.
- **Removing every breakpoint of the tour at once** (for example with *Remove All Breakpoints*) closes the tour
  instead of deleting all its steps. The file is kept.
- When VS Code starts, if an annotation has no breakpoint, the breakpoint is created again. VS Code delivers the
  breakpoint list to extensions asynchronously; deleting the annotation at that point could wipe the whole tour
  because of a startup race.

---

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `minuet.toursFolder` | `.minuet` | Folder of the tours. Relative to the first workspace folder, or absolute. |
| `minuet.showCodeLens` | `true` | Show `◆ Step N of M · title` above each annotated line. |
| `minuet.followCursor` | `true` | Select a step when the cursor is placed on its line. |
| `minuet.suggestExecutionOrder` | `true` | When a session ends, offer to reorder if execution went through the steps in a different order. |

Colors can be changed in `workbench.colorCustomizations`:

- `minuet.highlightBackground`
- `minuet.highlightBorder`
- `minuet.noteForeground`

---

## Sample project

`examples/sample-node` has a module (`src/orders.js`) that builds the notification text of an order, a test
(`node --test`) and a 5-step tour (`.minuet/orders.tour.json`).

1. Press **F5** in this project. A development window opens with the sample.
2. **Tours** → click *How the order notification text is built*.
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

<details>
<summary><strong>Source structure</strong></summary>

| File | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation and wiring. |
| `src/model.ts` | Data model. |
| `src/store.ts` | The open tour in memory. |
| `src/tourFormat.ts` | Validation and conversion of the tour JSON. |
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
| `src/tourView.ts` | "Steps" view. |
| `src/stepState.ts` | What Current Step shows (pure logic). |
| `src/stepView.ts` | "Current Step" view (extension side). |
| `src/webview/` | "Current Step" view (webview script and message protocol). |
| `src/navigation.ts` | Opening a step in the editor. |
| `src/tours.ts` | Tour files: the tours folder, the "Tours" view, open, close, create, delete, write and reload. |
| `src/commands.ts` | Commands. |
| `src/uriHandler.ts` | `vscode://martindotts.minuet/open` URI. |
| `src/agentSkills.ts` | Installs the skill for each agent. |
| `skills/minuet/SKILL.md` | Agent skill installed by the command (also by `npx skills add`). |

</details>

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
