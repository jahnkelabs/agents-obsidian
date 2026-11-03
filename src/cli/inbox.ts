import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { type Answerer, type Item, type Kind } from "../schema";
import { answerItem, answerOf, createItem, docsDir, findItem, readItem } from "../store";

const EXIT_ERROR = 2;
const EXIT_LOST = 3;
const EXIT_TIMEOUT = 4;
const POLL_MS = 1000;

const USAGE = `usage:
  inbox ask --kind <kind> --from "<skill> · <session>" [--map <slug> [--concern <slug>]]
            [--option <label> ...] [--recommended <label>]   < body
  inbox wait <id> [--timeout <seconds>]
  inbox answer <id> (--option <label> | --text <answer>) [--note <text>] [--by inbox|chat]`;

const commands: Record<string, (args: string[]) => Promise<number>> = { ask, wait, answer };

const [command = "", ...args] = process.argv.slice(2);
try {
  const run = commands[command];
  if (!run) throw new Error(USAGE);
  process.exitCode = await run(args);
} catch (error) {
  console.error(`inbox: ${(error as Error).message}`);
  process.exitCode = EXIT_ERROR;
}

async function ask(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      kind: { type: "string" },
      map: { type: "string" },
      concern: { type: "string" },
      from: { type: "string" },
      option: { type: "string", multiple: true },
      recommended: { type: "string" },
    },
  });

  const item: Item = {
    type: "inbox",
    kind: values.kind as Kind,
    map: values.map ?? null,
    concern: values.concern ?? null,
    from: values.from as string,
    status: "awaiting-you",
    options: values.option ?? [],
    recommended: values.recommended ?? null,
    answer: null,
    note: null,
    answered_by: null,
    created_at: new Date().toISOString(),
    answered_at: null,
    body: await readStdin(),
  };
  console.log(createItem(docsDir(), item));
  return 0;
}

async function wait(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { timeout: { type: "string" } },
  });
  const path = locate(positionals);

  const timeout = values.timeout === undefined ? Infinity : Number(values.timeout);
  if (!(timeout >= 0)) throw new Error("--timeout must be a number of seconds");
  const deadline = Date.now() + timeout * 1000;

  for (;;) {
    const item = readItem(path);
    if (item.status === "answered") {
      console.log(JSON.stringify(answerOf(item)));
      return 0;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.error(`inbox: timed out waiting on ${positionals[0]}`);
      return EXIT_TIMEOUT;
    }
    await sleep(Math.min(POLL_MS, remaining));
  }
}

async function answer(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      option: { type: "string" },
      text: { type: "string" },
      note: { type: "string" },
      by: { type: "string", default: "chat" },
    },
  });
  if ((values.option === undefined) === (values.text === undefined)) {
    throw new Error("give exactly one of --option or --text");
  }
  const path = locate(positionals);

  if (values.option !== undefined && !readItem(path).options.includes(values.option)) {
    throw new Error(`answer: ${values.option} is not one of the options`);
  }

  const { won, item } = await answerItem(path, {
    answer: values.option ?? values.text ?? null,
    note: values.note ?? null,
    answered_by: values.by as Answerer,
  });
  console.log(JSON.stringify(answerOf(item)));
  return won ? 0 : EXIT_LOST;
}

function locate(positionals: string[]): string {
  if (positionals.length !== 1) throw new Error("give exactly one item id");
  const [id] = positionals;
  const path = findItem(docsDir(), id);
  if (path === null) throw new Error(`no inbox item ${id}`);
  return path;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
