(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'song-stats', title: 'Song Stats', group: 'Music', icon: 'growth', order: 1, range: true,
    desc: 'What signed-in users play, where they are, and whether they come back.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
