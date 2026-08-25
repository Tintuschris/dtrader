"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  children: [React.ReactNode, React.ReactNode];
  labels?: [string, string];
};

/**
 * A simple two-panel swipeable carousel for mobile.
 * Swipes left/right to switch between two panels.
 * Shows dot indicators and labels.
 */
export default function SwipeCarousel({ children, labels = ["Chart", "Digits"] }: Props) {
  const [active, setActive] = useState(0);
  const touchStart = useRef({ x: 0, y: 0 });
  const touchDelta = useRef({ x: 0, y: 0 });
  const isSwiping = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchDelta.current = { x: 0, y: 0 };
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    touchDelta.current = { x: dx, y: dy };

    // Only start swiping if horizontal movement is dominant
    if (!isSwiping.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      isSwiping.current = true;
    }

    if (isSwiping.current) {
      e.preventDefault();
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const dx = touchDelta.current.x;
    if (Math.abs(dx) > 50) {
      if (dx < 0 && active < 1) {
        setActive(1);
      } else if (dx > 0 && active > 0) {
        setActive(0);
      }
    }
    isSwiping.current = false;
  }, [active]);

  return (
    <div className="swipe-carousel">
      <div className="swipe-carousel-labels">
        {labels.map((label, i) => (
          <button
            key={i}
            className={`swipe-label ${active === i ? "active" : ""}`}
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="swipe-carousel-viewport"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="swipe-carousel-track"
          style={{ transform: `translateX(-${active * 100}%)` }}
        >
          <div className="swipe-carousel-slide">{children[0]}</div>
          <div className="swipe-carousel-slide">{children[1]}</div>
        </div>
      </div>
      <div className="swipe-carousel-dots">
        <span className={`swipe-dot ${active === 0 ? "active" : ""}`} onClick={() => setActive(0)} />
        <span className={`swipe-dot ${active === 1 ? "active" : ""}`} onClick={() => setActive(1)} />
      </div>
    </div>
  );
}
