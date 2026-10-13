# Canvas clips — content spec

The Now Playing canvas (13.0.2) auto-fits every clip: a clip whose shape is
close to the screen fills it edge to edge (`object-cover`); a mismatched one
(past 1.45× overscan) plays whole (`object-contain`) over the blurred album
artwork, so letterboxing and pillarboxing never show black bands. The fit is
re-decided per clip and on rotation (`frontend/src/components/SongCanvas.tsx`).

Clips made to this spec look best — full-bleed on the device they target.

## Mobile (phones, portrait)

- **Aspect ratio:** 9:16 portrait
- **Recommended resolution:** 1080 × 1920
- **Minimum resolution:** 720 × 1280
- **Duration:** 3–8 seconds, cut to loop seamlessly (the player loops it)
- **File format:** MP4 (or JPG for a still)

A 9:16 clip fills a phone screen edge to edge. Any other ratio displays
letterboxed over the ambient artwork fill.

## Desktop (landscape windows, TVs)

- **Aspect ratio:** 16:9 widescreen — other ratios display with
  letterboxing/pillarboxing over the ambient fill
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
