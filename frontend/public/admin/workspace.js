/* Operations workspace. Aggregate service reads; operator preferences stay on this device. */
(function () {
  'use strict';
  var KEY = 'vinax.admin.workspace.v1';
  var METRICS = [
    ['active_now', 'Listening now'],
    ['plays_today', 'Plays today'],
    ['dau', 'Daily listeners'],
    ['new_today', 'New listeners today'],
    ['errors_24h', 'Errors · 24h'],
    ['feedback_new', 'New feedback'],
  ];
  var CHECKS = [
    'Review playback errors',
    'Review zero-result searches',
    'Triage listener feedback',
    'Verify release readiness',
    'Prepare handover',
  ];
  var state,
    context,
    currentTab = 'pulse',
    requestId = 0,
    busy = false;
  var summary = null,
    search = null,
    fetchedAt = null,
    failures = [],
    filter = '',
    taskStatus = 'all';
  var storageFailed = false,
    drafts = {};
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function read() {
    var p;
    try {
      p = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (_) {
      p = {};
    }
    p = p && typeof p === 'object' ? p : {};
    return {
      hidden: Array.isArray(p.hidden)
        ? p.hidden.filter(function (k) {
            return METRICS.some(function (m) {
              return m[0] === k;
            });
          })
        : [],
      baseline:
        p.baseline &&
        typeof p.baseline.at === 'string' &&
        p.baseline.values &&
        typeof p.baseline.values === 'object'
          ? p.baseline
          : null,
      thresholds: {
        errors_24h: Number.isFinite(p.thresholds && p.thresholds.errors_24h)
          ? Math.max(0, p.thresholds.errors_24h)
          : 10,
        feedback_new: Number.isFinite(p.thresholds && p.thresholds.feedback_new)
          ? Math.max(0, p.thresholds.feedback_new)
          : 5,
      },
      goal: Number.isFinite(p.goal) && p.goal > 0 ? p.goal : 100,
      tasks: (Array.isArray(p.tasks) ? p.tasks : [])
        .filter(function (t) {
          return (
            t &&
            typeof t.id === 'string' &&
            typeof t.title === 'string' &&
            ['todo', 'doing', 'done'].includes(t.status)
          );
        })
        .slice(0, 100),
      notes: typeof p.notes === 'string' ? p.notes.slice(0, 10000) : '',
      checklist: p.checklist && typeof p.checklist === 'object' ? p.checklist : {},
      watch: (Array.isArray(p.watch) ? p.watch : [])
        .filter(function (q) {
          return typeof q === 'string';
        })
        .slice(0, 50),
      triage: p.triage && typeof p.triage === 'object' ? p.triage : {},
      events: (Array.isArray(p.events) ? p.events : [])
        .filter(function (e) {
          return e && typeof e.at === 'string' && typeof e.text === 'string';
        })
        .slice(0, 50),
      views: (Array.isArray(p.views) ? p.views : [])
        .filter(function (v) {
          return (
            v &&
            typeof v.id === 'string' &&
            typeof v.name === 'string' &&
            ['pulse', 'search', 'tasks', 'handover'].includes(v.tab)
          );
        })
        .slice(0, 12),
    };
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageFailed = false;
    } catch (_) {
      storageFailed = true;
    }
  }
  function event(text) {
    state.events.unshift({ at: new Date().toISOString(), text: text });
    state.events = state.events.slice(0, 50);
    save();
  }
  function host() {
    return context && context.isActive() ? document.getElementById('ops-workspace') : null;
  }
  function number(k) {
    return summary && Number.isFinite(summary[k]) ? summary[k] : null;
  }
  function fmt(n) {
    return n == null ? 'Unavailable' : n.toLocaleString();
  }
  function button(label, action, extra) {
    return (
      '<button class="ghost" data-ops="' + action + '" ' + (extra || '') + '>' + label + '</button>'
    );
  }
  function dayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function panel(title, body) {
    return '<section class="ops-panel"><h3>' + title + '</h3>' + body + '</section>';
  }
  function pulse() {
    var tiles = METRICS.filter(function (m) {
      return !state.hidden.includes(m[0]);
    })
      .map(function (m) {
        var n = number(m[0]),
          b = state.baseline && state.baseline.values[m[0]];
        var delta =
          n != null && Number.isFinite(b)
            ? '<small>' + (n - b >= 0 ? '+' : '') + fmt(n - b) + ' since snapshot</small>'
            : '<small>No comparison snapshot</small>';
        return (
          '<article class="ops-metric"><span>' +
          m[1] +
          '</span><strong>' +
          fmt(n) +
          '</strong>' +
          delta +
          '</article>'
        );
      })
      .join('');
    var alerts = ['errors_24h', 'feedback_new']
      .map(function (key) {
        var n = number(key),
          limit = state.thresholds[key];
        return (
          '<div class="ops-signal"><span class="ops-status ' +
          (n == null ? '' : n >= limit ? 'attention' : 'ok') +
          '"></span><div><strong>' +
          (key === 'errors_24h' ? 'Playback & app errors' : 'Feedback inbox') +
          '</strong><small>' +
          (n == null
            ? 'Source unavailable'
            : n >= limit
              ? fmt(n) + ' · review threshold reached (' + limit + ')'
              : fmt(n) + ' · below review threshold (' + limit + ')') +
          '</small></div>' +
          button(
            'Review ↗',
            'navigate',
            'data-section="' + (key === 'errors_24h' ? 'technical' : 'feedback') + '"',
          ) +
          '</div>'
        );
      })
      .join('');
    var plays = number('plays_today');
    return (
      '<div class="ops-metrics">' +
      tiles +
      '</div><div class="ops-columns">' +
      panel(
        'Attention center',
        alerts +
          '<form id="ops-thresholds" class="ops-form"><label>Error threshold<input type="number" name="errors" min="0" max="1000000" value="' +
          state.thresholds.errors_24h +
          '" required></label><label>Feedback threshold<input type="number" name="feedback" min="0" max="1000000" value="' +
          state.thresholds.feedback_new +
          '" required></label><button>Save thresholds</button></form><p class="muted">Evaluated on refresh in this browser; no background notifications.</p>',
      ) +
      panel(
        'Today’s listening goal',
        '<div class="ops-goal"><strong>' +
          fmt(plays) +
          '</strong><span> / ' +
          fmt(state.goal) +
          ' plays</span></div><progress aria-label="Daily play goal" max="' +
          state.goal +
          '" value="' +
          Math.min(plays || 0, state.goal) +
          '"></progress><form id="ops-goal" class="ops-form"><label>Daily goal<input name="goal" type="number" min="1" max="10000000" value="' +
          state.goal +
          '" required></label><button>Update goal</button></form>',
      ) +
      '</div>' +
      panel(
        'Make this dashboard yours',
        '<div class="ops-widget-controls">' +
          METRICS.map(function (m) {
            return (
              '<label><input type="checkbox" data-metric="' +
              m[0] +
              '" ' +
              (!state.hidden.includes(m[0]) ? 'checked' : '') +
              '>' +
              m[1] +
              '</label>'
            );
          }).join('') +
          '</div><div class="ops-actions">' +
          button('Capture comparison snapshot', 'snapshot', summary ? '' : 'disabled') +
          '<span class="muted">' +
          (state.baseline
            ? 'Captured ' +
              esc(new Date(state.baseline.at).toLocaleString()) +
              '. Differences compare capture times, not equal periods.'
            : 'Compare the current values with a snapshot you choose.') +
          '</span></div>',
      )
    );
  }
  function searchPanel() {
    var zero = search && Array.isArray(search.zero) ? search.zero : [];
    var top = search && Array.isArray(search.top) ? search.top : [];
    var rows = zero.filter(function (r) {
      return String(r.query).toLowerCase().includes(filter.toLowerCase());
    });
    var sum = zero.reduce(function (n, r) {
      return n + (Number(r.count) || 0);
    }, 0);
    return (
      '<div class="ops-metrics"><article class="ops-metric"><span>Search events · selected range</span><strong>' +
      fmt(search && Number.isFinite(search.total) ? search.total : null) +
      '</strong><small>Up to 3,000 recent consented events</small></article><article class="ops-metric"><span>Failures in top zero-result queries</span><strong>' +
      (search ? fmt(sum) : 'Unavailable') +
      '</strong><small>Top 20 queries only; not a failure rate</small></article><article class="ops-metric"><span>Queries on your watchlist</span><strong>' +
      state.watch.length +
      '</strong><small>Saved on this device</small></article></div>' +
      panel(
        'Search recovery queue',
        '<p class="muted">Review missed searches, test the catalog, and track what needs a synonym or catalog fix.</p><label class="ops-search-label">Filter failed queries<input id="ops-query-filter" type="search" value="' +
          esc(filter) +
          '" placeholder="Find a query…"></label><div id="ops-query-rows">' +
          queryRows(rows) +
          '</div>',
      ) +
      '<div class="ops-columns">' +
      panel(
        'Watchlist',
        state.watch
          .map(function (q, i) {
            return (
              '<div class="ops-signal"><a target="_blank" rel="noopener" href="/search/' +
              encodeURIComponent(q) +
              '">' +
              esc(q) +
              ' ↗</a>' +
              button('Remove', 'unwatch', 'data-index="' + i + '"') +
              '</div>'
            );
          })
          .join('') || '<p class="muted">Watch a query from the recovery queue.</p>',
      ) +
      panel(
        'Leading searches',
        top
          .slice(0, 8)
          .map(function (q, i) {
            return (
              '<div class="ops-signal"><span class="muted">' +
              String(i + 1).padStart(2, '0') +
              '</span><strong>' +
              esc(q.query) +
              '</strong><span>' +
              esc(q.count) +
              '</span></div>'
            );
          })
          .join('') || '<p class="muted">No search data available.</p>',
      ) +
      '</div>'
    );
  }
  function queryRows(rows) {
    return (
      rows
        .map(function (r) {
          var q = String(r.query),
            status = state.triage[q] === 'reviewed' ? 'reviewed' : 'open';
          return (
            '<div class="ops-query"><div><strong>' +
            esc(q) +
            '</strong><small>' +
            esc(r.count) +
            ' zero-result events · ' +
            status +
            '</small></div><div class="ops-actions"><a href="/search/' +
            encodeURIComponent(q) +
            '" target="_blank" rel="noopener">Test search ↗</a>' +
            button(
              state.watch.includes(q) ? 'Watching' : 'Watch',
              'watch',
              'data-query="' + esc(q) + '" ' + (state.watch.includes(q) ? 'disabled' : ''),
            ) +
            button(
              status === 'reviewed' ? 'Reopen' : 'Mark reviewed',
              'triage',
              'data-query="' + esc(q) + '"',
            ) +
            button('Create task', 'query-task', 'data-query="' + esc(q) + '"') +
            '</div></div>'
          );
        })
        .join('') ||
      '<p class="muted">' +
        (search
          ? 'No failed queries match this filter.'
          : 'Search data unavailable. Refresh to retry.') +
        '</p>'
    );
  }
  function taskCards() {
    var tasks = state.tasks.filter(function (t) {
      return (
        (taskStatus === 'all' || t.status === taskStatus) &&
        [t.title, t.owner || ''].join(' ').toLowerCase().includes(filter.toLowerCase())
      );
    });
    return ['todo', 'doing', 'done']
      .map(function (status) {
        var group = tasks.filter(function (t) {
          return t.status === status;
        });
        return (
          '<section class="ops-task-column"><h3>' +
          { todo: 'To do', doing: 'In progress', done: 'Done' }[status] +
          ' <span>' +
          group.length +
          '</span></h3>' +
          (group
            .map(function (t) {
              var overdue =
                t.due && status !== 'done' && new Date(t.due + 'T23:59:59').getTime() < Date.now();
              return (
                '<article class="ops-task"><span class="ops-priority ' +
                (t.priority === 'high' ? 'high' : '') +
                '">' +
                esc(t.priority || 'normal') +
                '</span><h4>' +
                esc(t.title) +
                '</h4><small>' +
                esc(t.owner || 'Unassigned') +
                ' · ' +
                (t.due ? (overdue ? 'Overdue · ' : 'Due ') + esc(t.due) : 'No due date') +
                '</small><label>Status<select aria-label="Status for ' +
                esc(t.title) +
                '" data-task-status="' +
                esc(t.id) +
                '">' +
                ['todo', 'doing', 'done']
                  .map(function (s) {
                    return (
                      '<option value="' +
                      s +
                      '" ' +
                      (s === status ? 'selected' : '') +
                      '>' +
                      s +
                      '</option>'
                    );
                  })
                  .join('') +
                '</select></label></article>'
              );
            })
            .join('') || '<p class="muted">No tasks here.</p>') +
          '</section>'
        );
      })
      .join('');
  }
  function tasksPanel() {
    return (
      panel(
        'Create a follow-up',
        '<form id="ops-new-task" class="ops-form"><label class="ops-grow">Task<input name="title" maxlength="180" placeholder="What needs attention?" required></label><label>Owner<input name="owner" maxlength="60" placeholder="Name or team"></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label><label>Due date<input name="due" type="date"></label><button>Add task</button></form><p class="muted">Local task board · assigning a name does not notify anyone. Up to 100 tasks.</p>',
      ) +
      '<div class="ops-task-filters"><label>Search tasks<input id="ops-task-filter" type="search" value="' +
      esc(filter) +
      '" placeholder="Title or owner"></label><label>Show status<select id="ops-status-filter">' +
      ['all', 'todo', 'doing', 'done']
        .map(function (s) {
          return (
            '<option value="' +
            s +
            '" ' +
            (taskStatus === s ? 'selected' : '') +
            '>' +
            s +
            '</option>'
          );
        })
        .join('') +
      '</select></label></div><div class="ops-board" id="ops-board">' +
      taskCards() +
      '</div>'
    );
  }
  function handoverPanel() {
    var checked = Array.isArray(state.checklist[dayKey()]) ? state.checklist[dayKey()] : [];
    return (
      '<div class="ops-columns">' +
      panel(
        'Daily review',
        '<p class="muted">' +
          checked.length +
          ' of ' +
          CHECKS.length +
          ' complete · resets each local calendar day</p>' +
          CHECKS.map(function (c, i) {
            return (
              '<label class="ops-check"><input type="checkbox" data-check="' +
              i +
              '" ' +
              (checked.includes(i) ? 'checked' : '') +
              '>' +
              c +
              '</label>'
            );
          }).join(''),
      ) +
      panel(
        'Handover notes',
        '<form id="ops-notes"><label for="ops-note-text">Context for your next session</label><textarea id="ops-note-text" name="notes" rows="7" maxlength="10000" placeholder="What changed? What should be watched?">' +
          esc(state.notes) +
          '</textarea><button>Save notes</button></form>',
      ) +
      '</div>' +
      panel(
        'Workspace activity',
        '<p class="muted">Local operator history. Server actions are recorded separately in Audit Trail.</p><ol class="ops-timeline">' +
          (state.events
            .map(function (e) {
              return (
                '<li><time>' +
                esc(new Date(e.at).toLocaleString()) +
                '</time><span>' +
                esc(e.text) +
                '</span></li>'
              );
            })
            .join('') || '<li>No workspace changes yet.</li>') +
          '</ol>',
      )
    );
  }
  function render() {
    var root = host();
    if (!root) return;
    root.innerHTML =
      '<div class="ops-hero"><div><span class="ops-eyebrow">YOUR OPERATIONS WORKSPACE</span><h2>Stay ahead of the next play.</h2><p>Audience pulse, search recovery, and the work that matters.</p></div><div class="ops-hero-actions">' +
      button(busy ? 'Refreshing…' : 'Refresh sources', 'refresh', busy ? 'disabled' : '') +
      button('Download handover ↓', 'report') +
      '</div></div>' +
      '<div class="ops-meta"><span>' +
      (fetchedAt
        ? 'Sources checked ' + new Date(fetchedAt).toLocaleTimeString()
        : 'Sources have not been checked yet') +
      '</span><span>Preferences, tasks & notes · this browser only</span></div>' +
      (storageFailed
        ? '<p class="ops-warning" role="alert">Browser storage is unavailable. These changes will be lost on reload. Download a handover to keep a copy.</p>'
        : '') +
      (failures.length
        ? '<p class="ops-warning" role="status">Unavailable: ' +
          failures.map(esc).join(', ') +
          '. Other workspace tools remain available.</p>'
        : '') +
      '<div class="ops-tabs" role="tablist" aria-label="Workspace views">' +
      [
        ['pulse', '01', 'Pulse'],
        ['search', '02', 'Search quality'],
        ['tasks', '03', 'Task board'],
        ['handover', '04', 'Handover'],
      ]
        .map(function (t) {
          return (
            '<button id="ops-tab-' +
            t[0] +
            '" role="tab" aria-controls="ops-content" aria-selected="' +
            (currentTab === t[0]) +
            '" data-ops="tab" data-tab="' +
            t[0] +
            '"><span>' +
            t[1] +
            '</span>' +
            t[2] +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="ops-saved-views"><form id="ops-save-view"><input name="name" maxlength="50" aria-label="Saved view name" placeholder="Name this view" required><button>Save view</button></form>' +
      state.views
        .map(function (v) {
          return (
            '<span>' +
            button(esc(v.name), 'open-view', 'data-id="' + esc(v.id) + '"') +
            button(
              '×',
              'delete-view',
              'data-id="' + esc(v.id) + '" aria-label="Delete ' + esc(v.name) + '"',
            ) +
            '</span>'
          );
        })
        .join('') +
      '</div><div id="ops-content" role="tabpanel" aria-labelledby="ops-tab-' +
      currentTab +
      '">' +
      { pulse: pulse, search: searchPanel, tasks: tasksPanel, handover: handoverPanel }[
        currentTab
      ]() +
      '</div><p id="ops-notice" role="status" class="muted"></p>';
    Object.keys(drafts).forEach(function (id) {
      var form = document.getElementById(id);
      if (!form) return;
      Object.keys(drafts[id]).forEach(function (name) {
        var field = form.elements.namedItem(name);
        if (field) field.value = drafts[id][name];
      });
    });
  }
  function notice(message) {
    var el = document.getElementById('ops-notice');
    if (el) el.textContent = message;
  }
  function refresh() {
    if (busy) return;
    busy = true;
    var id = ++requestId;
    render();
    var readWithDeadline = function (path) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error('timeout'));
        }, 15000);
        context.api(path).then(
          function (data) {
            clearTimeout(timer);
            if (data == null) reject(new Error('unavailable'));
            else resolve(data);
          },
          function (error) {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    };
    Promise.allSettled([
      readWithDeadline('/api/admin/overview'),
      readWithDeadline('/api/admin/search-analytics?days=' + context.days()),
    ]).then(function (results) {
      if (id !== requestId) return;
      summary =
        results[0].status === 'fulfilled' && results[0].value.summary
          ? results[0].value.summary
          : null;
      search = results[1].status === 'fulfilled' ? results[1].value : null;
      failures = [];
      if (!summary) failures.push('audience metrics');
      if (!search) failures.push('search analytics');
      busy = false;
      fetchedAt = new Date().toISOString();
      render();
    });
  }
  function addTask(title, owner, priority, due) {
    if (state.tasks.length >= 100) {
      notice('Task limit reached (100). Your existing tasks are retained.');
      return;
    }
    state.tasks.unshift({
      id: crypto.randomUUID(),
      title: title.slice(0, 180),
      owner: owner.slice(0, 60),
      priority: priority,
      due: due,
      status: 'todo',
    });
    event('Created task: ' + title);
    render();
    notice('Task saved on this device.');
  }
  function report() {
    var reportData = {
      generatedAt: new Date().toISOString(),
      sourceCheckedAt: fetchedAt,
      days: context.days(),
      summary: summary,
      unavailableSources: failures,
      thresholds: state.thresholds,
      baseline: state.baseline,
      dailyGoal: state.goal,
      tasks: state.tasks,
      notes: state.notes,
      checklist: state.checklist[dayKey()] || [],
      checklistLabels: CHECKS,
      watchlist: state.watch,
      queryReviewStatus: state.triage,
      activity: state.events,
    };
    var url = URL.createObjectURL(
      new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' }),
    );
    var a = document.createElement('a');
    a.href = url;
    a.download = 'vinax-handover-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    event('Downloaded handover report');
    render();
  }
  function click(e) {
    var b = e.target.closest('[data-ops]');
    if (!b || !host()) return;
    var action = b.dataset.ops,
      q = b.dataset.query;
    if (action === 'tab') {
      currentTab = b.dataset.tab;
      filter = '';
      render();
      document.getElementById('ops-tab-' + currentTab).focus();
    } else if (action === 'refresh') refresh();
    else if (action === 'navigate') context.navigate(b.dataset.section);
    else if (action === 'snapshot' && summary) {
      state.baseline = { at: new Date().toISOString(), values: { ...summary } };
      event('Captured metric comparison snapshot');
      render();
    } else if (action === 'watch' && q && !state.watch.includes(q)) {
      if (state.watch.length >= 50) return notice('Watchlist limit reached (50).');
      state.watch.push(q);
      event('Watching search: ' + q);
      render();
    } else if (action === 'unwatch') {
      state.watch.splice(Number(b.dataset.index), 1);
      save();
      render();
    } else if (action === 'triage' && q) {
      state.triage[q] = state.triage[q] === 'reviewed' ? 'open' : 'reviewed';
      event('Search ' + state.triage[q] + ': ' + q);
      render();
    } else if (action === 'query-task') addTask('Investigate search: ' + q, '', 'normal', '');
    else if (action === 'report') report();
    else if (action === 'delete-view') {
      state.views = state.views.filter(function (v) {
        return v.id !== b.dataset.id;
      });
      save();
      render();
    } else if (action === 'open-view') {
      var v = state.views.find(function (v) {
        return v.id === b.dataset.id;
      });
      if (!v) return;
      currentTab = v.tab;
      filter = typeof v.filter === 'string' ? v.filter : '';
      taskStatus = ['all', 'todo', 'doing', 'done'].includes(v.status) ? v.status : 'all';
      if (Array.isArray(v.hidden)) state.hidden = v.hidden;
      save();
      render();
    }
  }
  function change(e) {
    var t = e.target;
    if (!host()) return;
    captureDraft(t);
    if (t.dataset.metric) {
      state.hidden = state.hidden.filter(function (k) {
        return k !== t.dataset.metric;
      });
      if (!t.checked) state.hidden.push(t.dataset.metric);
      save();
      render();
    }
    if (t.dataset.taskStatus) {
      var task = state.tasks.find(function (v) {
        return v.id === t.dataset.taskStatus;
      });
      if (task && ['todo', 'doing', 'done'].includes(t.value)) {
        task.status = t.value;
        event('Task ' + t.value + ': ' + task.title);
        render();
      }
    }
    if (t.dataset.check != null) {
      var today = dayKey(),
        list = Array.isArray(state.checklist[today]) ? state.checklist[today] : [];
      list = list.filter(function (i) {
        return i !== Number(t.dataset.check);
      });
      if (t.checked) list.push(Number(t.dataset.check));
      state.checklist = { [today]: list };
      save();
      render();
    }
    if (t.id === 'ops-status-filter') {
      taskStatus = t.value;
      document.getElementById('ops-board').innerHTML = taskCards();
    }
  }
  function captureDraft(t) {
    var form = t.closest('form');
    if (form && ['ops-notes', 'ops-new-task', 'ops-save-view'].includes(form.id) && t.name) {
      drafts[form.id] = drafts[form.id] || {};
      drafts[form.id][t.name] = t.value;
    }
  }
  function input(e) {
    if (!host()) return;
    captureDraft(e.target);
    if (e.target.id === 'ops-query-filter') {
      filter = e.target.value;
      document.getElementById('ops-query-rows').innerHTML = queryRows(
        ((search && search.zero) || []).filter(function (r) {
          return String(r.query).toLowerCase().includes(filter.toLowerCase());
        }),
      );
    }
    if (e.target.id === 'ops-task-filter') {
      filter = e.target.value;
      document.getElementById('ops-board').innerHTML = taskCards();
    }
  }
  function submit(e) {
    if (!host() || !e.target.id.startsWith('ops-')) return;
    e.preventDefault();
    var form = e.target,
      data = new FormData(form);
    delete drafts[form.id];
    if (form.id === 'ops-thresholds') {
      state.thresholds = {
        errors_24h: Math.max(0, Number(data.get('errors')) || 0),
        feedback_new: Math.max(0, Number(data.get('feedback')) || 0),
      };
      event('Updated attention thresholds');
      render();
      notice('Thresholds saved.');
    }
    if (form.id === 'ops-goal') {
      state.goal = Math.max(1, Number(data.get('goal')) || 100);
      event('Updated daily listening goal');
      render();
    }
    if (form.id === 'ops-new-task') {
      var title = String(data.get('title') || '').trim();
      if (title)
        addTask(
          title,
          String(data.get('owner') || ''),
          String(data.get('priority')),
          String(data.get('due') || ''),
        );
    }
    if (form.id === 'ops-notes') {
      state.notes = String(data.get('notes') || '').slice(0, 10000);
      event('Saved handover notes');
      render();
      notice('Notes saved on this device.');
    }
    if (form.id === 'ops-save-view') {
      var name = String(data.get('name') || '').trim();
      if (!name) return;
      state.views.unshift({
        id: crypto.randomUUID(),
        name: name.slice(0, 50),
        tab: currentTab,
        filter: filter,
        status: taskStatus,
        hidden: state.hidden.slice(),
      });
      state.views = state.views.slice(0, 12);
      event('Saved workspace view: ' + name);
      render();
    }
  }
  window.VinaXWorkspace = {
    refresh: function () {
      if (host()) refresh();
    },
    mount: function (ctx) {
      context = ctx;
      state = read();
      requestId++;
      busy = false;
      summary = null;
      search = null;
      fetchedAt = null;
      failures = [];
      var view = document.getElementById('view');
      view.innerHTML = '<div id="ops-workspace"></div>';
      var root = host();
      if (!root) return;
      root.addEventListener('keydown', function (e) {
        if (!e.target.matches('[role=tab]')) return;
        var tabs = ['pulse', 'search', 'tasks', 'handover'],
          i = tabs.indexOf(currentTab);
        if (e.key === 'ArrowRight') i = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') i = (i + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = tabs.length - 1;
        else return;
        e.preventDefault();
        currentTab = tabs[i];
        filter = '';
        render();
        document.getElementById('ops-tab-' + currentTab).focus();
      });
      root.addEventListener('click', click);
      root.addEventListener('change', change);
      root.addEventListener('input', input);
      root.addEventListener('submit', submit);
      render();
      refresh();
    },
  };
})();
