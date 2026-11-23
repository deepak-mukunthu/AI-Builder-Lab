/* Inside the lab's Sandbox screen: talk to the lab page around the frame.
   The Sandbox sends its height (so the frame grows and the whole page
   scrolls) and its test score (shown in the lab's menu). The lab sends
   back its scroll position, so the chat column stays in view.
   Only these numbers cross the frame, never settings or API keys. */
(function (g) {
  'use strict';
  if (g.parent === g) return;
  var lab = g.parent;
  var layout = document.querySelector('.layout'), right = document.querySelector('.right');
  var narrow = g.matchMedia('(max-width: 1000px)');

  function sendHeight() {
    lab.postMessage({ type: 'sandbox-height', h: Math.ceil(document.body.getBoundingClientRect().height) }, '*');
  }
  g.ABS.embed = {
    score: function (r, example) {
      lab.postMessage({ type: 'sandbox-score', pct: r.pct, passed: r.passed, total: r.total, real: !!r.real, example: example }, '*');
    }
  };

  /* top: how far the frame's top edge is above the lab's window; vh: the
     lab's window height. Pin the chat column like position: sticky would. */
  g.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== lab || !d || d.type !== 'lab-viewport') return;
    if (narrow.matches) { right.style.maxHeight = ''; right.style.transform = ''; return; }
    right.style.maxHeight = (d.vh - 16) + 'px';
    var room = layout.offsetTop + layout.offsetHeight - 16 - right.offsetTop - right.offsetHeight;
    var off = Math.min(Math.max(0, d.top + 8 - right.offsetTop), Math.max(0, room));
    right.style.transform = off ? 'translateY(' + off + 'px)' : '';
  });

  new ResizeObserver(sendHeight).observe(document.body);
  sendHeight();
})(window);
