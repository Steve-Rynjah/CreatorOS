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
Choose a folder with `VIDEO01.mp4, VIDEO02.mp4 …` and click **Merge**. If all parts have the same format (which is true for parts exported from this app), they are joined losslessly with no re-encode. If not, they are re-encoded with H.264 CRF 16 and AAC 320k.
