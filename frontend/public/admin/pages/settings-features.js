/* App Settings › Features & AI — feature switches, VinaX AI (who may use it,
 * models, limits, instructions), recommendations and music AI.
 * Stored shapes and who reads them: docs/admin-console.md → "Features & AI". */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, st = VX.st;
  var arr = VX.arr, obj = VX.obj;

  /* ---------------------------------------------------------- feature switches */

  /** Flags the app actually reads (useAppConfig flagOn). Add one here only with the app code that reads it. */
  var FLAGS = [
    { key: 'listenTogether', title: 'Listen Together', desc: 'Lets friends listen to the same song at the same time. Off hides it in the app.' }
  ];
  var flagsSection = {
    key: 'flags', title: 'Feature Switches',
    desc: 'Turn parts of the app on or off for everyone. Changes reach people within 1 minute.',
    fromValue: function (v) { var o = obj(v); var m = { other: {} }; Object.keys(o).forEach(function (k) { m.other[k] = o[k]; }); FLAGS.forEach(function (f) { m[f.key] = o[f.key] !== false; delete m.other[f.key]; }); return m; },
    toValue: function (m) {
      var o = st.clone(m.other);
      FLAGS.forEach(function (f) { if (!m[f.key]) o[f.key] = false; });
      return Object.keys(o).length ? o : null;
    },
    describe: function (v) {
      var o = obj(v);
      var off = FLAGS.filter(function (f) { return o[f.key] === false; }).map(function (f) { return f.title; });
      return off.length ? 'Off: ' + off.join(', ') : 'Every feature on';
    },
    render: function (m, set) {
      return h('div', FLAGS.map(function (f) { return st.toggle(m, f.key, set, f.title, f.desc); }));
    }
  };

  /* ---------------------------------------------------------- VinaX AI */

  var LIMIT_CHOICES = [{ value: '10', label: '10 a day' }, { value: '25', label: '25 a day' }, { value: '50', label: '50 a day' }, { value: '100', label: '100 a day' }, { value: '', label: 'Unlimited' }];
  /** The limits vinax-71's server change reads (missing = the default shown here). */
  var LIMITS = [
    { key: 'messagesPerMinute', label: 'Messages per minute (per person)', min: 1, max: 30, def: 20, unit: '' },
    { key: 'imagesPerMessage', label: 'Pictures per message', min: 1, max: 20, def: 10, unit: '' },
    { key: 'filesPerMessage', label: 'Files per message', min: 1, max: 20, def: 20, unit: '' },
    { key: 'filesPerChat', label: 'Files per chat', min: 1, max: 100, def: 50, unit: '' },
    { key: 'pdfMB', label: 'Largest PDF', min: 1, max: 50, def: 30, unit: ' MB' },
    { key: 'pdfPages', label: 'Most PDF pages', min: 1, max: 1000, def: 500, unit: ' pages', step: 10 },
    { key: 'textMB', label: 'Largest text file', min: 1, max: 5, def: 2, unit: ' MB' }
  ];
  var SEARCH_CHOICES = [{ value: '', label: 'Server default (100 a day)' }, { value: '0', label: 'Web search off' }, { value: '50', label: '50 a day' }, { value: '100', label: '100 a day' }, { value: '250', label: '250 a day' }, { value: '500', label: '500 a day' }, { value: '1000', label: '1,000 a day' }, { value: '2000', label: '2,000 a day' }];

  var models = null; // the model list from /api/admin/ai, loaded once per page
  function loadModels() {
    if (!models) models = VX.api.get('/api/admin/ai', null, { fresh: true }).then(function (res) { return res.ok ? arr(obj(res.data).models) : null; });
    return models;
  }
  var people = {}; // account id → { name, email, picture }
  function loadPeople(ids) {
    var need = ids.filter(function (id) { return !people[id]; });
    if (!need.length) return Promise.resolve();
    return VX.api.get('/api/admin/listeners', { ids: need.join(','), limit: 50 }).then(function (res) {
      VX.arr(res.data && res.data.rows).forEach(function (r) { var id = r.id || r.accountId; if (id) people[id] = { name: r.name, email: r.email, picture: r.picture }; });
    });
  }

  var aiSection = {
    key: 'vinax-ai', title: 'VinaX AI Assistant', wide: true,
    desc: 'Who can use the VinaX AI chat, which AI models answer, and the limits for each person.',
    fromValue: function (v) {
      v = obj(v);
      var lim = obj(v.limits);
      var limits = {};
      LIMITS.forEach(function (l) { limits[l.key] = typeof lim[l.key] === 'number' ? lim[l.key] : l.def; });
      var extra = {};
      Object.keys(v).forEach(function (k) { if (['enabled', 'testers', 'search', 'models', 'dailyLimit', 'instructions', 'limits'].indexOf(k) < 0) extra[k] = v[k]; });
      return {
        enabled: v.enabled === true, testers: arr(v.testers).slice(0, 50), search: v.search !== false, models: obj(v.models),
        dailyLimit: typeof v.dailyLimit === 'number' ? String(v.dailyLimit) : '',
        instructions: typeof v.instructions === 'string' ? v.instructions : '',
        limits: limits, searchesPerDay: lim.searchesPerDay == null ? '' : String(lim.searchesPerDay),
        extra: extra
      };
    },
    toValue: function (m) {
      var o = st.clone(m.extra);
      o.enabled = m.enabled;
      o.testers = m.testers.slice();
      o.search = m.search;
      if (Object.keys(m.models).length) o.models = st.clone(m.models);
      if (m.dailyLimit) o.dailyLimit = Number(m.dailyLimit);
      if (m.instructions.trim()) o.instructions = m.instructions.trim().slice(0, 4000);
      var lim = {};
      LIMITS.forEach(function (l) { if (m.limits[l.key] !== l.def) lim[l.key] = m.limits[l.key]; });
      if (m.searchesPerDay !== '') lim.searchesPerDay = Number(m.searchesPerDay);
      if (Object.keys(lim).length) o.limits = lim;
      // Never changed and closed: the same as the built-in setting.
      if (!o.enabled && !o.testers.length && o.search && Object.keys(o).length === 3) return null;
      return o;
    },
    describe: function (v) {
      v = obj(v);
      var parts = [v.enabled ? 'Open to everyone signed in' : 'Closed' + (arr(v.testers).length ? ' except ' + fmt.plural(arr(v.testers).length, 'tester') : '')];
      if (v.search === false) parts.push('web search off');
      if (typeof v.dailyLimit === 'number') parts.push(v.dailyLimit + ' messages a day each');
      var off = Object.keys(obj(v.models)).filter(function (k) { return obj(v.models[k]).enabled === false; }).length;
      if (off) parts.push(fmt.plural(off, 'model') + ' off');
      if (v.instructions) parts.push('with instructions');
      return parts.join(', ');
    },
    render: function (m, set, api) {
      var testersHost = h('div');
      function drawTesters() {
        VX.mount(testersHost,
          ui.chips(m.testers.map(function (id) { var p = people[id] || {}; return { id: id, label: p.name || p.email || 'Signed-in user', sub: p.name ? p.email : null, img: p.picture || null }; }),
            api.readOnly ? null : function (id) { m.testers = m.testers.filter(function (x) { return x !== id; }); set(m); drawTesters(); }, { empty: 'No testers yet.' }),
          api.readOnly || m.testers.length >= 50 ? (m.testers.length >= 50 ? h('p.muted.small', 'That is the most testers (50).') : null) : ui.userPicker({ label: 'Add a tester', onPick: function (u) {
            if (m.testers.indexOf(u.id) >= 0) { VX.toast((u.name || u.email) + ' is already a tester.', 'ok'); return; }
            people[u.id] = { name: u.name, email: u.email, picture: u.picture };
            m.testers.push(u.id); set(m); drawTesters();
          } }));
      }
      drawTesters();
      if (m.testers.length) loadPeople(m.testers).then(drawTesters);

      var modelsHost = h('div', ui.skeleton(3));
      loadModels().then(function (list) {
        if (!list) { VX.mount(modelsHost, ui.notice('The model list could not load. Model switches stay as they are.', 'warn')); return; }
        if (!list.length) { VX.mount(modelsHost, h('p.muted', 'No AI models are set up on the server.')); return; }
        var ranked = list.map(function (md, i) { var o = obj(m.models[md.id]); return { md: md, i: i, order: typeof o.order === 'number' ? o.order : i }; })
          .sort(function (a, b) { return a.order - b.order || a.i - b.i; }).map(function (x) { return x.md; });
        VX.mount(modelsHost,
          h('p.muted.small', 'Top = tried first. Drag to change the order; a model switched off is never used.'),
          ui.sortable({
            items: ranked, label: 'AI models, drag to reorder', disabled: api.readOnly,
            name: function (md) { return md.name; },
            onChange: function (items) {
              items.forEach(function (md, i) { var o = obj(m.models[md.id]); o.order = i; m.models[md.id] = o; });
              set(m);
            },
            render: function (md) {
              var o = obj(m.models[md.id]);
              return h('div.model-row',
                h('div', h('strong', md.name), h('span.muted.small', [md.provider, md.group ? null : 'used by Auto only', md.configured === false ? 'needs an API key' : null].filter(Boolean).join(' · '))),
                ui.toggle('', o.enabled !== false, function (on) { var x = obj(m.models[md.id]); if (on) delete x.enabled; else x.enabled = false; m.models[md.id] = x; if (!Object.keys(x).length) delete m.models[md.id]; set(m); }, { 'aria-label': 'Use ' + md.name, disabled: api.readOnly }));
            }
          }));
      });

      var limitsHost = h('div.limit-grid', LIMITS.map(function (l) {
        return ui.slider({ label: l.label, min: l.min, max: l.max, step: l.step || 1, value: m.limits[l.key], disabled: api.readOnly,
          format: function (v) { return fmt.num(v) + l.unit + (v === l.def ? ' (built-in)' : ''); },
          onChange: function (v) { m.limits[l.key] = v; set(m); } });
      }));

      var counter = h('span.counter.muted.small', m.instructions.length + ' / 4000');
      var instr = ui.textarea({ rows: 5, maxlength: 4000, placeholder: 'e.g. Keep answers short and friendly. Suggest Telugu songs first.' });
      instr.value = m.instructions;
      instr.addEventListener('input', function () { m.instructions = instr.value; counter.textContent = instr.value.length + ' / 4000'; set(m); });

      return h('div.form-col',
        ui.switchRow('Open to all signed-in users', 'Off keeps VinaX AI closed to everyone except the testers below.', m.enabled, function (on) { m.enabled = on; set(m); }),
        h('div', ui.heading('Testers', 'People who can use VinaX AI while it is closed to everyone else. Up to 50.'), testersHost),
        ui.switchRow('Allow web search', 'Lets VinaX AI look things up on the web for fresh answers.', m.search, function (on) { m.search = on; set(m); }),
        h('div', ui.heading('AI models', 'Which AI services answer, in the order they are tried.'), modelsHost),
        h('div', ui.heading('Limits', 'How much each person can use. Missing values use the built-in amount.'),
          h('div.form-row', ui.dropdown('Daily message limit per user', LIMIT_CHOICES, m.dailyLimit, function (v) { m.dailyLimit = v; set(m); }),
            ui.dropdown('Web searches a day (everyone together)', SEARCH_CHOICES, m.searchesPerDay, function (v) { m.searchesPerDay = v; set(m); })),
          limitsHost),
        ui.field('Instructions for every VinaX AI model', instr, h('span', 'Added to every reply’s instructions, after VinaX AI’s own; they can shape tone and behaviour but don’t override its safety rules. ', counter)));
    }
  };

  /* ---------------------------------------------------------- recommendations */

  var WEIGHTS = [
    { key: 'tasteFit', def: 0.3, label: 'Match each person’s taste', hint: 'How much picks follow what the person already likes.' },
    { key: 'novelty', def: 0.1, label: 'Mix of new vs familiar songs', hint: 'More = more songs they have not heard yet.' },
    { key: 'freshness', def: 0.05, label: 'New releases', hint: 'More = newer songs come up more often.' },
    { key: 'language', def: 0.14, label: 'Stay in their languages', hint: 'Less = more language variety.' },
    { key: 'artist', def: 0.22, label: 'Favourite artists', hint: 'More = more songs by artists they play a lot.' },
    { key: 'colisten', def: 0.14, label: 'Songs people play together', hint: 'More = songs often played after one another.' },
    { key: 'community', def: 0.04, label: 'Popular with everyone', hint: 'More = what is popular across VinaX.' },
    { key: 'hour', def: 0.06, label: 'Time of day', hint: 'More = picks follow what they play at this hour.' },
    { key: 'skips', def: 0.2, label: 'Avoid songs they skip', hint: 'More = songs they skipped come back less.' },
    { key: 'exposure', def: 1, label: 'Avoid repeating songs', hint: 'More = a song shown recently waits longer.' }
  ];
  var factorText = function (f) { return f === 1 ? 'Built-in' : f < 1 ? (f <= 0.6 ? 'Much less' : 'Less') + ' (' + f.toFixed(1) + '×)' : (f >= 1.7 ? 'Much more' : 'More') + ' (' + f.toFixed(1) + '×)'; };
  var personalSection = {
    key: 'personal-config', title: 'Recommendations',
    desc: 'How VinaX picks songs for each signed-in person. Each slider can go from half to double the built-in amount.',
    fromValue: function (v) {
      v = obj(v);
      var w = obj(v.weights), f = {};
      WEIGHTS.forEach(function (x) { f[x.key] = typeof w[x.key] === 'number' ? Math.round(Math.min(2, Math.max(0.5, w[x.key] / x.def)) * 10) / 10 : 1; });
      var rest = {};
      Object.keys(w).forEach(function (k) { if (!WEIGHTS.some(function (x) { return x.key === k; })) rest[k] = w[k]; });
      return { enabled: v.enabled !== false, composer: v.composer !== false, embedModel: v.embedModel || '', factors: f, otherWeights: rest };
    },
    toValue: function (m) {
      var weights = st.clone(m.otherWeights);
      WEIGHTS.forEach(function (x) { if (m.factors[x.key] !== 1) weights[x.key] = Math.round(x.def * m.factors[x.key] * 10000) / 10000; });
      var o = {};
      if (!m.enabled) o.enabled = false;
      if (!m.composer) o.composer = false;
      if (m.embedModel) o.embedModel = m.embedModel;
      if (Object.keys(weights).length) o.weights = weights;
      return Object.keys(o).length ? o : null;
    },
    describe: function (v) {
      v = obj(v);
      if (v.enabled === false) return 'Recommendations off (the app uses its own picks)';
      var changed = WEIGHTS.filter(function (x) { return typeof obj(v.weights)[x.key] === 'number'; }).map(function (x) { return x.label.toLowerCase(); });
      return changed.length ? 'Changed: ' + changed.join(', ') : 'Built-in mix';
    },
    render: function (m, set) {
      return h('div.form-col',
        st.toggle(m, 'enabled', set, 'Personal recommendations', 'Off makes the app use its own on-device picks instead.'),
        st.toggle(m, 'composer', set, 'Build Home for each person', 'Off keeps one Home layout for everyone.'),
        h('div.limit-grid', WEIGHTS.map(function (x) {
          return ui.slider({ label: x.label, min: 0.5, max: 2, step: 0.1, value: m.factors[x.key], hint: x.hint, marks: ['Less', 'More'],
            format: factorText, onChange: function (v) { m.factors[x.key] = Math.round(v * 10) / 10; set(m); } });
        })));
    }
  };

  /* ---------------------------------------------------------- music AI */

  var musicSection = {
    key: 'ai-music', title: 'Music AI',
    desc: 'AI help with what plays next, the Home layout and making new songs. When it is off, the app uses its own picks.',
    fromValue: function (v) {
      v = obj(v); var g = obj(v.generate);
      return { enabled: v.enabled !== false, rerank: v.rerank !== false, home: v.home !== false, generate: g.enabled === true, quota: typeof g.dailyQuota === 'number' ? Math.min(50, Math.max(1, Math.round(g.dailyQuota))) : 5 };
    },
    toValue: function (m) {
      var o = {};
      if (!m.enabled) o.enabled = false;
      if (!m.rerank) o.rerank = false;
      if (!m.home) o.home = false;
      if (m.generate || m.quota !== 5) o.generate = { enabled: m.generate, dailyQuota: m.quota };
      return Object.keys(o).length ? o : null;
    },
    describe: function (v) {
      v = obj(v);
      if (v.enabled === false) return 'Music AI off';
      var on = [v.rerank !== false ? 'Up Next order' : null, v.home !== false ? 'Home layout' : null, obj(v.generate).enabled ? 'song making (' + (obj(v.generate).dailyQuota || 5) + ' a day)' : null].filter(Boolean);
      return on.length ? 'On: ' + on.join(', ') : 'Every part off';
    },
    render: function (m, set) {
      var sub = h('div');
      function draw() {
        VX.mount(sub, h('div' + (m.enabled ? '' : '.dim-group'),
          ui.switchRow('Order Up Next with AI', 'Puts the next songs in a smarter order.', m.rerank, function (on) { m.rerank = on; set(m); }, { disabled: !m.enabled }),
          ui.switchRow('Arrange Home with AI', 'Lets AI choose the order of Home sections.', m.home, function (on) { m.home = on; set(m); }, { disabled: !m.enabled }),
          ui.switchRow('Let people make songs', 'Makes a new song like one they love.', m.generate, function (on) { m.generate = on; set(m); draw(); }, { disabled: !m.enabled }),
          m.generate ? ui.slider({ label: 'Songs each person can make a day', min: 1, max: 50, value: m.quota, disabled: !m.enabled, format: function (v) { return fmt.plural(v, 'song') + (v === 5 ? ' (built-in)' : ''); }, onChange: function (v) { m.quota = v; set(m); } }) : null));
      }
      draw();
      return h('div.form-col', ui.switchRow('Music AI', 'Off stops every music AI feature.', m.enabled, function (on) { m.enabled = on; set(m); draw(); }), sub);
    }
  };

  VX.settingsPage({
    id: 'app-settings/features', title: 'Features & AI', icon: 'spark', order: 2,
    desc: 'Switch app features on or off, and control VinaX AI, recommendations and music AI.',
    sections: [flagsSection, aiSection, personalSection, musicSection]
  });
})();
