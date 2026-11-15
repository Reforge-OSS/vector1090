"use client";
import { useRef, type ReactNode } from "react";
import { usePanelScroll } from "@/hooks/usePanelScroll";

export default function ScrollPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  usePanelScroll(wrapper, content);
  return (
    <div
      ref={wrapper}
      className={"scroll-panel " + className}
      onWheel={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
    >
      <div ref={content}>{children}</div>
    </div>
  );
}
