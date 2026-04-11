import { useCallback, useRef, useState } from 'react';

export function useSidebarResize(initial = 220, min = 140, max = 480) {
  const [width, setWidth] = useState(initial);
  const dragging = useRef(false);
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (e) => { if (dragging.current) setWidth(Math.min(max, Math.max(min, e.clientX))); };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [min, max]);
  return { width, onMouseDown };
}
