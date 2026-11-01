import { execFile } from "node:child_process";

/** Opens the native macOS folder chooser and returns the chosen path. */
export async function POST(req: Request) {
  if (process.platform !== "darwin") {
    return Response.json({ error: "Folder picker is only available on macOS. Paste the path instead." }, { status: 501 });
  }
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  const safePrompt = (prompt ?? "Choose a folder").replace(/["\\]/g, "");
  return new Promise<Response>((resolve) => {
    execFile(
      "osascript",
      ["-e", `POSIX path of (choose folder with prompt "${safePrompt}")`],
      { timeout: 5 * 60_000 },
      (err, stdout) => {
        if (err) resolve(Response.json({ cancelled: true }));
        else resolve(Response.json({ path: stdout.trim().replace(/\/$/, "") }));
      },
    );
  });
}
