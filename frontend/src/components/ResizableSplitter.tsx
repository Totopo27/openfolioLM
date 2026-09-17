import React, { useState, useEffect, useCallback, useRef } from 'react';

interface ResizableSplitterProps {
  splitPercent: number;
  onSplitChange: (newPercent: number) => void;
  minPercent?: number;
  maxPercent?: number;
  onReset?: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  splitPercent,
  onSplitChange,
  minPercent = 18,
  maxPercent = 82,
  onReset,
  containerRef,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const splitterRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const container = containerRef?.current || splitterRef.current?.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const clientX = e.clientX;
      const offsetX = clientX - rect.left;
      const percentage = (offsetX / rect.width) * 100;

      const clamped = Math.max(minPercent, Math.min(maxPercent, percentage));
      onSplitChange(Math.round(clamped * 10) / 10);
    },
    [isDragging, containerRef, minPercent, maxPercent, onSplitChange]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <>
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-none" />
      )}
      <div
        ref={splitterRef}
        role="separator"
        aria-valuenow={splitPercent}
        aria-valuemin={minPercent}
        aria-valuemax={maxPercent}
        onMouseDown={handleMouseDown}
        onDoubleClick={onReset}
        className={`relative z-30 flex-shrink-0 cursor-col-resize select-none w-2 -mx-1 flex items-center justify-center transition-all ${
          isDragging ? 'bg-indigo-500/30' : 'hover:bg-indigo-500/15'
        }`}
        title={`Divisor ajustable: ${splitPercent}% (Arrastrá para reajustar ancho, doble clic para centrar al 50%)`}
      >
      {/* Subtle border line */}
      <div
        className={`w-[1px] h-full transition-colors ${
          isDragging
            ? 'bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.8)]'
            : 'bg-slate-800/90 hover:bg-indigo-500/60'
        }`}
      />

      {/* Grip pill handle */}
      <div
        className={`absolute w-3.5 h-8 rounded-full flex flex-col items-center justify-center gap-0.5 border transition-all ${
          isDragging
            ? 'bg-indigo-600 border-indigo-300 scale-110 shadow-lg shadow-indigo-950/80 ring-2 ring-indigo-400/40'
            : 'bg-slate-900 border-slate-700/80 hover:border-indigo-500/80 hover:bg-slate-800 shadow-sm'
        }`}
      >
        <div
          className={`w-0.5 h-0.5 rounded-full ${
            isDragging ? 'bg-white' : 'bg-slate-400'
          }`}
        />
        <div
          className={`w-0.5 h-0.5 rounded-full ${
            isDragging ? 'bg-white' : 'bg-slate-400'
          }`}
        />
        <div
          className={`w-0.5 h-0.5 rounded-full ${
            isDragging ? 'bg-white' : 'bg-slate-400'
          }`}
        />
      </div>
    </div>
    </>
  );
};
