(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'database', title: 'Database', group: 'System', icon: 'database', order: 2,
    desc: 'How much is stored, the jobs that run by themselves, and every change admins made.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
