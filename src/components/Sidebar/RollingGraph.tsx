import { useEffect, useLayoutEffect, useRef } from "react";

interface Props {
  value: number | null;
  /** Number of samples to retain (default 60 ≈ 5 min at 5 s intervals) */
  capacity?: number;
  height?: number;
  /** Optional label shown in the top-left corner of the graph */
  label?: string;
}

export function RollingGraph({ value, capacity = 60, height = 36, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<number[]>([]);
  const dprRef = useRef(1);

  // Size the canvas to physical pixels once on mount for crisp rendering
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, []);

  useEffect(() => {
    if (value != null) {
      bufferRef.current = [...bufferRef.current, value].slice(-capacity);
    }
    draw();
  }, [value, capacity]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = dprRef.current;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    ctx.clearRect(0, 0, W, H);

    const data = bufferRef.current;
    if (data.length < 2) return;

    const step = W / (capacity - 1);
    const startX = (capacity - data.length) * step;
    const pad = H * 0.1; // small vertical padding so the line isn't clipped

    const pts = data.map((v, i) => ({
      x: startX + i * step,
      y: pad + (1 - Math.min(v, 100) / 100) * (H - pad * 2),
    }));

    const last = pts[pts.length - 1];
    const first = pts[0];

    // Gradient fill under the line
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(last.x, H);
    ctx.lineTo(first.x, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(167,205,207,0.25)");
    grad.addColorStop(1, "rgba(167,205,207,0.02)");
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = "rgba(167,205,207,0.80)";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const pct = value != null ? `${value.toFixed(0)}%` : null;

  return (
    <div className="relative w-full" style={{ height }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      {label && (
        <div className="absolute top-0.5 left-1 flex items-baseline gap-1 pointer-events-none">
          <span className="text-[9px] text-text-dark leading-none">{label}</span>
          {pct && <span className="text-[9px] text-text-med tabular-nums leading-none">{pct}</span>}
        </div>
      )}
    </div>
  );
}
