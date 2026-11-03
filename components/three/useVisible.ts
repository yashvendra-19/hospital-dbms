'use client';

import { RefObject, useEffect, useState } from 'react';

/** True while the element is on screen and the tab is visible: 3D scenes stop rendering otherwise. */
export function useVisible(ref: RefObject<HTMLElement>) {
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '80px' });
    io.observe(el);
    const onVis = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ref]);
  return onScreen && tabVisible;
}
