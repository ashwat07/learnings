// A heavy island: the one you never want on the critical path.
//
// The padding stands in for a real charting library. The point of making it big is that the
// difference between "loaded on page load" and "loaded when it scrolls into view" should be
// visible in the Network panel and in the numbers, not just in the argument.
const FAKE_LIBRARY = 'x'.repeat(90_000);

export default function chart(el) {
  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const data = Array.from({ length: 40 }, (_, i) => 20 + Math.abs(Math.sin(i / 3)) * 80);

  const draw = (t) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#7c9cff';
    data.forEach((v, i) => {
      const h = v * (0.85 + 0.15 * Math.sin(t / 500 + i));
      ctx.fillRect(i * 9, canvas.height - h, 7, h);
    });
    if (el.isConnected) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  return FAKE_LIBRARY.length;
}
