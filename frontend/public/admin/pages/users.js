(function () {
  'use strict';
  var VX = window.VX, ui = VX.ui;
  VX.page({
    id: 'users', title: 'Users', group: 'People', icon: 'users', order: 1,
    desc: 'Everyone who signed in to VinaX with Google.',
    render: function () { return ui.emptyState('Coming together', 'This page is being rebuilt.'); }
  });
})();
