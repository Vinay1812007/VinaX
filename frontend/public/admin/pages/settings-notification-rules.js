/* App Settings › Notification Rules — how often people may get a
   notification, quiet hours, and which kinds may be sent. Stored key: push
   { minGapHours, quiet: { enabled, start, end }, types: { releases, recommendations, announcements, reminders } }.
   The push sender enforces it. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui;

  var GAPS = [{ value: '6', label: '1 every 6 hours' }, { value: '12', label: '1 every 12 hours' }, { value: '24', label: '1 a day' }, { value: '48', label: '1 every 2 days' }];
  var GAP_NAME = { 6: '1 every 6 hours', 12: '1 every 12 hours', 24: '1 a day', 48: '1 every 2 days' };
  var TYPES = [
    { key: 'releases', title: 'New releases', desc: 'New songs and albums from artists people like.' },
    { key: 'recommendations', title: 'Recommendations', desc: 'Songs and playlists picked for each person.' },
    { key: 'announcements', title: 'Announcements', desc: 'News from the VinaX team, like new features.' },
    { key: 'reminders', title: 'Reminders', desc: 'Gentle nudges for people who have not listened in a while.' }
  ];
  var hm = function (v, d) {
    if (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)) return v;
    if (typeof v === 'number' && v >= 0 && v < 24) return (v < 10 ? '0' : '') + Math.floor(v) + ':00';
    return d;
  };
  var nice = function (t) {
    var p = /^(\d{2}):(\d{2})$/.exec(t || '');
    if (!p) return t || '';
    var hr = Number(p[1]), am = hr < 12, h12 = hr % 12 || 12;
    return h12 + (p[2] !== '00' ? ':' + p[2] : '') + (am ? ' am' : ' pm');
  };

  var rules = {
    key: 'push', title: 'Notification Rules',
    desc: 'Limits that protect people from too many notifications. They apply to everything sent from Send Notification and to automatic ones.',
    fromValue: function (v) {
      var r = VX.obj(v);
      var gap = Number(r.minGapHours);
      var q = VX.obj(r.quiet);
      var legacyQuiet = typeof r.quietStart === 'number' && typeof r.quietEnd === 'number';
      var t = VX.obj(r.types);
      var types = {};
      TYPES.forEach(function (x) { types[x.key] = t[x.key] !== false; });
      return {
        minGapHours: GAP_NAME[gap] ? gap : 24,
        quiet: {
          enabled: q.enabled != null ? !!q.enabled : legacyQuiet,
          start: hm(q.start != null ? q.start : r.quietStart, '22:00'),
          end: hm(q.end != null ? q.end : r.quietEnd, '08:00')
        },
        types: types,
        _new: !v
      };
    },
    toValue: function (m) {
      if (m._new) return null;
      return { minGapHours: m.minGapHours, quiet: { enabled: !!m.quiet.enabled, start: m.quiet.start, end: m.quiet.end }, types: m.types };
    },
    validate: function (m) {
      if (m.quiet.enabled && m.quiet.start === m.quiet.end) return 'Quiet hours need different start and end times.';
      return null;
    },
    describe: function (v) {
      if (!v) return 'No limits';
      var m = rules.fromValue(v);
      var off = TYPES.filter(function (x) { return !m.types[x.key]; }).map(function (x) { return x.title.toLowerCase(); });
      return 'At most ' + (GAP_NAME[m.minGapHours] || '1 a day').toLowerCase() +
        (m.quiet.enabled ? ', quiet ' + nice(m.quiet.start) + '–' + nice(m.quiet.end) : ', no quiet hours') +
        (off.length ? ', no ' + off.join(', ') : '');
    },
    render: function (m, set, api) {
      // Editing anything turns the built-in "no limits" into the owner's rules.
      var touch = function () { m._new = false; set(m); };
      var quietTimes = h('div.form-row.b-two',
        ui.timePicker('Quiet from', m.quiet.start, function (v) { m.quiet.start = v || '22:00'; touch(); }),
        ui.timePicker('Quiet until', m.quiet.end, function (v) { m.quiet.end = v || '08:00'; touch(); }));
      quietTimes.hidden = !m.quiet.enabled;
      return [
        api.stored === null ? ui.notice('Right now no limits apply. Choose your rules and press Save & apply.', 'info') : null,
        ui.dropdown('Max notifications per person', GAPS, String(m.minGapHours), function (v) { m.minGapHours = Number(v); touch(); }),
        h('div',
          ui.switchRow('Quiet hours', 'Nothing is sent during these hours (India time). Notifications wait until quiet hours end.', m.quiet.enabled, function (on) { m.quiet.enabled = on; quietTimes.hidden = !on; touch(); }),
          quietTimes),
        h('div',
          ui.heading('Kinds of notification', 'Switch a kind off to stop sending it to everyone. Messages you send by hand on Send Notification count as announcements.'),
          TYPES.map(function (x) {
            return ui.switchRow(x.title, x.desc, m.types[x.key], function (on) { m.types[x.key] = on; touch(); });
          }))
      ];
    },
    preview: function (m) {
      var on = TYPES.filter(function (x) { return m.types[x.key]; });
      return h('div.b-rules',
        h('div.b-rule', h('span.b-rule-k', 'Most per person'), h('strong', GAP_NAME[m.minGapHours])),
        h('div.b-rule', h('span.b-rule-k', 'Quiet hours'), h('strong', m.quiet.enabled ? nice(m.quiet.start) + ' – ' + nice(m.quiet.end) + ' ' + VX.tzShort() : 'Off')),
        h('div.b-rule', h('span.b-rule-k', 'Allowed'), h('strong', on.length ? on.map(function (x) { return x.title; }).join(', ') : 'Nothing')));
    }
  };

  VX.settingsPage({
    id: 'app-settings/notification-rules', title: 'Notification Rules', icon: 'bell', order: 5,
    desc: 'How often people may get a notification, when not to send, and which kinds are allowed.',
    sections: [rules]
  });
})();
