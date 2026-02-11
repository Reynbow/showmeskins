import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ItemInfo } from '../types';

interface ItemTooltipProps {
  itemId: number;
  itemDisplayName: string;
  itemPrice: number;
  itemCount: number;
  info: ItemInfo | undefined;
  version: string;
  getItemIconUrl: (version: string, itemId: number) => string;
  children: React.ReactNode;
  className?: string;
}

export function ItemTooltip({
  itemId,
  itemDisplayName,
  itemPrice,
  itemCount,
  info,
  version,
  getItemIconUrl,
  children,
  className = '',
}: ItemTooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const slotRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    const el = slotRef.current;
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

  const tooltipContent = info ? (
    <>
      <div className="item-tooltip-header">
        <img className="item-tooltip-icon" src={getItemIconUrl(version, itemId)} alt="" />
        <div className="item-tooltip-title">
          <span className="item-tooltip-name">{info.name}</span>
        </div>
        <span className="item-tooltip-gold">
          <svg className="item-tooltip-coin" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" /></svg>
          {info.goldTotal.toLocaleString()}
        </span>
      </div>
      <div className="item-tooltip-body" dangerouslySetInnerHTML={{ __html: info.descriptionHtml }} />
    </>
  ) : (
    <>
      <div className="item-tooltip-header">
        <img className="item-tooltip-icon" src={getItemIconUrl(version, itemId)} alt="" />
        <div className="item-tooltip-title">
          <span className="item-tooltip-name">{itemDisplayName}</span>
        </div>
        <span className="item-tooltip-gold">
          <svg className="item-tooltip-coin" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" /></svg>
          {(itemPrice * itemCount).toLocaleString()}
        </span>
      </div>
    </>
  );

  const tooltipEl = show && (
    <div
      className="item-tooltip item-tooltip--portal"
      style={{
        position: 'fixed',
        bottom: 'auto',
        left: pos.left,
        top: pos.top,
        transform: 'translate(-50%, -100%)',
      }}
    >
      {tooltipContent}
    </div>
  );

  return (
    <>
      <div
        ref={slotRef}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {tooltipEl && createPortal(tooltipEl, document.body)}
    </>
  );
}
