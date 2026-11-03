/* App Settings › Maintenance — site mode, a planned maintenance time and the
   status page note. Stored keys: site-mode, maintenance-window, status-note. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, st = VX.st;

  var MODES = [
    { value: 'live', label: 'Normal', hint: 'Everything works as usual.' },
    { value: 'readonly', label: 'Read-only', hint: 'People can listen, but can’t change anything: likes, playlists, profiles and feedback are not saved.' },
    { value: 'maintenance', label: 'Maintenance', hint: 'The app shows a maintenance screen to everyone. Nobody can listen until you switch back.' }
  ];
  var MODE_NAME = { live: 'Normal', readonly: 'Read-only', maintenance: 'Maintenance' };
  var WARN = [{ value: '15', label: '15 minutes before' }, { value: '60', label: '1 hour before' }, { value: '1440', label: '1 day before' }];
  var WARN_NAME = { 15: '15 minutes', 60: '1 hour', 1440: '1 day' };
  var LEVELS = [{ value: 'ok', label: 'All good' }, { value: 'minor', label: 'Minor issue' }, { value: 'major', label: 'Major outage' }];
  var LEVEL_NAME = { ok: 'All good', minor: 'Minor issue', major: 'Major outage' };

  var o = function (v) { return VX.obj(v); };
  var when = function (iso) { return iso ? fmt.full(iso) : '—'; };

  /* -------------------------------------------------------------- site mode */
  var siteMode = {
    key: 'site-mode', title: 'Site Mode',
    desc: 'Switch the whole app to read-only or show a maintenance screen.',
    fromValue: function (v) {
      var m = o(v);
      return { mode: MODE_NAME[m.mode] ? m.mode : 'live', note: typeof m.note === 'string' ? m.note : '' };
    },
    toValue: function (m) {
      // Normal is the app's built-in mode: saving it clears the setting.
      if (m.mode === 'live') return null;
      var out = { mode: m.mode };
      if (m.note && m.note.trim()) out.note = m.note.trim().slice(0, 200);
      return out;
    },
    describe: function (v) {
      var m = o(v);
      if (!v) return 'Normal';
      return (MODE_NAME[m.mode] || 'Normal') + (m.note && m.mode !== 'live' ? ': “' + m.note + '”' : '');
    },
    confirmSave: function (m, stored) {
      if (m.mode === 'maintenance' && o(stored).mode !== 'maintenance') {
        return { title: 'Turn on maintenance mode?', body: 'Everyone using VinaX will see the maintenance screen and cannot listen until you switch back to Normal.', typed: true, danger: true, confirmLabel: 'Turn on maintenance' };
      }
      if (m.mode === 'readonly' && o(stored).mode !== 'readonly') {
        return { title: 'Turn on read-only mode?', body: 'People can keep listening, but nothing they change is saved until you switch back to Normal. Users will see this within 1 minute.', confirmLabel: 'Turn on read-only' };
      }
      return null;
    },
    render: function (m, set, api) {
      var noteBox = h('div');
      function drawNote() {
        VX.mount(noteBox, m.mode === 'live' ? null : st.text(m, 'note', set, {
          label: 'Message people see (optional)', max: 200, multiline: true, rows: 2,
          placeholder: m.mode === 'maintenance' ? 'We’ll be back by 6 pm.' : 'Some changes are paused for a little while.'
        }));
      }
      drawNote();
      return [
        ui.radios('How should the app run?', MODES, m.mode, function (v) { m.mode = v; set(m); drawNote(); }, { cards: true }),
        noteBox
      ];
    },
    preview: function (m) {
      if (m.mode === 'maintenance') {
        return ui.phone([
          h('div.b-gate', h('div.b-gate-logo', 'V'), h('strong', 'We’ll be right back'),
            h('p', m.note && m.note.trim() ? m.note.trim() : 'VinaX is getting a quick tune-up. Your music, favorites and downloads are safe on your device.'))
        ]);
      }
      return ui.phone([
        m.mode === 'readonly' ? h('div.b-banner.warn', m.note && m.note.trim() ? m.note.trim() : 'VinaX is in read-only mode right now. You can keep listening; changes are not saved.') : null,
        h('div.b-home-title', 'Good evening'),
        h('div.b-tiles', h('span'), h('span'), h('span'), h('span'))
      ]);
    }
  };

  /* ---------------------------------------------------- planned maintenance */
  var windowSection = {
    key: 'maintenance-window', title: 'Scheduled Maintenance',
    desc: 'Plan a maintenance time. People are warned first, then see the maintenance screen until it ends.',
    fromValue: function (v) {
      var w = o(v);
      var wb = Number(w.warnBefore);
      return {
        enabled: v ? w.enabled !== false : false,
        start: typeof w.start === 'string' ? w.start : null,
        end: typeof w.end === 'string' ? w.end : null,
        note: typeof w.note === 'string' ? w.note : '',
        warnBefore: WARN_NAME[wb] ? wb : 60
      };
    },
    toValue: function (m) {
      if (!m.enabled && !m.start && !m.end && !m.note) return null;
      var out = { enabled: !!m.enabled, start: m.start, end: m.end, warnBefore: m.warnBefore };
      if (m.note && m.note.trim()) out.note = m.note.trim().slice(0, 200);
      return out;
    },
    validate: function (m) {
      if (!m.enabled) return null;
      if (!m.start || !m.end) return 'Choose when the maintenance starts and ends.';
      if (Date.parse(m.end) <= Date.parse(m.start)) return 'The end must be after the start.';
      if (Date.parse(m.end) < Date.now()) return 'That time has already passed. Choose a time in the future.';
      return null;
    },
    describe: function (v) {
      if (!v) return 'No maintenance planned';
      var w = o(v);
      if (w.enabled === false) return 'Planned maintenance switched off';
      var wb = WARN_NAME[Number(w.warnBefore)] || '1 hour';
      return when(w.start) + ' to ' + when(w.end) + ', warn ' + wb + ' before';
    },
    render: function (m, set) {
      var summary = h('p.muted.small');
      function sum() {
        if (!m.start || !m.end || Date.parse(m.end) <= Date.parse(m.start)) { summary.textContent = ''; return; }
        var mins = Math.round((Date.parse(m.end) - Date.parse(m.start)) / 60000);
        summary.textContent = 'Lasts ' + fmt.dur(mins * 60) + '. Starts ' + fmt.ago(m.start) + '.';
      }
      sum();
      return [
        st.toggle(m, 'enabled', set, 'Planned maintenance is on', 'When this is on, the app warns people and then shows the maintenance screen at the time below.'),
        h('div.form-row.b-two',
          ui.dateTimePicker('Starts', m.start, function (v) { m.start = v; set(m); sum(); }),
          ui.dateTimePicker('Ends', m.end, function (v) { m.end = v; set(m); sum(); })),
        summary,
        ui.dropdown('Warn users before', WARN, String(m.warnBefore), function (v) { m.warnBefore = Number(v); set(m); }),
        st.text(m, 'note', set, { label: 'Message to users (optional)', max: 200, multiline: true, rows: 2, placeholder: 'New features are on the way. Back in about an hour.' })
      ];
    },
    preview: function (m) {
      var at = m.start ? fmt.dateTime(m.start) + ' ' + VX.tzShort() : 'the planned time';
      return ui.phone([
        m.enabled ? h('div.b-banner.info', 'VinaX goes into maintenance at ' + at + '. ' + (m.note && m.note.trim() ? m.note.trim() : 'Music may stop for a little while.')) : h('p.b-muted', 'No warning is shown while this is off.'),
        h('div.b-home-title', 'Good evening'),
        h('div.b-tiles', h('span'), h('span'), h('span'), h('span'))
      ]);
    }
  };

  /* ------------------------------------------------------------ status note */
  var statusNote = {
    key: 'status-note', title: 'Status Page Note',
    desc: 'A message at the top of the public status page (status.vinaxmusic.online).',
    fromValue: function (v) {
      var n = o(v);
      return { enabled: v ? n.enabled !== false : true, text: typeof n.text === 'string' ? n.text : '', level: LEVEL_NAME[n.level] ? n.level : 'minor' };
    },
    toValue: function (m) {
      if (!m.text.trim()) return null;
      return { enabled: !!m.enabled, text: m.text.trim().slice(0, 500), level: m.level };
    },
    validate: function () { return null; },
    describe: function (v) {
      if (!v) return 'No note';
      var n = o(v);
      if (n.enabled === false) return 'Note switched off';
      return (LEVEL_NAME[n.level] || 'Note') + ': “' + fmt.trunc(n.text || '', 80) + '”';
    },
    render: function (m, set) {
      return [
        st.toggle(m, 'enabled', set, 'Show the note', 'Off hides the note without deleting the text.'),
        ui.dropdown('Level', LEVELS, m.level, function (v) { m.level = v; set(m); }),
        st.text(m, 'text', set, { label: 'Message', max: 500, multiline: true, rows: 3, placeholder: 'Search is slow this evening. We are on it.' })
      ];
    },
    preview: function (m) {
      return h('div.b-status',
        h('div.b-status-head', 'VinaX status'),
        m.enabled && m.text.trim() ? h('div.b-status-note.' + m.level, h('strong', LEVEL_NAME[m.level] + ' — '), m.text.trim()) : h('p.b-muted', 'No note is shown.'),
        h('div.b-status-ok', 'All Systems Operational'));
    }
  };

  VX.settingsPage({
    id: 'app-settings/maintenance', title: 'Maintenance', icon: 'wrench', order: 4,
    desc: 'Pause changes, show a maintenance screen, plan downtime, and post a note on the status page.',
    sections: [siteMode, windowSection, statusNote]
  });
})();
