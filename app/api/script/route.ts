import { extractText, getDocumentProxy } from "unpdf";
import { parseScript, scriptTitle } from "@/lib/server/script";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Script PDF in (raw body), parts + shots out. Nothing is stored. */
export async function POST(req: Request) {
  const name = new URL(req.url).searchParams.get("name") || "script.pdf";
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return fail("Choose a PDF to read.");
  if (bytes.length > MAX_PDF_BYTES) return fail("That PDF is over 20 MB — a script should be far smaller.");

  let text: string;
  let pages: number;
  let firstPage: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const r = await extractText(pdf, { mergePages: false });
    text = r.text.join("\n");
    firstPage = r.text[0] ?? "";
    pages = r.totalPages;
  } catch {
    return fail("Could not read that PDF. Is it password-protected or damaged?");
  }
  if (!text.trim()) return fail("That PDF has no text in it — it is probably scanned images. Export the script as a text PDF.");

  const parts = parseScript(text);
  if (!parts.length) {
    return fail(`No NARRATION found in ${name}. Put the spoken lines under a NARRATION: label for each shot.`);
  }
  return Response.json({ file: name, pages, parts, title: scriptTitle(firstPage) });
}

function fail(error: string) {
  return Response.json({ error }, { status: 400 });
}
