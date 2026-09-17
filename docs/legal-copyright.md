# Legal and copyright notes

This document records the legal position the product is built around: what kind of service VinaX is, who owns the content it plays, how takedowns work, how listener data is treated and which kinds of outside services it depends on. It is a plain-language summary for maintainers, not legal advice. The listener-facing pages are `/terms`, `/privacy`, `/dmca` and `/contact` in the app.

**Nature of the service.** VinaX is a free music player with no login. It streams music, artwork and lyrics from public catalogue sources. It hosts no media files, charges nothing, shows no ads and sells no data.

**Copyright.** All songs, sound recordings, compositions, artwork and lyrics remain the property of their artists, composers, labels and publishers. VinaX shows attribution (title, artists, album, film) as provided by the catalogue source.

**Takedowns.** Rights holders can ask for removal through the in-app DMCA page (`/dmca`) or the contact page (`/contact`). A verified request is honoured by adding the content to the server-side blocklist (`/api/blocklist`), which removes it from search, playback and recommendations on every client.

**Listener data.** There are no accounts. Favourites, history and the taste profile are stored only on the listener's device, with export and erase. Server-side usage statistics are gated on the listener's usage-sharing choice, anonymous and coarse (city level at most); IP addresses are not stored. The enforced rules are in [data-and-privacy.md](data-and-privacy.md).

**Outside services, by kind.** A public music catalogue and its media CDN; an open lyrics database; hosted AI model endpoints reached with server-side keys, which receive bounded taste summaries and no identity; static hosting and an edge Worker platform; a hosted database that holds opt-in anonymous usage rows, published configuration, push tokens and short-lived rooms. The operational names are in [operations.md](operations.md) and `backend/.env.example`.

**Disclaimer.** The service is provided "as is", without warranty of any kind. Catalogue availability depends on outside sources and can change without notice.
