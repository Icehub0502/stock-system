import React, { useEffect, useRef, useState } from 'react';

// Canvas-based signature capture — pointer events cover mouse, touch, and
// pen in one code path (no separate touchstart/mousedown handling needed),
// which is what makes this work the same on a shop iPad, phone, or a
// desktop with a mouse.
export default function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    // Backing store at 2x so the signature isn't blurry/pixelated once
    // printed at a larger size than the on-screen pad.
    const ratio = 2;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
  }, []);

  const getPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
  };

  const handlePointerMove = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const point = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    if (!hasSignature) setHasSignature(true);
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    if (hasSignature) onChange?.(canvasRef.current.toDataURL('image/png'));
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onChange?.(null);
  };

  return (
    <div style={styles.wrap}>
      <canvas
        ref={canvasRef}
        style={styles.canvas}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {!hasSignature && <div style={styles.placeholder}>เซ็นชื่อในกรอบนี้</div>}
      <button type="button" style={styles.clearBtn} onClick={handleClear}>
        ล้าง
      </button>
    </div>
  );
}

const styles = {
  wrap: { position: 'relative', width: '100%' },
  canvas: {
    width: '100%',
    height: 220,
    display: 'block',
    background: '#fff',
    border: '1.5px dashed #d1d5db',
    borderRadius: 12,
    touchAction: 'none',
    cursor: 'crosshair',
  },
  placeholder: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#c4c9d2',
    fontSize: 14,
    pointerEvents: 'none',
  },
  clearBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 12.5,
    fontWeight: 600,
    color: '#374151',
    cursor: 'pointer',
  },
};
