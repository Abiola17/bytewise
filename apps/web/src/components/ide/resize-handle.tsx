"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A number kept in localStorage (a per-browser layout preference, nothing more). */
export function usePersistentSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(initial);
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(key));
      if (Number.isFinite(stored) && stored >= min && stored <= max) setSize(stored);
    } catch {
      // Storage can be unavailable (private mode); the default size is fine.
    }
  }, [key, min, max]);
  const update = (next: number) => {
    const clamped = Math.round(Math.min(max, Math.max(min, next)));
    setSize(clamped);
    try {
      window.localStorage.setItem(key, String(clamped));
    } catch {
      // Ignore: the layout still works without persistence.
    }
  };
  return [size, update, { min, max }] as const;
}

/**
 * Drag (or arrow-key) handle between two panes. `direction` is +1 when dragging
 * right/down grows the pane, -1 when it shrinks it.
 */
export function ResizeHandle({
  axis,
  value,
  min,
  max,
  direction,
  onChange,
  label,
  className,
}: {
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  onChange: (next: number) => void;
  label: string;
  className?: string;
}) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: axis === "x" ? e.clientX : e.clientY, value };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const pos = axis === "x" ? e.clientX : e.clientY;
        onChange(start.current.value + (pos - start.current.pos) * direction);
      }}
      onPointerUp={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(e) => {
        const grow = axis === "x" ? "ArrowRight" : "ArrowDown";
        const shrink = axis === "x" ? "ArrowLeft" : "ArrowUp";
        if (e.key === grow) onChange(value + 16 * direction);
        else if (e.key === shrink) onChange(value - 16 * direction);
      }}
      className={cn(
        "group relative z-10 shrink-0 touch-none outline-none",
        axis === "x" ? "w-px cursor-col-resize bg-border" : "h-px cursor-row-resize bg-border",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary",
          axis === "x" ? "inset-y-0 -left-[2px] w-[5px]" : "inset-x-0 -top-[2px] h-[5px]",
          dragging && "bg-primary",
        )}
      />
    </div>
  );
}
