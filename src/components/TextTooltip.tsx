import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TextTooltipProps {
  text: string;
  children: React.ReactNode;
  className?: string;
  /** Optional variant for styling (e.g. 'double', 'penta', 'rampage', 'legendary') */
  variant?: string;
}

/** Simple text tooltip — matches skin/emote/chroma tooltip style, rendered via portal to avoid overflow clipping */
export function TextTooltip({ text, children, className = '', variant }: TextTooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
    setShow(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShow(false);
  }, []);

  const tooltipEl = show && (
    <div
      className={`text-tooltip text-tooltip--portal${variant ? ` text-tooltip--${variant}` : ''}`}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: 'translate(-50%, -100%)',
      }}
    >
      {text}
    </div>
  );

  return (
    <>
      <span
        ref={ref}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </span>
      {tooltipEl && createPortal(tooltipEl, document.body)}
    </>
  );
}
