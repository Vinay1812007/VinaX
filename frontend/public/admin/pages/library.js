(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'library', title: 'Music Library', group: 'Music', icon: 'library', order: 2,
    desc: 'Find any song, album or artist, and block what should not appear in the app.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
