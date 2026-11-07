/* VinaX console — the extras on a person's profile (schema 15).
 * GET /api/admin/listeners?account= answers them as `profile.extras`
 * (null before the database update); POST { action: 'notes' } saves the
 * owner's private tags and note. Used by pages/users.js:
 *   VX.userExtras.notes(u, extras, onSaved)  tags + note, with Edit
 *   VX.userExtras.hours(extras)               when in the day they listen
 *   VX.userExtras.skips(extras)               songs skipped / come back to
 *   VX.userExtras.searches(extras)            their latest searches
 *   VX.userExtras.tagChips(tags)              small chips for the Users list */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var API = '/api/admin/listeners';
  var TAG_RE = /^[a-z0-9][a-z0-9 _-]{0,23}$/;
  var MAX_TAGS = 12;
  var SUGGESTED = ['tester', 'friend', 'vip', 'family', 'creator'];
  var LATER = 'This appears after the database update to version 15.';
  var NOTES_INFO = 'Only people who can open this console see these. The app never shows them.';
  var HOUR_INFO = 'Listening time in each hour of the day over the last 30 days, India time, on all their devices. Counted like Listening time: each “still playing” signal or song played counts until the next one, at most 6 minutes.';
  var SKIP_INFO = 'The app counts a skip when they move on from a song early, after it started playing.';
  var BACK_INFO = 'Songs they played on the most different days: the ones they keep coming back to.';
  var SEARCH_INFO = 'The last 100 things they searched for in the app. “No results” means the search found no songs: a hint at music VinaX is missing.';

  function cleanTag(t) { return String(t || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function hourName(i) { return (i % 12 || 12) + (i < 12 ? ' am' : ' pm'); }

  /** Small tag chips (at most three, then "+n"). */
  function tagChips(tags) {
    tags = arr(tags);
    if (!tags.length) return null;
    return h('span.tag-chips', tags.slice(0, 3).map(function (t) { return ui.pill(t, 'info'); }), tags.length > 3 ? h('span.muted.small', '+' + (tags.length - 3)) : null);
  }

  /** The edit dialog: tags (type and press Enter, or pick a suggestion) and the note. */
  function editNotes(u, n, onSaved) {
    var tags = arr(n.tags).slice();
    var chipHost = h('div'), suggestHost = h('div.toolbar.tag-suggest');
    var input = ui.input({ placeholder: 'Add a tag and press Enter', maxlength: 24, 'aria-label': 'New tag' });
    var note = ui.textarea({ rows: 5, maxlength: 2000, placeholder: 'Anything you want to remember about ' + (u.name || 'this person') + '…' });
    note.value = n.note || '';
    function draw() {
      VX.mount(chipHost, ui.chips(tags.map(function (t) { return { id: t, label: t }; }), function (t) { tags = tags.filter(function (x) { return x !== t; }); draw(); }, { empty: 'No tags yet.' }));
      VX.mount(suggestHost, SUGGESTED.filter(function (t) { return tags.indexOf(t) < 0; }).map(function (t) {
        return ui.button('+ ' + t, { kind: 'ghost', small: true, onClick: function () { add(t); } });
      }));
    }
    function add(raw) {
      var t = cleanTag(raw);
      if (!t) return;
      if (!TAG_RE.test(t)) { VX.toast('A tag uses letters, numbers, spaces or dashes (up to 24).', 'bad'); return; }
      if (tags.indexOf(t) < 0) {
        if (tags.length >= MAX_TAGS) { VX.toast('Up to ' + MAX_TAGS + ' tags per person.', 'bad'); return; }
        tags.push(t);
      }
      input.value = '';
      draw();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
    });
    draw();
    VX.modal({
      title: 'Notes and tags for ' + (u.name || u.email || 'this person'),
      body: [
        h('p.muted.small', NOTES_INFO),
        ui.field('Tags', h('div.tag-editor', chipHost, input, suggestHost), 'For example tester, friend or VIP. You can filter All Users by tag.'),
        ui.field('Note', note, 'Up to 2000 characters.')
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Save', kind: 'primary', onClick: function (close) {
          if (input.value.trim()) add(input.value);
          return VX.api.post(API, { action: 'notes', account: u.id, tags: tags, note: note.value }).then(function (res) {
            VX.toast(res.ok ? 'Saved ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad');
            if (!res.ok) return;
            close();
            if (onSaved) onSaved(obj(obj(res.data).notes));
          });
        } }
      ]
    });
  }

  /** The owner's tags and note about this person, under the profile header. */
  function notes(u, extras, onSaved) {
    if (!extras) return h('div.profile-notes.is-later', h('span.muted.small', 'Private notes and tags: ' + LATER.charAt(0).toLowerCase() + LATER.slice(1)));
    var n = obj(extras.notes), tags = arr(n.tags);
    var box = h('div.profile-notes');
    function draw(cur) {
      n = cur; tags = arr(n.tags);
      VX.mount(box,
        h('div.profile-notes-head',
          h('strong', 'Your notes'), ui.info(NOTES_INFO, 'Your notes'),
          tags.length ? h('span.tag-chips', tags.map(function (t) { return ui.pill(t, 'info'); })) : null,
          h('span.grow'),
          VX.can('edit') ? ui.button(tags.length || n.note ? 'Edit' : 'Add a note or tag', { kind: 'ghost', small: true, icon: 'edit', onClick: function () { editNotes(u, n, function (saved) { draw(saved); if (onSaved) onSaved(saved); }); } }) : null),
        n.note ? h('p.profile-note', n.note) : (!tags.length ? h('p.muted.small', 'Nothing yet. Tag people as tester, friend or VIP, or write yourself a note.') : null),
        n.updatedAt ? h('p.muted.small', 'Last changed ', ui.ago(n.updatedAt), n.updatedBy ? ' by ' + n.updatedBy : '') : null);
    }
    draw(n);
    return box;
  }

  /** 24 bars: listening time in each India-time hour, last 30 days. */
  function hours(extras) {
    if (!extras) return null;
    var list = arr(extras.hours);
    if (list.length !== 24) return null;
    var mins = list.map(function (x) { return Math.round(num(x.seconds) / 60); });
    var peak = mins.indexOf(Math.max.apply(null, mins));
    var sub = mins[peak] ? 'Most often ' + hourName(peak) + '–' + hourName((peak + 1) % 24) + ' (' + VX.listenText(num(list[peak].seconds)) + ' in 30 days)' : null;
    return h('div.profile-hours',
      ui.heading('When they listen', HOUR_INFO),
      sub ? h('p.muted.small', sub) : null,
      ui.chart({ labels: list.map(function (x) { return hourName(num(x.hour)); }), series: [{ name: 'Listening', values: mins, color: 'var(--c2)' }],
        type: 'bar', height: 150, title: 'Minutes listened in each hour of the day', empty: 'No listening in the last 30 days',
        format: function (v) { v = Math.round(v); var hr = Math.floor(v / 60), m = v % 60; return !v ? '0' : hr ? hr + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm'; } }));
  }

  /** Skips & replays tab. */
  function skips(extras) {
    if (!extras) return ui.emptyState('Skips and replays', LATER);
    var skipped = arr(extras.topSkipped), back = arr(extras.topReplayed);
    return [
      ui.stats([
        { label: 'Songs skipped', value: fmt.num(extras.skips), info: SKIP_INFO + ' All the time we keep events for.' },
        { label: 'Songs they come back to', value: fmt.num(back.length), sub: back.length ? 'played on 2 or more days' : null, info: BACK_INFO }
      ]),
      h('div.grid.cols-2.profile-lists',
        h('div', ui.heading('Skipped most', SKIP_INFO), ui.hbars(skipped.map(function (x) { return { label: x.title, sub: x.artist, value: num(x.skips) }; }), { empty: 'No skips yet', limit: 10 })),
        h('div', ui.heading('Comes back to', BACK_INFO), ui.hbars(back.map(function (x) { return { label: x.title, sub: [x.artist, fmt.plural(x.plays, 'play')].filter(Boolean).join(' · '), value: num(x.days) }; }),
          { empty: 'No song played on two different days yet', limit: 10, format: function (v) { return fmt.plural(v, 'day'); } })))
    ];
  }

  /** Searches tab. */
  function searches(extras) {
    if (!extras) return ui.emptyState('Search history', LATER);
    var rows = arr(extras.searches);
    var misses = rows.filter(function (x) { return x.results === 0; }).length;
    return [
      h('p.muted.small', SEARCH_INFO, misses ? ' ' + fmt.plural(misses, 'search', 'searches') + ' here found nothing.' : ''),
      ui.dataTable({
        columns: [
          { key: 'at', label: 'When', nowrap: true, render: function (e) { return ui.ago(e.at); }, csv: function (e) { return fmt.full(e.at); } },
          { key: 'query', label: 'Search', render: function (e) { return e.query ? h('span', e.query) : h('span.muted', '—'); } },
          { key: 'results', label: 'Songs found', align: 'right', sortVal: function (e) { return e.results == null ? -1 : e.results; },
            render: function (e) { return e.results === 0 ? ui.pill('No results', 'warn') : e.results == null ? h('span.muted', '—') : fmt.num(e.results); },
            csv: function (e) { return e.results == null ? '' : String(e.results); } },
          { key: 'platform', label: 'Device', render: function (e) { return VX.platformName(e.platform); } }
        ],
        rows: rows, exportName: 'vinax-searches', search: rows.length > 10 ? 'Search their searches…' : false, pageSize: 25, sortKey: 'at',
        empty: { title: 'No searches yet', hint: 'What they search for in the app shows up here.' }
      })
    ];
  }

  VX.userExtras = { notes: notes, hours: hours, skips: skips, searches: searches, tagChips: tagChips };
})();
