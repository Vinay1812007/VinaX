(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'live', title: 'Live Now', group: 'Home', icon: 'live', order: 2,
    desc: 'Who is listening right now and what they are playing.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
