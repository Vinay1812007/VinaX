import { useId } from 'react';
import { cn } from '@/utils/cn';
import '@/styles/ui.css';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Shown beside the label and read out as aria-valuetext. */
  format?: (value: number) => string;
  className?: string;
}

/** Design system v2 slider: a native range input with a filled track. */
export function Slider({ value, onChange, label, min = 0, max = 100, step = 1, format, className }: SliderProps) {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const text = format ? format(value) : String(value);
  return (
    <div className={cn('vx-slider', className)}>
      <div className="vx-slider-head">
        <label htmlFor={id} className="vx-slider-label">{label}</label>
        <span className="vx-slider-value" aria-hidden>{text}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        style={{ ['--fill' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
