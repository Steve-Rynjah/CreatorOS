# CreatorOS

Local web app for YouTube creators: turn numbered images + voice-over into a video, and merge video parts.

```bash
npm install
npm run dev      # open http://localhost:3000 in Chrome or Edge
```

It runs on your own computer. It reads your folders directly and needs no API keys. ffmpeg is bundled (`ffmpeg-static`). You can point to your own copy with `FFMPEG_PATH=/path/to/ffmpeg`.

## Video Editor
1. Images folder: `01.jpg, 02.jpg, 03.jpg …`. Voice-over: drop, paste (⌘V) or choose one audio file.
2. Each image lasts *N* seconds (5 by default). The images end together with the narration, so the
   first image starts at `voice-over − images × N`. Example: 125.18s − 24×5s → **5.18s**. You can switch this to Manual and set your own start time.
3. Tabs:
   - **Animation**: Zoom In / Zoom Out motion, and Dissolve / Slide Left / Slide Right transitions. Click a preset to apply it to the selected clips, or drag it onto a clip.
   - **Text**: add text at the playhead. Drag it on the preview to move it, drag or trim it on the timeline to change its timing.
   - **Subtitles**: generate them from the voice-over with Whisper, which runs on your computer. The model downloads once. You can turn subtitles on or off, edit them, and import or export `.srt`.
4. **Export**: 1080p, 1440p or 4K, at 24, 25, 30 or 60 fps. Frames are encoded in the browser (WebCodecs H.264), then the voice-over is added as AAC 320k. The file is saved to the folder you choose, and you can download it.

Shortcuts: Space play/pause · ←/→ move one frame (Shift: 1s) · ⌘Z / ⇧⌘Z undo/redo · ⌘A select all clips · Delete removes the selected text/subtitle.

Edits are autosaved in the browser for each folder pair.

## Merge Videos
Add the **Hook, V1–V5** videos and the **polished script PDF**, then click **Merge**.
- **Adding a video:** click a box to pick the video (the file stays where it is), or drop it on the box. Drag one filled box onto another to swap them.
- **Joining:** if every part has the same format, they are joined losslessly. If not, they are re-encoded with H.264 CRF 16 and AAC 320k.
- **Captions:** the `.srt` comes from the script, with no transcription:
  - A part you built on Home from this same script reuses its exact burned-in subtitles.
  - Any other part is timed to the voice: ffmpeg finds the pauses, and each sentence is matched to its pause. In tests on Edge-voiced parts, captions started a median of 0.05–0.14 s from the true time.
  - The hook's spoken title card is detected and captioned automatically.
- **Result:** the `.srt` is saved next to the merged MP4 and can be downloaded from the page.

## Publish Kit
Everything for the YouTube upload, with no paid APIs or keys.
1. Add the merged MP4, the polished script PDF and the `.srt` that Merge Videos saved next to the video. The title is read from the PDF's first page.
2. **Build Publish Kit**: captions come from that `.srt`. Chapters are found by matching each part's first narration line in those subtitles: first at 0:00, each ≥ 10 s, ≥ 3 needed.
3. **Copy SEO prompt** → paste it into ChatGPT/Claude → paste the JSON answer back. Titles, description, tags, hashtags, pinned comment and Short idea fill in and can be edited.
4. Thumbnails are drawn in the browser from a shot image: 1280×720 JPG under 2 MB, up to 3 versions.
5. **Download all** gives a .zip with the thumbnails, `captions.srt` and `metadata.txt`. Kits autosave under the video title.

## Shorts Maker
Three vertical Shorts (about 35, 45 and 30 s) from the final long video, with no paid APIs or keys.
1. Add the final video (click to pick it in place, or drop it) and the polished script PDF, then click **Make Shorts**.
2. **Timing.** If every part of the script was built on Home and those edits add up to the video's length, their word timings are reused. If not, local Whisper (`whisper-base.en`, on your computer) gives word timestamps. If Whisper fails, the voice's pauses are used instead. The heard words are aligned to the script's words, so a misheard name doesn't shift the timing.
3. **Picking (rules, no AI).** Short 1 is the hook: from the first spoken word (never the title card) to the question nearest 35 s ("Who was the man behind it?"); it freezes on that frame for 1 s, then shows the end tag. Sentence edges are snapped to the voice's pauses, since Whisper often starts a word early. Shorts 2 and 3 are the best-scoring pair that doesn't overlap: money figures, part cliffhangers, tension words, on-screen text, punchy lines, a tense ending. Clips lose points for openings that need earlier context, `[VERIFY]` claims, and sharing a part. Clips never include the last 4 shots or subscribe/like/comment lines.
4. **Look.** 1080×1920, 30 fps, H.264 + AAC:
   - the bottom 15% of the source cropped off (old subtitles), then a 4:5 centre crop scaled to 1080×1350, a little above centre, over a blurred, darkened fill of the same cropped frame
   - a 90 px Anton hook title above the video (max 6 words, all caps, key word in yellow, editable; defaults to the part's title for the hook, else the most striking line)
   - 80 px Montserrat Black captions about 72% down, 1–3 words at a time, with the spoken word in yellow and a pop
   - a "Full story on the channel ↑" end tag
   - audio fades
   
   All text stays out of YouTube's right 15% and bottom 20%. The fonts are bundled in `assets/fonts` (OFL, licences in `assets/licenses`).
5. **Edit.** Each Short has:
   - a live preview
   - a sentence-snapping timeline with nudge buttons
   - the next 5 best clips
   - editable hook and captions, toggles and a crop slider
   
   Only changed Shorts need to be rendered again.
6. **Export.** `short_1_hook.mp4`, `short_2.mp4`, `short_3.mp4` or a .zip, plus a title and description for each. Projects autosave under the video title.
