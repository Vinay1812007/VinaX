# Canvas clips — content spec

The Now Playing canvas (13.0.2) auto-fits every clip: a clip whose shape is
close to the screen fills it edge to edge (`object-cover`); a mismatched one
(past 1.45× overscan) plays whole (`object-contain`) over a blurred, zoomed
copy of itself — the whole screen stays moving video, with the blurred album
artwork underneath as the fallback while the clip loads. The fit is
re-decided per clip and on rotation (`frontend/src/components/SongCanvas.tsx`).

Clips made to this spec look best — full-bleed on the device they target.

## What the catalogue serves today (13.9)

The music-video source publishes each preview clip in named renditions,
`…_v_<height>p_p.mp4`. Probed in October 2026, every clip has a **540p** file
(the one the catalogue names as `previewUrl`) and a **360p** file beside it;
`_v_720p_p`, `_v_1080p_p`, `_v_1440p_p` and `_v_2160p_p` answer 404, and the
full-length `streamUrl` master is not served. So the canvas is 540p at best
today, and the player says so rather than printing "HD".

The ladder is wired for more (`frontend/src/services/canvas/quality.ts`): the
CDN answers HEAD with CORS, so the heights above 540p are probed — once a day
across all clips while none exists, then per clip once one has been seen — and
Full HD 1080p or 4K switch on by themselves the day the source adds them.
**Auto** plays the highest rendition that does not exceed the screen's longer
side in device pixels; the full-screen view's quality chip shows what is
playing and lets the listener pin a height. A rendition that fails steps down
to the next instead of switching the canvas off.

## Full-screen canvas (13.9)

The ⤢ button on Now Playing (shown while a clip plays) hides the controls and
asks the browser for real full screen; a tap on the clip alone hides the
controls without it. In the full-screen view: tap once for the controls,
double-tap anywhere to like the song (never unlike by accident) with a heart
where the finger landed, a heart button beside the caption, the quality chip
and a full-screen toggle at the top. Escape, Android back or the ⌄ button
return to the player and leave full screen.

## Mobile (phones, portrait)

- **Aspect ratio:** 9:16 portrait
- **Recommended resolution:** 1080 × 1920
- **Minimum resolution:** 720 × 1280
- **Duration:** 3–8 seconds, cut to loop seamlessly (the player loops it)
- **File format:** MP4 (or JPG for a still)

A 9:16 clip fills a phone screen edge to edge. Any other ratio displays
letterboxed over the clip's own blurred ambient fill.

## Desktop (landscape windows, TVs)

- **Aspect ratio:** 16:9 widescreen — other ratios display with
  letterboxing/pillarboxing over the clip's own blurred ambient fill
- **Recommended resolution:** 1080p or higher
- **Codecs:** H.264 or H.265 (HEVC) — H.264 is the safe floor; HEVC support
  varies by browser/WebView, so an H.264 fallback should always exist

## Encoding notes

- No audio track needed — the canvas plays muted; stripping audio saves bytes
- Keep files small (a 3–8 s loop at these sizes should sit well under ~4 MB);
  the clip streams on cellular alongside the song itself
- `moov` atom at the front (`-movflags +faststart` in ffmpeg) so playback
  starts before the file finishes downloading

Example ffmpeg for a mobile canvas:

```sh
ffmpeg -i source.mp4 -t 8 -an -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
  -c:v libx264 -preset slow -crf 23 -movflags +faststart canvas-9x16.mp4
```
