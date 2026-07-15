import { useEffect, useRef, useState } from 'react';

// Shrinks a fixed-width document (an A4 .doc-page is 210mm ≈ 794px) so its
// on-screen preview fits however wide its container actually is — the print
// preview modals otherwise overflow the screen on phones and look broken.
// Returns a ref to put on the scroll container and a `scale` to feed CSS
// `zoom` on the wrapper directly around the document. zoom (not transform:
// scale) so the shrunk document also reflows its height: no dead scroll
// space below it, and every page stays visible. Never enlarges past 1:1, so
// desktop (where the container is wider than the sheet) is unaffected.
const A4_WIDTH_PX = 794;

export default function useFitToWidth(deps = [], intrinsicWidth = A4_WIDTH_PX) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setScale(w && w < intrinsicWidth ? Math.max(0.3, w / intrinsicWidth) : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { containerRef, scale };
}
