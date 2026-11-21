// NEXUS isolated updater window — plain script (no modules needed).
(function () {
  var stage = document.getElementById('u-stage');
  var fill = document.getElementById('u-fill');
  var pct = document.getElementById('u-pct');
  window.nexus.onUpdaterStage(function (s) {
    stage.textContent = s.text || '';
    stage.className = 'u-stage' + (s.result === 'success' ? ' u-ok' : s.result === 'rollback' ? ' u-warn' : s.result === 'error' ? ' u-bad' : '');
    var p = Math.max(0, Math.min(100, s.percent || 0));
    fill.style.width = p + '%';
    pct.textContent = p + '%';
  });
})();