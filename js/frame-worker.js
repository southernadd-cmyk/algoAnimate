// Recording has its own clock: requestAnimationFrame can stop when the user
// switches to the captured sound tab, even while its audio keeps recording.
let timer = null, deadline = 0;
const interval = 1000 / 30;
function tick() {
  self.postMessage('frame');
  deadline = Math.max(deadline + interval, performance.now());
  timer = setTimeout(tick, Math.max(0, deadline - performance.now()));
}
self.onmessage = ({ data }) => {
  clearTimeout(timer); timer = null;
  if (data === 'start') { deadline = performance.now(); tick(); }
};
