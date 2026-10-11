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

   > Explain with minuet how checkout works

4. **Run it.** Accept opening the tour and click ▶ on it in **Tours**: it runs the test the agent picked in the
   debugger. Each stop shows the step,
   its explanation and the real values.

## Why minuet

- **Your agent builds the tour.** It reads the code, picks the steps, finds (or writes) a test that runs the flow
  and saves the tour in `.minuet/`. VS Code opens it after you confirm.
- **You run it for real.** Start the test in the debugger. At each step you see what happens, why it matters and
  the actual values, objects included.
- **Tours are plain files.** Each tour is a folder in `.minuet/` with a `tour.json`. Commit it to
  share the walkthrough with your team, or keep it on your machine.

You can also build tours by hand, share them as JSON, and use them with any program or test runner you can debug
in VS Code: JavaScript/TypeScript, Python, Go, Java, C# and more.

## How it works

Each step is a breakpoint with:

- a **title** and its **content**: markdown, or a markdown or HTML file (a page with diagrams, tables…),
- one or more **highlighted code ranges** (with an optional note),
- **expressions to evaluate** for that step (for example `event.body.orderId`).

When execution stops at the breakpoint of a step, the extension:

- highlights the ranges in the code,
- shows the step in the **Current Step** view: title, content and the real value of each expression, evaluated
  against the current frame. Objects can be expanded.

It is not a new debugger. Execution is the usual one (a program, a test, a debug terminal), in whatever language
VS Code can debug, and everything is built on the public VS Code API.

---

## Using it with agents

An agent can build the whole tour: it reads the code, decides what to run, writes the tour to `.minuet/` and
opens it in VS Code. To run the flow it first looks for an existing test that goes through it; if there is none,
it creates a temporary one and tells you. You accept opening the tour and run the test in the debugger.

1. **Install the skill** (once): Command Palette → **minuet: Install Agent Skill**, or from the `…` menu of the
   Tours panel. Pick the agents you use; the ones found on your machine come selected. It copies `SKILL.md` to
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
2. **Ask the agent**, for example: *"Explain with minuet how checkout works"*.
3. **The agent opens the tour** through a URI of the extension. VS Code always asks you to confirm first. If the
   agent edits the file later (to fix or add a step), the open tour reloads by itself.

### Open URI

```
vscode://martindotts.minuet/open?file=<absolute, URL-encoded path of the tour file>
```

For example, from a terminal on macOS:

```bash
open "vscode://martindotts.minuet/open?file=%2Fpath%2Fto%2Frepo%2F.minuet%2Fmy-tour%2Ftour.json"
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
| **Add Step on This Line** | Creates a breakpoint on the cursor line if there is none. Asks for its title (the content is written afterwards, with ✎). If no tour is open, asks which one to add the step to, or creates a new one. |
| **Highlight Selection in Step…** | Adds the selected lines to a step in the same file. Suggests the nearest one above by default. Asks for an optional note. |
| **Add Expression to Evaluate…** | Adds an expression to the step. If text is selected, it is used as the initial value. |
| **Edit Step** | Changes the title, content, order, expressions or highlights. If the step is outdated, it can be re-anchored. |
| **Delete Step** | Deletes the step. The breakpoint is kept. |
| **Run Tour** | Runs the open tour's flow under the debugger, with the `run` configuration of its file (the ▶ on the tour). |
| **Add to Step** | In the debugger's **Variables** view, while stopped at a step: adds the variable to the step's expressions. |
| **Order Steps by Last Run** | Renumbers the tour following the order in which the last run stopped at each step. Steps that did not run go to the end. Shows the new order before applying it. |
| **New Tour…** | Asks for a title and creates `.minuet/<title>/tour.json`, empty, and opens it. |
| **Open Tour…** | Opens a tour of the tours folder (also by clicking it in **Tours**, or right-clicking a `tour.json` in the Explorer). A tour from elsewhere is copied into the folder first, with its files. |
| **Close Tour** | Takes the tour out of VS Code with the breakpoints of its steps. Its file is kept. |
| **Delete Tour…** | Deletes the tour file (to the trash). |
| **Open Tour File** | Opens the tour's JSON in the editor. |
| **Install Agent Skill** | See [Using it with agents](#using-it-with-agents). |

### In the code

A CodeLens appears above the line of each step: `◆ Step 3 of 6 · title` (with ⚠ if it is outdated). Clicking it
shows the step in **Current Step** and selects it in **Tours**.
Placing the cursor on the line of a step also selects it (turn it off with `minuet.followCursor`).

### The minuet panel

The panel has its own icon in the Activity Bar, with the **Tours** of the tours folder. The list follows the
folder: a tour copied there, committed by a teammate or written by an agent shows up by itself. Steps are read
in **Current Step**, in the side bar on the right.

- **Click a tour** to open it: the current one is closed first, and the new one expands into its steps and
  shows its context in Current Step. Clicking the open tour shows its context again.
- **▶ runs the tour**: it starts the debugger with the `run` configuration of the tour file. It shows up when
  the tour has one.
- **The open tour's steps**, in order: `1. title  file:line`, with ⚠ on **outdated** steps and, during a
  session, a marker on the step where execution is **stopped**. Clicking a step opens the file at that line
  and shows the step in Current Step. Step actions: move up, move down, edit and delete.
- **Tour actions**: ✕ closes the open tour; the context menu opens its file or deletes it. In the title bar, +
  creates a tour (**New Tour**) and ⟳ reads the folder again (**Refresh Tours**); the `…` menu closes the tour,
  opens its file, orders the steps by execution and installs the agent skill.

### The "Current Step" view

The one place where steps are read. It lives in the **secondary side bar**, on the right, so it stays in view
next to **Tours** on the left and, when debugging, next to Run and Debug. (Before VS Code 1.106, which does not
let extensions use the secondary side bar, it is shown below Tours.)

It shows the step where execution is stopped or, when there is no stop, the selected step (or the tour's
context, after clicking the tour). It opens when you click a tour or a step, or when execution stops at a step,
without taking the focus from the editor. It only appears while there is a step or a context to show, so the
side bar is not taken while no tour is in use. Like any view, it can be dragged elsewhere.

It contains:

- **Header:** "Step 3 of 6" and the title.
  - Without a debug session, the ◀ ▶ buttons browse the tour so you can read it. They do not run code.
  - During a session only "Step X of Y" is shown. Use the native debugger controls to move forward.
- **Outdated warning**, with a **Re-anchor** button.
- **Content**: markdown or an HTML page, drawn here. ✎ edits the title and inline markdown (content from a file is edited in its file).
  ⌘/Ctrl+Enter saves and Esc cancels.
- **Expressions** as a tree: each one with its value, colored by type.
  - Objects expand on click and their children are loaded on demand, with no depth limit.
  - Hovering a row shows buttons to copy the value or remove the expression.
  - A field at the bottom adds a new expression. While stopped, **Add to Step** in the Variables view (right
    click) adds a variable.
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

1. Run the program or the test with the usual debugger of its language.
2. When execution stops at the breakpoint of a step:
   - the step's ranges are highlighted,
   - **Current Step** shows the step and evaluates its expressions with `evaluate` (`watch` context) against the
     current frame. If an expression fails, its error is shown and the others are still evaluated.
3. When you continue or step, the highlights of the previous step go away and the values are cleared.
4. If execution stops at a line without a step, nothing happens (regular debugging).
5. Execution follows the code, not the step numbers. If the line of a step calls a function that has another
   step inside, that step runs first. When the session ends, if the steps ran in a different order, the
   extension says so and offers **Order by Execution**.

   A run is a root session (a launch configuration, or each process started from a JavaScript Debug Terminal)
   together with its child processes. Only the first stop at each step counts. Selecting another frame in the
   call stack does not count.

It works with any debug session: minuet only uses the standard Debug Adapter Protocol requests (`stackTrace`,
`evaluate`, `variables`), which every VS Code debugger supports. It is tested with JavaScript/TypeScript
(`vscode-js-debug`: Node.js, Chrome, Edge, the JavaScript Debug Terminal and their child processes, such as
vitest workers) and with Python (`debugpy`). In other languages, the debugger must report source files by
absolute path, as most do.

When a run is paused at breakpoints, the test runner's timeout must be off, or it kills the test (for example
`--testTimeout=0` in vitest and jest, `--timeout 0` in mocha). Running a single test, without parallel workers,
keeps the stops to the steps of that case.

---

## Using it with vitest

Both options stop at the breakpoints of the steps.

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

Tours live in the tours folder: `.minuet/` at the root of the project, or the folder set in
`minuet.toursFolder`. Each tour is a folder with its `tour.json` and the files of its steps:

```
.minuet/
  orders/
    tour.json
    context.md
    discount.html
    style.css
  quick-look.tour.json      ← a tour can also be a single file
```

That folder is the only place tours live:

- **To add a tour**, put it in the folder: copy it, pull it from git, or let an agent write it. To share one,
  commit it. To get rid of one, delete it.
- **One tour is open at a time.** Opening it sets a breakpoint for each step; closing it (or opening another)
  removes them, so only the open tour stops your debug sessions.
- **Every change is written to the file right away**: a new step, edited content, a breakpoint that moves when
  you edit the code above it. The tour stays in sync with the code it describes, and a commit that moves code
  also updates its tours.
- **Changes on disk are picked up.** If the open tour's files change (a `git pull`, an agent, a hand edit), the
  tour and its pages reload and its breakpoints follow. If the tour is deleted, it is closed.
- The first time the folder is created in a git repository, minuet asks whether to share the tours or keep them
  local. Keeping them local adds the folder to `.git/info/exclude`, an ignore list that is not committed.

When the extension rewrites a file, `//` comments in it are not kept.

### Step content

`content` (and the tour's `context`) is either markdown text or a file, relative to the folder of `tour.json`:

```jsonc
"content": "The rate comes from the `DISCOUNTS` table."
"content": { "file": "discount.md" }
"content": { "file": "discount.html" }
```

Both are shown in **Current Step**, in the side bar on the right.

- **An HTML page is static: HTML and CSS, never scripts.** Scripts, `on…` handlers and frames are dropped, so
  opening a tour never runs code from it. Use SVG for diagrams and `<details>` for parts to expand.
- The page is drawn isolated: its css does not affect the panel, and the panel's does not affect it.
- It can use the files next to it (css, images, fonts), but nothing from the network.
- Content files cannot be outside the workspace.

### Tour file format

This is the contract agents use.

```jsonc
{
  "version": 1,
  "title": "How the order confirmation email is built",
  "context": "markdown with the starting point (optional)",
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

Root:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `version` | `1` | yes | Format version. |
| `title` | string | no | Tour title. Shown in the panel. |
| `context` | markdown or `{ "file" }` | no | Starting point, shown when the tour is opened. See [Step content](#step-content). |
| `run` | debug configuration or string | no | How to run the flow: a debug configuration (the same object as in `launch.json`) or the name of one. Shows ▶ on the tour. |
| `steps` | list | yes | At least one step. |

Each step:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `order` | integer ≥ 1 | yes | Position in the tour. Must be unique. Gaps (1, 2, 5) are renumbered. |
| `file` | string | yes | Path **relative to the workspace folder**, with `/`. Absolute paths are accepted too. In multi-root workspaces it can start with the folder name. |
| `line` | integer ≥ 1 | yes | Breakpoint line, **starting at 1** (as shown in the editor). One step per line. |
| `anchorText` | string | recommended | Text of that line as it is in the file (compared without leading or trailing spaces, and with inner whitespace collapsed). If it does not match, the step is still opened and marked as outdated. If missing, the current text of the line is used. |
| `title` | string | yes | Short step title. |
| `content` | markdown or `{ "file" }` | no | Explanation of the step: markdown text, or a `.md` / `.html` file relative to the tour's folder. |
| `highlights` | list | no | Ranges in the **same file**: `{ "startLine", "endLine", "note"? }`, starting at 1, `endLine` inclusive. |
| `watches` | list of strings | no | Expressions in the program's language, evaluated in the stopped frame, with the same rules as the *Watch* view. |

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
6. Few steps (5 to 8) with short content. Whole objects can be used as expressions (`event.body`): they expand
   in the view.
7. Avoid expressions with side effects (calls that change state). They are evaluated in the real run.

A complete example is in `examples/checkout/.minuet/checkout/`.

---

## How steps follow breakpoints

- The tour's content lives only in its file (see [Tour files](#tour-files)). VS Code only remembers which tour
  is open in each workspace.
- Each step is linked to its breakpoint by file and line. Breakpoint ids change between sessions.
- **Deleting the breakpoint deletes its step.** Deleting the step keeps the breakpoint.
- If the breakpoint moves (for example, when lines are added above it), the step and its highlights move
  with it.
- If the text of the line no longer matches its anchor text, the step becomes **outdated**: it shows ⚠ in the
  panel, in the CodeLens and in Current Step, but it is not deleted. **Re-anchor** (in Current Step or in **Edit
  Step**) marks it as up to date again.
- **Removing every breakpoint of the tour at once** (for example with *Remove All Breakpoints*) closes the tour
  instead of deleting all its steps. The file is kept.
- When VS Code starts, if a step has no breakpoint, the breakpoint is created again. VS Code delivers the
  breakpoint list to extensions asynchronously; deleting the step at that point could wipe the whole tour
  because of a startup race.

---

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `minuet.toursFolder` | `.minuet` | Folder of the tours. Relative to the first workspace folder, or absolute. |
| `minuet.showCodeLens` | `true` | Show `◆ Step N of M · title` above the line of each step. |
| `minuet.followCursor` | `true` | Select a step when the cursor is placed on its line. |
| `minuet.suggestExecutionOrder` | `true` | When a session ends, offer to reorder if execution went through the steps in a different order. |

Colors can be changed in `workbench.colorCustomizations`:

- `minuet.highlightBackground`
- `minuet.highlightBorder`
- `minuet.noteForeground`

---

## Sample project

`examples/checkout` is a small TypeScript checkout (cart, coupon, shipping) with a test, and the tour an agent
would build when asked how it works. The tour has 5 steps across 4 files and runs the test with a sample order:
its context is a diagram of the flow, the coupon step shows which items it counts, and the last step draws the
receipt. The real values at each stop match the pictures.

1. Press **F5** in this project and pick **Checkout**. A development window opens with the example.
2. **Tours** → click *How checkout works*.
3. Click ▶ on the tour (it runs the test under the debugger; Node runs the TypeScript directly, 22.18 or later).
4. Execution stops at each step. **Continue** (F5) moves to the next one.

`examples/sample-python` shows a tour in Python (`orders.py`, a `unittest` test and its tour). To try it, press
**F5** and pick **Python**; the Python extension must be installed in VS Code.

---

## Development

```bash
pnpm install
pnpm compile         # types + lint + bundle (dist/extension.js, dist/webview.js)
pnpm lint
pnpm test            # unit and integration tests (real debug sessions of the test fixture and of examples/checkout)
pnpm test:python     # a real debugpy session of examples/sample-python (needs python3; installs the debugger)
pnpm package         # builds the .vsix
```

<details>
<summary><strong>Source structure</strong></summary>

The code is split in layers. `src/core` is pure logic (no VS Code API, enforced by the linter), so it can be
tested on its own; the other layers adapt it to VS Code.

| Folder / file | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation: creates every part and wires them together. |
| `src/commands.ts` | Commands. |
| **`src/core/`** | **Pure logic.** |
| `core/model.ts` | Data model: `Step`, `Content`, `TourMeta`. |
| `core/tourFormat.ts` | Validation and conversion of the tour JSON. |
| `core/paths.ts` | Paths relative to the workspace and the tours folder. |
| `core/reconcile.ts` | Step ↔ breakpoint re-association. |
| `core/staleness.ts` | Outdated step detection. |
| `core/executionOrder.ts` | Reordering by execution. |
| `core/lines.ts` | 0-based ↔ 1-based lines. |
| **`src/tours/`** | **Tour files and the open tour.** |
| `tours/tours.ts` | The tours folder: open, close, create, delete, write and reload tours. |
| `tours/stepStore.ts` | The steps of the open tour, in memory. |
| `tours/staleTracker.ts` | Outdated steps (reads the documents). |
| **`src/debug/`** | **The debugger.** |
| `debug/breakpointSync.ts` | Keeps steps attached to their breakpoints. |
| `debug/stopController.ts` | Detects stops, finds the step, evaluates expressions and records the execution order. |
| **`src/views/`** | **What the user sees.** |
| `views/toursView.ts` | "Tours" view: the tours, and the open one's steps. |
| `views/currentStep/` | "Current Step" view: the provider, its state, the message protocol and the webview script. |
| `views/decorations.ts`, `views/codeLens.ts` | Highlights, notes and the CodeLens of each step. |
| `views/selection.ts`, `views/navigation.ts` | Selected step, and opening a step in the editor. |
| **`src/agents/`** | **Coding agents.** |
| `agents/agentSkills.ts` | Installs the skill for each agent. |
| `agents/uriHandler.ts` | `vscode://martindotts.minuet/open` URI. |
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

---

## License

MIT © Martin Thompson. See the `LICENSE` file.
