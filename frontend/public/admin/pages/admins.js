(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'admins', title: 'Admins & Roles', group: 'System', icon: 'shield', order: 4,
    desc: 'Who can open this console and what each person may change.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
