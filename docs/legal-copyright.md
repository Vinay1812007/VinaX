# VinaX — Legal & Copyright Notes

**Nature of the service.** VinaX is a free, no-login music player. It streams music,
artwork and lyrics from third-party public catalogue APIs. VinaX hosts no media files,
charges no money, shows no ads, and sells no data.

**Copyright.** All songs, sound recordings, compositions, artwork and lyrics remain the
property of their respective artists, composers, labels and publishers. VinaX displays
attribution (title, artists, album, film) exactly as provided by the catalogue source.

**Takedowns.** Rights holders may request removal of any content via the in-app DMCA page
(`/dmca`) or the contact page (`/contact`). Verified requests are honoured by adding the
content to the server-side blocklist, which removes it from search, playback and
recommendations across all clients.

**User data.** There are no accounts. Personal listening data (favorites, history, taste
profile) is stored only on the listener's device with one-tap export and erase. Server-side
analytics are opt-in, anonymous and coarse (city level at most); IP addresses are never
stored. See `docs/phase1/privacy-baseline.md` for the enforced requirements.

**Third-party services.** Catalogue: public JioSaavn mirror APIs. Lyrics: LRCLIB
(lrclib.net). AI inference: NVIDIA-hosted open models (server-side keys; prompts carry only
bounded anonymous taste summaries). Hosting: Cloudflare Pages. Database: Supabase
(anonymous telemetry + ephemeral rooms only).

**Disclaimer.** The service is provided "as is", without warranty of any kind. Catalogue
availability depends on third-party sources and may change without notice.
