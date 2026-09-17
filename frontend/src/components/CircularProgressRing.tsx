import React from 'react';
import { Check, AlertCircle } from 'lucide-react';

export interface CircularProgressRingProps {
  progress: number; // 0 to 100
  stage?: 'uploading' | 'processing' | 'done' | 'error';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  strokeWidth?: number;
  className?: string;
  showText?: boolean;
}

const sizeMap = {
  xs: { dim: 16, radius: 6, stroke: 2, textSize: 'text-[7px]' },
  sm: { dim: 20, radius: 8, stroke: 2.2, textSize: 'text-[8px]' },
  md: { dim: 28, radius: 11, stroke: 2.5, textSize: 'text-[9px]' },
  lg: { dim: 38, radius: 15, stroke: 3, textSize: 'text-[11px]' },
};

export const CircularProgressRing: React.FC<CircularProgressRingProps> = ({
  progress,
  stage = 'uploading',
  size = 'md',
  strokeWidth,
  className = '',
  showText = false,
}) => {
  const config = sizeMap[size];
  const r = config.radius;
  const stroke = strokeWidth || config.stroke;
  const circumference = 2 * Math.PI * r;
  const clampedProgress = Math.min(100, Math.max(0, progress));
  const offset = circumference - (clampedProgress / 100) * circumference;

  const center = config.dim / 2;

  if (stage === 'done') {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 ${className}`}
        style={{ width: config.dim, height: config.dim }}
        title="Completado e indexado"
      >
        <Check className={size === 'xs' ? 'w-2.5 h-2.5' : size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
      </div>
    );
  }

  if (stage === 'error') {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 ${className}`}
        style={{ width: config.dim, height: config.dim }}
        title="Error en la carga"
      >
        <AlertCircle className={size === 'xs' ? 'w-2.5 h-2.5' : size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
      </div>
    );
  }

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: config.dim, height: config.dim }}
      title={
        stage === 'processing'
          ? 'Procesando e indexando páginas y diagramas con IA...'
          : `Subiendo archivo: ${clampedProgress}%`
      }
    >
      <svg
        width={config.dim}
        height={config.dim}
        viewBox={`0 0 ${config.dim} ${config.dim}`}
        className="-rotate-90 transform"
      >
        {/* Background Track Circle */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-slate-800"
        />

        {/* Animated Progress Refill Circle */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`transition-all duration-500 ease-out ${
            stage === 'processing'
              ? 'text-teal-400'
              : clampedProgress > 75
              ? 'text-emerald-400'
              : 'text-indigo-500'
          }`}
        />
      </svg>

      {/* Center content or text */}
      {showText && size !== 'xs' ? (
        <span
          className={`absolute font-mono font-bold leading-none ${
            stage === 'processing' ? 'text-teal-300' : 'text-slate-200'
          } ${config.textSize}`}
        >
          {clampedProgress}%
        </span>
      ) : stage === 'processing' && size === 'xs' ? (
        <div className="absolute inset-0 flex items-center justify-center text-teal-300 animate-pulse">
          <div className="w-1 h-1 rounded-full bg-teal-400" />
        </div>
      ) : null}
    </div>
  );
};
