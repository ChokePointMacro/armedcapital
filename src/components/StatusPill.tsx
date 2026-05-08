import type { StatusPill as StatusPillValue } from '@/types';

const STYLES: Record<StatusPillValue, { dot: string; text: string; ring: string; label: string; dashed?: boolean }> = {
  green:   { dot: 'bg-emerald-400', text: 'text-emerald-300', ring: 'ring-emerald-400/30', label: 'GREEN' },
  yellow:  { dot: 'bg-amber-400',   text: 'text-amber-300',   ring: 'ring-amber-400/30',   label: 'YELLOW' },
  red:     { dot: 'bg-rose-500',    text: 'text-rose-300',    ring: 'ring-rose-500/30',    label: 'RED' },
  unknown: { dot: 'bg-zinc-500',    text: 'text-zinc-400',    ring: 'ring-zinc-500/40',    label: 'NO SIGNAL', dashed: true },
};

export function StatusPill({
  status,
  size = 'sm',
  className = '',
}: {
  status: StatusPillValue;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const s = STYLES[status];
  const padding = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono uppercase tracking-widest ring-1 ${padding} ${s.text} ${s.ring} ${className}`}
      style={s.dashed ? { borderStyle: 'dashed' } : undefined}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export default StatusPill;
