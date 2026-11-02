/* App Settings › Data & Privacy — how long each kind of data is kept.
   Stored key: retention { eventsDays, errorsDays, feedbackDays, notificationsDays }.
   The hourly housekeeping job deletes anything older (backend _lib/jobs.ts).
   "Forever" is stored as 3650 days (ten years, the job's longest period). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui;

  var FOREVER = 3650;
  var KEEP = [{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '180 days' }, { value: '365', label: '365 days' }, { value: String(FOREVER), label: 'Forever' }];
  var KINDS = [
    { key: 'eventsDays', title: 'Play history', desc: 'What people played, searched and liked. Song Stats and Users read it.' },
    { key: 'errorsDays', title: 'Error reports', desc: 'Problems the app reported. App Health reads them.' },
    { key: 'feedbackDays', title: 'Feedback', desc: 'Messages people sent from Settings → Feedback.' },
    { key: 'notificationsDays', title: 'Notification logs', desc: 'The record of notifications sent, with how many were delivered and opened.' }
  ];
  var BUILT_IN = { eventsDays: 180, feedbackDays: FOREVER, notificationsDays: FOREVER };
  var snap = function (n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return FOREVER;
    var opts = [30, 90, 180, 365, FOREVER];
    return opts.reduce(function (best, o) { return Math.abs(o - n) < Math.abs(best - n) ? o : best; }, 180);
  };
  var label = function (n) { return n >= FOREVER ? 'forever' : n + ' days'; };

  var retention = {
    key: 'retention', title: 'How long data is kept',
    desc: 'Deleted data cannot be brought back.',
    fromValue: function (v) {
      var r = VX.obj(v);
      var m = {};
      m.eventsDays = r.eventsDays != null ? snap(r.eventsDays) : BUILT_IN.eventsDays;
      // Before a separate period existed, error reports were kept as long as play history.
      m.errorsDays = r.errorsDays != null ? snap(r.errorsDays) : m.eventsDays;
      m.feedbackDays = r.feedbackDays != null ? snap(r.feedbackDays) : BUILT_IN.feedbackDays;
      m.notificationsDays = r.notificationsDays != null ? snap(r.notificationsDays) : BUILT_IN.notificationsDays;
      m._new = !v;
      return m;
    },
    toValue: function (m) {
      if (m._new) return null;
      return { eventsDays: m.eventsDays, errorsDays: m.errorsDays, feedbackDays: m.feedbackDays, notificationsDays: m.notificationsDays };
    },
    describe: function (v) {
      if (!v) return 'Built-in: play history 180 days, everything else kept';
      var m = retention.fromValue(v);
      return KINDS.map(function (k) { return k.title + ' ' + label(m[k.key]); }).join(', ');
    },
    confirmSave: function (m, stored) {
      var before = retention.fromValue(stored);
      var shorter = KINDS.filter(function (k) { return m[k.key] < before[k.key]; });
      if (!shorter.length) return null;
      return {
        title: 'Delete older data?',
        body: 'Within the next hour, ' + shorter.map(function (k) { return k.title.toLowerCase() + ' older than ' + label(m[k.key]); }).join(', ') + ' will be deleted for good. Continue?',
        confirmLabel: 'Save & delete older data', danger: true
      };
    },
    render: function (m, set) {
      return [
        ui.notice('Older data is deleted automatically every hour. Choose “Forever” to keep everything.', 'info'),
        h('div.b-keep-list', KINDS.map(function (k) {
          return h('div.b-keep-row',
            h('div.switch-text', h('strong', k.title), h('p.muted', k.desc)),
            ui.dropdown('Keep for', KEEP, String(m[k.key]), function (v) { m[k.key] = Number(v); m._new = false; set(m); }));
        }))
      ];
    }
  };

  VX.settingsPage({
    id: 'app-settings/privacy', title: 'Data & Privacy', icon: 'lock', order: 8,
    desc: 'Choose how long VinaX keeps each kind of data before deleting it.',
    sections: [retention]
  });
})();
