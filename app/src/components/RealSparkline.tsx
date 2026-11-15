import React, { useEffect, useRef, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { useSparklineData } from '@/hooks/useCryptoData';

interface RealSparklineProps {
  symbol: string;
  positive: boolean;
  className?: string;
  strokeWidth?: number;
}

/**
 * Renders a 24-hour market sparkline from real Binance 1h closed/latest klines,
 * lazy-loading only when visible in the viewport.
 */
const RealSparkline: React.FC<RealSparklineProps> = ({
  symbol,
  positive,
  className = 'w-24 h-8',
  strokeWidth = 1.5,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (visible) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px', threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const { data, isLoading, isError } = useSparklineData(symbol, visible);

  return (
    <div ref={containerRef} className={className}>
      {data && data.length >= 2 ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <YAxis domain={['dataMin', 'dataMax']} hide />
            <Line
              type="monotone"
              dataKey="v"
              stroke={positive ? '#10b981' : '#ef4444'}
              strokeWidth={strokeWidth}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div
          aria-label={`24h sparkline for ${symbol}`}
          className="h-full w-full flex items-center justify-end"
        >
          {isError ? (
            <span className="text-[10px] font-mono text-muted-foreground">—</span>
          ) : (
            <div
              className={`h-0.5 w-full rounded bg-muted-foreground/20 ${
                !visible || isLoading ? 'animate-pulse' : ''
              }`}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default RealSparkline;
