import { execFile } from "node:child_process";

/** Opens the native macOS file chooser for a video and returns its path (the file is not copied). */
export async function POST(req: Request) {
  if (process.platform !== "darwin") {
    return Response.json({ error: "The file picker is only available on macOS. Drop the file instead." }, { status: 501 });
  }
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  const safePrompt = (prompt ?? "Choose a video").replace(/["\\]/g, "");
  return new Promise<Response>((resolve) => {
    execFile(
      "osascript",
      ["-e", `POSIX path of (choose file with prompt "${safePrompt}" of type {"public.movie"})`],
      { timeout: 5 * 60_000 },
      (err, stdout) => {
        if (err) resolve(Response.json({ cancelled: true }));
        else resolve(Response.json({ path: stdout.trim() }));
      },
    );
  });
}
