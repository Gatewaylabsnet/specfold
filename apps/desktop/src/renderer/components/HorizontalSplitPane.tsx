import { useRef, useState, type CSSProperties, type ReactNode } from "react";

const DEFAULT_TOP_RATIO = 0.7;
const MIN_TOP_HEIGHT = 240;
const MIN_BOTTOM_HEIGHT = 160;
const KEYBOARD_STEP = 24;
const DEFAULT_TOP_PERCENT = Math.round(DEFAULT_TOP_RATIO * 100);

export function HorizontalSplitPane({
  top,
  bottom,
  label = "Resize request and response panels"
}: {
  top: ReactNode;
  bottom: ReactNode;
  label?: string;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const [topPercent, setTopPercent] = useState(DEFAULT_TOP_PERCENT);

  const bounds = () => {
    const height = containerRef.current?.getBoundingClientRect().height ?? 0;
    const minimumTop = Math.min(MIN_TOP_HEIGHT, height * 0.45);
    const maximumTop = Math.max(minimumTop, height - MIN_BOTTOM_HEIGHT);
    return { height, minimumTop, maximumTop };
  };

  const setClampedHeight = (height: number) => {
    const { height: containerHeight, minimumTop, maximumTop } = bounds();
    const nextHeight = Math.round(Math.min(maximumTop, Math.max(minimumTop, height)));
    if (containerHeight > 0) setTopPercent(Math.round((nextHeight / containerHeight) * 100));
  };

  const resizeFromPointer = (clientY: number) => {
    const top = containerRef.current?.getBoundingClientRect().top;
    if (top !== undefined) setClampedHeight(clientY - top);
  };

  const reset = () => {
    setTopPercent(DEFAULT_TOP_PERCENT);
  };

  const style = { "--split-pane-top-height": `${topPercent}%` } as CSSProperties;
  return (
    <section className="editor-layout" ref={containerRef} style={style}>
      {top}
      <div
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={topPercent}
        className="pane-resizer"
        onDoubleClick={reset}
        onKeyDown={(event) => {
          const current = bounds().height * (topPercent / 100);
          if (event.key === "ArrowUp") setClampedHeight(current - KEYBOARD_STEP);
          else if (event.key === "ArrowDown") setClampedHeight(current + KEYBOARD_STEP);
          else if (event.key === "Home") setClampedHeight(bounds().minimumTop);
          else if (event.key === "End") setClampedHeight(bounds().maximumTop);
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeFromPointer(event.clientY);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) resizeFromPointer(event.clientY);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        role="separator"
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
      >
        <span />
      </div>
      {bottom}
    </section>
  );
}
