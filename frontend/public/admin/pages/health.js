(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'health', title: 'App Health', group: 'System', icon: 'pulse', order: 1, range: true,
    desc: 'Errors people hit in the app, and whether every service is working.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
