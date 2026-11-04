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
