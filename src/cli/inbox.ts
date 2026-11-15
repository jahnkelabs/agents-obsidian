import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { type Answerer, type Item, type Kind, type Message, type Select, SchemaError, shaped } from "../schema";
import { answerItem, answerOf, appendMessage, createItem, deliverMessages, docsDir, findItem, readItem, reviseChoices } from "../store";

const EXIT_ERROR = 2;
const EXIT_LOST = 3;
const EXIT_TIMEOUT = 4;
const EXIT_STALE = 5;
const POLL_MS = 1000;
const MAX_BAD_READS = 3;

const USAGE = `usage:
  inbox ask --kind <kind> --from "<skill> · <session>" [--select one|many] [--map <slug> [--concern <slug>]]
            [--option <label> ...] [--recommended <label> ...]   < body
  inbox wait <id> [--timeout <seconds>]
  inbox reply <id>   < message
  inbox revise <id> ([--select one|many] [--option <label> ...] [--recommended <label> ...] | --open) [--note <markdown>]
  inbox answer <id> (--option <label> ... | --text <answer>) [--note <text>] [--by inbox|chat]`;

const commands: Record<string, (args: string[]) => Promise<number>> = { ask, wait, reply, revise, answer };

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
    recommended: values.recommended === undefined ? null : shaped(select, values.recommended),
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
      if (item.thread.some((message) => message.author === "you" && message.delivered_at === undefined)) {
        const delivery = await deliverMessages(path);
        if (delivery.item.status === "answered") {
          console.log(JSON.stringify({ event: "answer", ...answerOf(delivery.item) }));
          return 0;
        }
        if (delivery.messages.length > 0) {
          const messages = delivery.messages.map(({ author, at, text }) => ({ author, at, text }));
          console.log(JSON.stringify({ event: "message", messages }));
          return 0;
        }
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

async function revise(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      select: { type: "string" },
      option: { type: "string", multiple: true },
      recommended: { type: "string", multiple: true },
      open: { type: "boolean", default: false },
      note: { type: "string" },
    },
  });
  const changes = [values.select, values.option, values.recommended].filter((value) => value !== undefined).length;
  if (values.open && changes > 0) throw new Error("--open takes no --select, --option, or --recommended");
  if (!values.open && changes === 0) throw new Error("give --open, or at least one of --select, --option, --recommended");
  const path = locate(positionals);

  const { revised, item } = await reviseChoices(path, {
    select: values.select as Select | undefined,
    options: values.option,
    recommended: values.recommended,
    open: values.open,
    note: values.note,
  });
  if (!revised) {
    console.log(JSON.stringify(answerOf(item)));
    return EXIT_LOST;
  }
  console.log(JSON.stringify({ revised: true }));
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
  const { select, options } = readItem(path);

  const { won, stale, item } = await answerItem(path, {
    answer: values.option ?? values.text!,
    note: values.note ?? null,
    answered_by: values.by as Answerer,
    basis: { select, options },
  });
  if (stale) {
    const { select, options, recommended } = item;
    console.log(JSON.stringify({ stale: true, select, options, recommended }));
    return EXIT_STALE;
  }
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
