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
  <a href="https://marketplace.visualstudio.com/items?itemName=martindotts.minuet"><img src="https://img.shields.io/visual-studio-marketplace/v/martindotts.minuet?label=marketplace&color=6a32a0" alt="Marketplace"></a>
  <a href="https://github.com/martindotts/minuet/actions/workflows/release.yml"><img src="https://github.com/martindotts/minuet/actions/workflows/release.yml/badge.svg" alt="Build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/martindotts/minuet?color=6a32a0" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.90%2B-6a32a0" alt="VS Code 1.90+">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#tours">Tours</a> ·
  <a href="#tour-format">Tour format</a> ·
  <a href="#commands">Commands</a>
</p>

https://github.com/user-attachments/assets/e18ee8c6-82ed-4160-a0fb-61cf80e0e66f

---

## Quick start

1. **Install** minuet from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=martindotts.minuet),
   or run `code --install-extension martindotts.minuet`.
2. **Install the agent skill** (once): Command Palette → **minuet: Install Agent Skill**. It works with Claude
   Code, Codex, Cursor, GitHub Copilot, Gemini CLI and any agent that supports
   [Agent Skills](https://agentskills.io). For other agents: `npx skills add martindotts/minuet -g`.
3. **Ask your agent:**

   > Explain with minuet how checkout works

4. **Run it.** Accept opening the tour and click ▶ on it in **Tours**. Execution stops at each step, with its
   explanation and the real values.

## Why minuet

- **Your agent builds the tour.** It reads the code, picks the steps, finds (or writes) a test that runs the flow
  and saves the tour in `.minuet/`.
- **You run it for real.** At each step you see what happens, why it matters and the actual values, objects
  included.
- **Tours are plain files.** Commit them to share a walkthrough with your team, or keep them on your machine.

It works with any language VS Code can debug: JavaScript/TypeScript, Python, Go, Java, C# and more.

## How it works

Each step of a tour is a breakpoint with a **title**, its **content** (markdown, or an HTML page with diagrams
and tables), **highlighted code ranges** and **expressions** to evaluate.

- **Tours** (minuet's icon in the Activity Bar) lists the tours of the project. Click one to open it: it expands
  into its steps and sets their breakpoints. ▶ runs it.
- **Current Step**, in the side bar on the right, shows the step: its content and the real value of each
  expression when execution stops there. Objects expand on click.
- A CodeLens above each step's line (`◆ Step 3 of 5 · title`) and violet highlights mark the steps in the code.

It is not a new debugger: execution is the usual one, and everything is built on the public VS Code API.

When a test is paused at a breakpoint, its runner's timeout must be off, or it kills the test (`--testTimeout=0`
in vitest and jest, `--timeout 0` in mocha). If steps run in a different order than the tour's, minuet offers to
reorder them at the end of the run.

## Tours

Tours live in `.minuet/` at the root of the project (or the folder set in `minuet.toursFolder`). Each tour is a
folder with its `tour.json` and the files of its steps:

```
.minuet/
  checkout/
    tour.json
    context.html
    coupon.html
```

- **To add a tour**, put it in the folder: copy it, pull it from git, or let an agent write it. To get rid of
  one, delete it.
- **One tour is open at a time.** Opening it sets its breakpoints; closing it removes them.
- **Changes are saved right away**, and changes on disk (a `git pull`, an agent) reload the open tour.
- **If the code changes** and a step's line no longer matches, the step is marked ⚠ outdated. **Re-anchor** marks
  it as up to date again.

**HTML pages are static:** HTML and CSS, with local images and SVG, but never scripts and nothing from the
network, so opening a tour never runs code from it.

`examples/checkout` has a complete example: press **F5** in this repository, pick **Checkout**, open *How
checkout works* in **Tours** and click ▶.

## Tour format

```jsonc
{
  "version": 1,
  "title": "How checkout works",
  "context": { "file": "context.html" },
  "run": { "type": "node", "request": "launch", "runtimeArgs": ["--test"], "program": "${workspaceFolder}/test/checkout.test.ts" },
  "steps": [
    {
      "order": 1,
      "file": "src/checkout.ts",
      "line": 12,
      "anchorText": "const subtotal = subtotalOf(order.items);",
      "title": "An order comes in",
      "content": "Expand `order.items` to see what this order brings.",
      "highlights": [{ "startLine": 11, "endLine": 17, "note": "the four parts" }],
      "watches": ["order.items", "order.couponCode"]
    }
  ]
}
```

| Field | Description |
| --- | --- |
| `title`, `context` | Tour title, and its starting point: markdown or `{ "file": "….md" \| "….html" }`. |
| `run` | Optional. How to run the flow (▶): a debug configuration, as in `launch.json`, or the name of one. |
| `steps[].file`, `line` | Where the breakpoint goes: path relative to the workspace, line starting at 1. |
| `steps[].anchorText` | The text of that line, to detect when the code changes. |
| `steps[].content` | Markdown, or `{ "file": "….md" \| "….html" }` relative to the tour's folder. |
| `steps[].highlights` | Ranges in the same file (`startLine`, `endLine`, optional `note`). |
| `steps[].watches` | Expressions evaluated with the real values when execution stops there. |

The agent skill ([`skills/minuet/SKILL.md`](skills/minuet/SKILL.md)) has the full rules agents follow to write
tours.

## Commands

All of them are in the Command Palette (**minuet: …**); the step commands are also in the editor's context menu.

| Command | What it does |
| --- | --- |
| **New Tour…** / **Open Tour…** / **Close Tour** / **Delete Tour…** | Manage the tours of `.minuet/`. |
| **Run Tour** | Runs the open tour with its `run` configuration (▶). |
| **Add Step on This Line** | Adds a step on the cursor line (and its breakpoint). |
| **Edit Step** / **Delete Step** | Change or remove a step. Deleting a step keeps its breakpoint. |
| **Highlight Selection in Step…** / **Add Expression to Evaluate…** | Add to a step. |
| **Add to Step** | In the debugger's Variables view: adds a variable to the step where execution is stopped. |
| **Order Steps by Last Run** | Renumbers the steps in the order the last run reached them. |
| **Install Agent Skill** | Installs the skill for the agents on your machine. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `minuet.toursFolder` | `.minuet` | Folder of the tours. |
| `minuet.showCodeLens` | `true` | Show `◆ Step N of M · title` above each step's line. |
| `minuet.followCursor` | `true` | Select a step when the cursor is on its line. |
| `minuet.suggestExecutionOrder` | `true` | Offer to reorder the steps when a run reached them in another order. |

## Development

```bash
pnpm install
pnpm compile         # types, lint and bundle
pnpm test            # unit and integration tests (real debug sessions)
pnpm test:python     # a real debugpy session (needs python3)
pnpm package         # builds the .vsix
```

Press **F5** to open a development window with one of the examples.

## License

MIT © Martin Thompson. See [LICENSE](LICENSE).
