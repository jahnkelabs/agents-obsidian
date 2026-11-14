# agents-obsidian

`inbox` lets an agent session put a question to you as a markdown file, wait for your answer, and read it back. `src/schema.ts` defines the item format.

An item lives in `<docs>/maps/<map>/inbox/<id>.md` when it belongs to a map, and in `<docs>/inbox/<id>.md` otherwise. `<docs>` is `~/Code/agent-docs`, or `INBOX_DOCS_DIR` when set. The first answer wins: a second answer exits 3 and prints the first.

```sh
npm install && npm run build && npm link

id=$(printf '**Deciding — Frontmatter library**\n' |
  inbox ask --kind decide --from "plan · s1" --option yaml --option gray-matter --recommended yaml)

inbox wait "$id" --timeout 3600
# {"event":"answer","answer":"yaml","note":null,"answered_by":"chat"}
```

Answer from a terminal with `inbox answer "$id" --option yaml --note "keep it simple"`.

`inbox ask --select many` asks a pick-many question, and its answer is a list of labels. `inbox wait` also returns on a message you post in Obsidian, as `{"event":"message","messages":[…]}`. The agent answers it with `inbox reply "$id"`, which reads markdown on stdin, and then waits again.

Exit codes: 0 success, 2 error, 3 another answer already won, 4 `wait` timed out.

## The Obsidian panel

The `agents` plugin lists every item that waits on you in Obsidian's right sidebar, one row per item: its title, kind, and age. It reads `inbox/` and `maps/*/inbox/` under the vault root, so the vault is your docs directory. Items group by map, then concern, newest first, with root items under "No map". A dot marks a row whose agent replied since you last viewed it. The plugin keeps that state in its own data, never in the item.

Click a row to open the item in a main-area tab. A second click on the same row focuses that tab. The tab renders the body and the thread as markdown, mermaid diagrams included, and it updates in place when the item changes.

Ask the agent a clarifying question in the message box at the bottom of the thread. Cmd/Ctrl+Enter sends, and Enter adds a line. The agent's `inbox wait` returns your message, and its `inbox reply` appears in the tab.

Answer whenever you are ready. A pick-one item offers radio buttons, and a pick-many item offers checkboxes and needs at least one tick. Add an optional note, then click Answer. An item with no options takes the note as its answer. The tab answers through the same first-answer-wins store as the CLI, with `answered_by: inbox`, so a waiting `inbox wait` returns. An answered item accepts no more messages, and its tab shows the winning answer with no controls.

Install it into your vault, then enable "Agents" under Settings → Community plugins:

```sh
npm run deploy                                # into ~/Code/agent-docs
OBSIDIAN_VAULT=/path/to/vault npm run deploy  # into another vault
```

Open the panel with the inbox ribbon icon or the `Open inbox` command. The plugin is desktop only.

`npm run e2e` runs the panel tests in a sandboxed Obsidian against a copy of `test/vaults/inbox`. The first run downloads Obsidian into `.obsidian-cache/`.
