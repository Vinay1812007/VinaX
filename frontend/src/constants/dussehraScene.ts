/**
 * Dussehra living backdrop (13.7.1, owner request): Sri Rama draws his bow,
 * the arrow crosses the sky and strikes Ravanasura, the effigy's fire flares
 * and crackers burst, while Jammi (shami) leaves drift down.
 *
 * Original drawn art, no photographs. One 1200×500 stage; every part that
 * moves is its own layer over the same viewBox, so the animations are CSS
 * transforms and opacity on whole elements (compositor-only) and the static
 * art is painted once. Colours come from the --ds-* variables in
 * styles/dussehra-scene.css (dark and light). Pure data: imported only by the
 * lazily loaded festival backdrop, never by the first-load bundle.
 */
export const DS_VIEWBOX = '0 0 1200 500';

/** Gradients shared by every layer (ids are document-global, so ds- prefixed). */
export const DS_DEFS = '<defs><linearGradient id="ds-hero" x1="0" y1="140" x2="0" y2="470" gradientUnits="userSpaceOnUse"><stop offset="0" class="ds-hero-a"/><stop offset="1" class="ds-hero-b"/></linearGradient><linearGradient id="ds-foe" x1="0" y1="80" x2="0" y2="470" gradientUnits="userSpaceOnUse"><stop offset="0" class="ds-foe-a"/><stop offset=".45" class="ds-foe-b"/><stop offset="1" class="ds-foe-c"/></linearGradient></defs>';

/** Lanka on the horizon. */
export const DS_SKYLINE = '<path class="ds-skyline" d="M0 470V430h40v-22h18v22h30v-40l14-18 14 18v40h40v-16h26v16h60v-30h20l10-14 10 14h20v30h70v-20h24v20h60v-12h40v12h30v-26h16l12-20 12 20h16v26h80v-18h30v18h50v-34h14l16-22 16 22h14v34h60v-14h40v14h60v-28h22v28h90v-20h34v20h56v-42l14-16 14 16v42h50v40z"/>';

/** Sri Rama at full draw, facing right. */
export const DS_RAMA = '<g fill="url(#ds-hero)"><path d="M246 204c-6 14-10 26-14 34l10 2c4-10 8-20 10-30z"/><circle cx="258" cy="206" r="15"/><path d="M271 201l7 7-7 3z"/><path d="M243 192h30v-6h-30z"/><path d="M245 187c2-14 6-26 13-37 7 11 11 23 13 37z"/><circle cx="258" cy="148" r="3.6"/><path d="M249 218h14v12h-14z"/><path d="M226 230c10-6 50-6 60 0l-6 72h-46z"/><path d="M232 298h50l18 40-24 6-22-28-16 30-26-8z"/><path d="M276 330l46 50 8 86h-16l-12-74-34-30z"/><path d="M240 328l-34 62-30 76h18l34-70 30-50z"/><path d="M314 462h28v8h-30zM172 462h28v8h-30z"/><path d="M278 232l92 2" stroke="url(#ds-hero)" stroke-width="13" stroke-linecap="round" fill="none"/><path d="M236 236l-30-14 66 4" stroke="url(#ds-hero)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M350 112q56 122 0 244" stroke="url(#ds-hero)" stroke-width="7" stroke-linecap="round" fill="none"/></g>';

/** His angavastram, streaming behind the shoulder (sways). */
export const DS_SCARF = '<path fill="url(#ds-hero)" opacity=".8" d="M236 238c-30 6-52 24-74 52-14 18-30 30-50 34 22 6 44-2 60-18 18-18 32-36 64-46z"/>';

/** The bowstring drawn to the cheek, and at rest after the release. */
export const DS_STRING_DRAWN = '<path class="ds-string" d="M350 112L272 226L350 356"/>';
export const DS_STRING_REST = '<path class="ds-string" d="M350 112L350 356"/>';

/** The arrow, nocked at the string; the layer carries it to the target. */
export const DS_ARROW = '<path class="ds-shaft" d="M272 226l148 6"/><path class="ds-head" d="M432 233l-16-9 2 18z"/><path class="ds-fletch" d="M272 226l-12-8M272 226l-12 8M280 226l-12-8M280 226l-12 8"/>';

/** Ravanasura: ten heads, sword and mace. */
export const DS_RAVANA = '<g><g fill="url(#ds-foe)"><g><circle cx="940" cy="158" r="21"/><path d="M921 146h38l-6 -10l-8 4l-6 -15l-6 15l-8 -4z"/><circle cx="900" cy="164" r="19"/><path d="M883 154h34l-5 -10l-7 4l-5 -13l-5 13l-7 -4z"/><circle cx="862" cy="170" r="17"/><path d="M847 161h31l-5 -8l-6 3l-5 -12l-5 12l-6 -3z"/><circle cx="826" cy="176" r="15"/><path d="M812 168h27l-4 -8l-5 3l-4 -10l-4 10l-5 -3z"/><circle cx="1020" cy="158" r="21"/><path d="M1001 146h38l-6 -10l-8 4l-6 -15l-6 15l-8 -4z"/><circle cx="1060" cy="164" r="19"/><path d="M1043 154h34l-5 -10l-7 4l-5 -13l-5 13l-7 -4z"/><circle cx="1098" cy="170" r="17"/><path d="M1083 161h31l-5 -8l-6 3l-5 -12l-5 12l-6 -3z"/><circle cx="1134" cy="176" r="15"/><path d="M1120 168h27l-4 -8l-5 3l-4 -10l-4 10l-5 -3z"/><circle cx="1167" cy="182" r="13"/><path d="M1155 175h23l-4 -6l-5 3l-4 -9l-4 9l-5 -3z"/></g><circle cx="980" cy="152" r="28"/><path d="M954 140l6-40 10 18 10-34 10 34 10-18 6 40z"/><path transform="translate(-20 0)" d="M940 190c20-14 100-14 120 0l40 14-8 26-36-8-6 112h-100l-6-112-36 8-8-26z"/><path transform="translate(-20 0)" d="M948 330h104l32 96h-168z"/><path transform="translate(-20 0)" d="M948 420h34v48h-34zM1018 420h34v48h-34z"/><path transform="translate(-20 0)" d="M936 462h52v8h-56zM1014 462h52v8h-56z"/><path transform="translate(-20 0)" d="M912 206l-48-30-14-56" stroke="url(#ds-foe)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path transform="translate(-20 0)" d="M842 124l-58-82 8-6 62 76z"/><path transform="translate(-20 0)" d="M832 112h28v8h-28z"/><path transform="translate(-20 0)" d="M1088 206l50 44-6 74" stroke="url(#ds-foe)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path transform="translate(-20 0)" d="M1128 318h8v70h-8z"/><circle cx="1112" cy="398" r="22"/></g><g class="ds-eyes" opacity=".85"><circle cx="933" cy="158" r="2.3"/><circle cx="947" cy="158" r="2.3"/><circle cx="894" cy="164" r="2.1"/><circle cx="906" cy="164" r="2.1"/><circle cx="857" cy="170" r="1.9"/><circle cx="867" cy="170" r="1.9"/><circle cx="821" cy="176" r="1.6"/><circle cx="831" cy="176" r="1.6"/><circle cx="1013" cy="158" r="2.3"/><circle cx="1027" cy="158" r="2.3"/><circle cx="1054" cy="164" r="2.1"/><circle cx="1066" cy="164" r="2.1"/><circle cx="1093" cy="170" r="1.9"/><circle cx="1103" cy="170" r="1.9"/><circle cx="1129" cy="176" r="1.6"/><circle cx="1139" cy="176" r="1.6"/><circle cx="1163" cy="182" r="1.6"/><circle cx="1171" cy="182" r="1.6"/></g><path d="M940 200q40 34 80 0" class="ds-gold" stroke-width="4" fill="none" opacity=".8"/><ellipse cx="970" cy="152" rx="5" ry="3" class="ds-eyes"/><ellipse cx="990" cy="152" rx="5" ry="3" class="ds-eyes"/></g>';

/** One Jammi (shami) sprig: a stem with paired leaflets. */
export const DS_JAMMI = '<path class="ds-stem" d="M12 30V4"/><g class="ds-leaflet"><ellipse cx="7" cy="25" rx="5" ry="2.1" transform="rotate(-30 7 25)"/><ellipse cx="17" cy="25" rx="5" ry="2.1" transform="rotate(30 17 25)"/><ellipse cx="7.5" cy="19" rx="4.6" ry="2" transform="rotate(-30 7.5 19)"/><ellipse cx="16.5" cy="19" rx="4.6" ry="2" transform="rotate(30 16.5 19)"/><ellipse cx="8" cy="13" rx="4.2" ry="1.9" transform="rotate(-30 8 13)"/><ellipse cx="16" cy="13" rx="4.2" ry="1.9" transform="rotate(30 16 13)"/><ellipse cx="9" cy="7.5" rx="3.6" ry="1.7" transform="rotate(-30 9 7.5)"/><ellipse cx="15" cy="7.5" rx="3.6" ry="1.7" transform="rotate(30 15 7.5)"/><ellipse cx="12" cy="3" rx="1.8" ry="3"/></g>';
