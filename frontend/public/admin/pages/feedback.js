(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'feedback', title: 'Feedback', group: 'People', icon: 'message', order: 2,
    desc: 'Messages people send from Settings, Feedback in the app.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
