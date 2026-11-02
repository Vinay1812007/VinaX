(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'dashboard', title: 'Dashboard', group: 'Home', icon: 'grid', order: 1, range: true,
    desc: 'What is happening in VinaX today, and anything that needs you.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
