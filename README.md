# agents-obsidian

`inbox` lets an agent session put a question to you as a markdown file, wait for your answer, and read it back. `src/schema.ts` defines the item format.

An item lives in `<docs>/maps/<map>/inbox/<id>.md` when it belongs to a map, and in `<docs>/inbox/<id>.md` otherwise. `<docs>` is `~/Code/agent-docs`, or `INBOX_DOCS_DIR` when set. The first answer wins: a second answer exits 3 and prints the first.

```sh
npm install && npm run build && npm link

id=$(printf '**Deciding — Frontmatter library**\n' |
  inbox ask --kind decide --from "plan · s1" --option yaml --option gray-matter --recommended yaml)

inbox wait "$id" --timeout 3600
# {"answer":"yaml","note":null,"answered_by":"chat"}
```

Answer from a terminal with `inbox answer "$id" --option yaml --note "keep it simple"`.

Exit codes: 0 success, 2 error, 3 another answer already won, 4 `wait` timed out.

## The Obsidian panel

The `agents` plugin lists every item that waits on you in Obsidian's right sidebar. It reads `inbox/` and `maps/*/inbox/` under the vault root, so the vault is your docs directory. Items group by map, then concern, newest first, with root items under "No map".

Click an option to answer, with an optional note. An item with no options takes the note as its answer. The panel answers through the same first-answer-wins store as the CLI, with `answered_by: inbox`, so a waiting `inbox wait` returns. When another surface won first, the card shows that answer and writes nothing.

Install it into your vault, then enable "Agents" under Settings → Community plugins:

```sh
npm run deploy                                # into ~/Code/agent-docs
OBSIDIAN_VAULT=/path/to/vault npm run deploy  # into another vault
```

Open the panel with the inbox ribbon icon or the `Open inbox` command. The plugin is desktop only.

`npm run e2e` runs the panel tests in a sandboxed Obsidian against a copy of `test/vaults/inbox`. The first run downloads Obsidian into `.obsidian-cache/`.
