/**
 * YouTube search autocomplete for a subject (free, keyless — the same endpoint the
 * youtube.com search box uses). Proxied here because the browser blocks it cross-origin.
 * Asks for "<subject>", "<subject> a…" style variants too, so there are enough ideas.
 */
const ENDPOINT = "https://suggestqueries.google.com/complete/search";

async function suggest(q: string): Promise<string[]> {
  const url = `${ENDPOINT}?${new URLSearchParams({ client: "firefox", ds: "yt", hl: "en", gl: "us", q })}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`YouTube suggestions answered ${r.status}`);
  // client=firefox → ["query", ["suggestion", …]]
  const j = JSON.parse(new TextDecoder("utf-8").decode(await r.arrayBuffer()));
  return Array.isArray(j?.[1]) ? j[1].filter((s: unknown): s is string => typeof s === "string") : [];
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) return Response.json({ error: "Enter a subject to look up." }, { status: 400 });

  const queries = [q, `${q} `, `why ${q}`, `how ${q}`, `${q} explained`, `${q} story`];
  const results = await Promise.allSettled(queries.map(suggest));
  if (results.every((r) => r.status === "rejected")) {
    return Response.json({ error: "Could not reach YouTube suggestions. Check your internet connection." }, { status: 502 });
  }
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const s of r.value) {
      const k = s.toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      suggestions.push(s.trim());
    }
  }
  return Response.json({ query: q, suggestions: suggestions.slice(0, 30) });
}
