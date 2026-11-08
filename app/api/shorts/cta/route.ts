import { isSpeed, isVoice } from "@/lib/script";
import { speakLine } from "@/lib/server/tts";

/** Speaks a Short's call-to-action with the app's voice-over. Returns the WAV's path and length. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 200) : "";
  if (!text) return Response.json({ error: "There is no line to speak." }, { status: 400 });
  if (!isVoice(body.voice)) return Response.json({ error: "That is not one of the voices on offer." }, { status: 400 });
  if (!isSpeed(body.rate)) return Response.json({ error: "That is not one of the speeds on offer." }, { status: 400 });
  try {
    return Response.json(await speakLine(text, body.voice, body.rate));
  } catch (e) {
    return Response.json({ error: `The voice service failed: ${(e as Error).message}` }, { status: 502 });
  }
}
