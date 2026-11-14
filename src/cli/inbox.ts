import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { type Answerer, type Item, type Kind, type Message, type Select, SchemaError } from "../schema";
import { answerItem, answerOf, appendMessage, createItem, docsDir, findItem, readItem } from "../store";

const EXIT_ERROR = 2;
const EXIT_LOST = 3;
const EXIT_TIMEOUT = 4;
const POLL_MS = 1000;
const MAX_BAD_READS = 3;

const USAGE = `usage:
  inbox ask --kind <kind> --from "<skill> · <session>" [--select one|many] [--map <slug> [--concern <slug>]]
            [--option <label> ...] [--recommended <label> ...]   < body
  inbox wait <id> [--timeout <seconds>]
  inbox reply <id>   < message
  inbox answer <id> (--option <label> ... | --text <answer>) [--note <text>] [--by inbox|chat]`;

const commands: Record<string, (args: string[]) => Promise<number>> = { ask, wait, reply, answer };

const [command = "", ...args] = process.argv.slice(2);
try {
  const run = Object.hasOwn(commands, command) ? commands[command] : undefined;
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
      select: { type: "string", default: "one" },
      option: { type: "string", multiple: true },
      recommended: { type: "string", multiple: true },
    },
  });
  const select = values.select as Select;

  const item: Item = {
    type: "inbox",
    kind: values.kind as Kind,
    map: values.map ?? null,
    concern: values.concern ?? null,
    from: values.from as string,
    status: "awaiting-you",
    select,
    options: values.option ?? [],
    recommended: values.recommended === undefined ? null : labels(select, values.recommended),
    thread: [],
    answer: null,
    note: null,
    answered_by: null,
    created_at: new Date().toISOString(),
    answered_at: null,
    body: readFileSync(0, "utf8"),
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
  const [id] = positionals;

  const timeout = values.timeout === undefined ? Infinity : Number(values.timeout);
  if (!(timeout >= 0)) throw new Error("--timeout must be a number of seconds");
  const deadline = Date.now() + timeout * 1000;

  let badReads = 0;
  for (;;) {
    try {
      const item = readItem(path);
      badReads = 0;
      if (item.status === "answered") {
        console.log(JSON.stringify({ event: "answer", ...answerOf(item) }));
        return 0;
      }
      const messages = unanswered(item.thread);
      if (messages.length > 0) {
        console.log(JSON.stringify({ event: "message", messages }));
        return 0;
      }
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (!missing && !(error instanceof SchemaError)) throw error;
      if (++badReads > MAX_BAD_READS || Date.now() >= deadline) {
        throw missing ? new Error(`no inbox item ${id}`) : error;
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.error(`inbox: timed out waiting on ${id}`);
      return EXIT_TIMEOUT;
    }
    await sleep(Math.min(POLL_MS, remaining));
  }
}

async function reply(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const path = locate(positionals);

  const { appended, item } = await appendMessage(path, { author: "agent", text: readFileSync(0, "utf8") });
  if (!appended) {
    console.log(JSON.stringify(answerOf(item)));
    return EXIT_LOST;
  }
  console.log(JSON.stringify({ messages: item.thread.length }));
  return 0;
}

async function answer(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      option: { type: "string", multiple: true },
      text: { type: "string" },
      note: { type: "string" },
      by: { type: "string", default: "chat" },
    },
  });
  if ((values.option === undefined) === (values.text === undefined)) {
    throw new Error("give exactly one of --option or --text");
  }
  const path = locate(positionals);

  const { won, item } = await answerItem(path, {
    answer: values.option === undefined ? values.text! : labels(readItem(path).select, values.option),
    note: values.note ?? null,
    answered_by: values.by as Answerer,
  });
  console.log(JSON.stringify(answerOf(item)));
  return won ? 0 : EXIT_LOST;
}

function labels(select: Select, given: string[]): string | string[] {
  return select === "one" && given.length === 1 ? given[0] : given;
}

function unanswered(thread: Message[]): Message[] {
  const lastReply = thread.map((message) => message.author).lastIndexOf("agent");
  return thread.slice(lastReply + 1);
}

function locate(positionals: string[]): string {
  if (positionals.length !== 1) throw new Error("give exactly one item id");
  const [id] = positionals;
  const path = findItem(docsDir(), id);
  if (path === null) throw new Error(`no inbox item ${id}`);
  return path;
}
