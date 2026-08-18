export type TieBreakInput = {
  pickerId: string;
  from: { x: number; y: number };
  dest: { x: number; y: number };
  options: { x: number; y: number }[];
};

const DEFAULT_MODEL = "meta-llama/llama-3.2-3b-instruct:free";

export function heuristicTieBreak(input: TieBreakInput): { x: number; y: number } | null {
  if (input.options.length === 0) return null;
  return input.options.reduce((a, b) => {
    const da = Math.abs(a.x - input.dest.x) + Math.abs(a.y - input.dest.y);
    const db = Math.abs(b.x - input.dest.x) + Math.abs(b.y - input.dest.y);
    if (da !== db) return da < db ? a : b;
    if (a.x !== b.x) return a.x < b.x ? a : b;
    return a.y <= b.y ? a : b;
  });
}

export function parseCellChoice(
  text: string,
  options: { x: number; y: number }[],
): { x: number; y: number } | null {
  const m = text.match(/(-?\d+)\s*,\s*(-?\d+)/);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return options.find((o) => o.x === x && o.y === y) ?? null;
}

/**
 * This string is stored in scents.reason, embedded into the vector, and shown to
 * the user verbatim. It has to read as a sentence on its own, because the
 * interface quotes it as the picker's own account of what happened.
 */
export function plainScentReason(
  kind: string,
  cell: { x: number; y: number },
  sku?: string,
): string {
  const at = `(${cell.x},${cell.y})`;
  if (kind === "dead_end") {
    return sku
      ? `another picker got ${sku} at ${at} first`
      : `lost a package claim at ${at}`;
  }
  if (kind === "jam") return `cell ${at} was already reserved by another picker`;
  if (kind === "trail") return `a delivery came through ${at}`;
  return `${kind.replaceAll("_", " ")} at ${at}`;
}

export async function phraseScentReason(opts: {
  kind: string;
  cell: { x: number; y: number };
  sku?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fallback = plainScentReason(opts.kind, opts.cell, opts.sku);
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return fallback;

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
        max_tokens: 80,
        messages: [
          {
            role: "system",
            content:
              "You write one short warehouse pheromone note. No quotes. Under 20 words. Mention cell and why it jammed.",
          },
          {
            role: "user",
            content: `kind=${opts.kind} cell=(${opts.cell.x},${opts.cell.y}) sku=${opts.sku ?? "none"}`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

export async function openRouterTieBreak(
  input: TieBreakInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ x: number; y: number } | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return heuristicTieBreak(input);

  try {
    const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
        max_tokens: 24,
        messages: [
          {
            role: "system",
            content: "Reply with only one pair x,y from the options. No other text.",
          },
          {
            role: "user",
            content: `from=${input.from.x},${input.from.y} dest=${input.dest.x},${input.dest.y} options=${input.options
              .map((o) => `${o.x},${o.y}`)
              .join(" ")}`,
          },
        ],
      }),
    });
    if (!res.ok) return heuristicTieBreak(input);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return parseCellChoice(text, input.options) ?? heuristicTieBreak(input);
  } catch {
    return heuristicTieBreak(input);
  }
}
