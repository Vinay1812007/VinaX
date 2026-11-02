(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'notifications', title: 'Send Notification', group: 'Engage', icon: 'bell', order: 1,
    desc: 'Send a message to phones and browsers.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
