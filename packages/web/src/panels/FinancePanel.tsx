/**
 * FinancePanel — lists market instruments from /api/markets
 * with sparkline history from /api/markets/:symbol.
 *
 * Explicit loading / empty / error states.
 * Responsive: drawer on mobile, sidebar on desktop (via CSS only).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMarkets,
  getMarketTrend,
  type MarketInstrument,
  type PricePoint,
} from '../api/client';

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

interface SparklineProps {
  symbol: string;
}

type SparklineState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ok'; points: PricePoint[] };

function Sparkline({ symbol }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<SparklineState>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    let cancelled = false;

    getMarketTrend(symbol)
      .then((points) => {
        if (cancelled) return;
        if (points.length === 0) {
          setState({ status: 'empty' });
        } else {
          setState({ status: 'ok', points });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => { cancelled = true; };
  }, [symbol]);

  // Draw sparkline on canvas whenever points change
  useEffect(() => {
    if (state.status !== 'ok') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { points } = state;
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // Determine trend color
    const firstPrice = prices[0] ?? 0;
    const lastPrice = prices[prices.length - 1] ?? 0;
    const isPositive = lastPrice >= firstPrice;
    const lineColor = isPositive ? '#22c55e' : '#ef4444';
    const fillColor = isPositive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';

    // Build path
    const toX = (i: number) => (i / (prices.length - 1)) * w;
    const toY = (p: number) => h - ((p - min) / range) * (h - 4) - 2;

    ctx.beginPath();
    prices.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(i), toY(p));
      else ctx.lineTo(toX(i), toY(p));
    });

    // Fill under line
    ctx.lineTo(toX(prices.length - 1), h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    prices.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(i), toY(p));
      else ctx.lineTo(toX(i), toY(p));
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [state]);

  if (state.status === 'loading') {
    return <div className="sparkline-loading">Loading chart...</div>;
  }
  if (state.status === 'error' || state.status === 'empty') {
    return <div className="sparkline-loading">No chart data</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      className="sparkline-canvas"
      aria-label={`Price history for ${symbol}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Instrument card
// ---------------------------------------------------------------------------

interface InstrumentCardProps {
  instrument: MarketInstrument;
  selected: boolean;
  onClick: () => void;
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function InstrumentCard({ instrument, selected, onClick }: InstrumentCardProps) {
  const changeClass =
    instrument.changePercent > 0
      ? 'positive'
      : instrument.changePercent < 0
      ? 'negative'
      : 'neutral';

  const sign = instrument.changePercent >= 0 ? '+' : '';

  return (
    <div
      className={`instrument-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${instrument.symbol} — ${instrument.name}`}
    >
      <div className="instrument-card__header">
        <div>
          <div className="instrument-card__symbol">{instrument.symbol}</div>
          <div className="instrument-card__name">{instrument.name}</div>
        </div>
        <div>
          <div className="instrument-card__price">
            {formatPrice(instrument.price, instrument.currency)}
          </div>
          <div className={`instrument-card__change ${changeClass}`}>
            {sign}{instrument.changePercent.toFixed(2)}%
          </div>
        </div>
      </div>
      {selected && (
        <div className="sparkline-area">
          <div className="sparkline-title">30-day trend</div>
          <Sparkline symbol={instrument.symbol} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FinancePanel
// ---------------------------------------------------------------------------

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; instruments: MarketInstrument[] };

export default function FinancePanel() {
  const [panelState, setPanelState] = useState<PanelState>({ status: 'loading' });
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const load = useCallback(() => {
    setPanelState({ status: 'loading' });
    getMarkets()
      .then((instruments) => {
        if (instruments.length === 0) {
          setPanelState({ status: 'empty' });
        } else {
          setPanelState({ status: 'ok', instruments });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setPanelState({ status: 'error', message });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSelect = (symbol: string) => {
    setSelectedSymbol((prev) => (prev === symbol ? null : symbol));
  };

  return (
    <div className="finance-panel">
      <h2 className="finance-panel__heading">Markets</h2>

      {panelState.status === 'loading' && (
        <div className="state-loading" role="status" aria-label="Loading markets">
          <div className="spinner" aria-hidden="true" />
          <span>Loading markets...</span>
        </div>
      )}

      {panelState.status === 'error' && (
        <div className="state-error" role="alert">
          <div className="state-error__title">Failed to load markets</div>
          <div>{panelState.message}</div>
          <button className="state-error__retry" onClick={load} type="button">
            Retry
          </button>
        </div>
      )}

      {panelState.status === 'empty' && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">--</div>
          <div>No market data available</div>
          <div>The data source may be temporarily unavailable.</div>
        </div>
      )}

      {panelState.status === 'ok' && (
        <ul className="instrument-list" role="list">
          {panelState.instruments.map((inst) => (
            <li key={inst.symbol} style={{ listStyle: 'none' }}>
              <InstrumentCard
                instrument={inst}
                selected={selectedSymbol === inst.symbol}
                onClick={() => handleSelect(inst.symbol)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
