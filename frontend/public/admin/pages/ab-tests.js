(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'ab-tests', title: 'A/B Tests', group: 'Engage', icon: 'flask', order: 2,
    desc: 'Try two versions of something and see which works better.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
