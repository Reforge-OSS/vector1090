"use client";
import { useEffect, type RefObject } from "react";
import Lenis from "lenis";

export function usePanelScroll(
  wrapper: RefObject<HTMLDivElement>,
  content: RefObject<HTMLDivElement>,
) {
  useEffect(() => {
    if (!wrapper.current || !content.current) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | undefined;
    let frame = 0;
    const configure = () => {
      cancelAnimationFrame(frame);
      lenis?.destroy();
      lenis = undefined;
      if (preference.matches) return;
      lenis = new Lenis({
        wrapper: wrapper.current!,
        content: content.current!,
        smoothWheel: true,
        lerp: 0.09,
        overscroll: false,
      });
      const animate = (time: number) => {
        lenis?.raf(time);
        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    };
    configure();
    preference.addEventListener("change", configure);
    return () => {
      preference.removeEventListener("change", configure);
      cancelAnimationFrame(frame);
      lenis?.destroy();
    };
  }, [wrapper, content]);
}
