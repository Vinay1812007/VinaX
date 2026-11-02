(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'google-search', title: 'Google Search', group: 'System', icon: 'globe', order: 3,
    desc: 'Whether Google and other search engines can find and read the website.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
