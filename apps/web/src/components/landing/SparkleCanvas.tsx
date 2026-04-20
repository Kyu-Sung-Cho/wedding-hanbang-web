"use client";

import { useEffect, useRef } from "react";

interface Sparkle {
  x: number;
  y: number;
  size: number;
  life: number;
  decay: number;
  vx: number;
  vy: number;
  color: string;
}

export default function SparkleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let sparkles: Sparkle[] = [];
    let animationId: number;

    function resizeCanvas() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function handleMouseMove(e: MouseEvent) {
      for (let i = 0; i < 2; i++) {
        sparkles.push({
          x: e.clientX + (Math.random() - 0.5) * 20,
          y: e.clientY + (Math.random() - 0.5) * 20,
          size: Math.random() * 3 + 1,
          life: 1,
          decay: Math.random() * 0.02 + 0.015,
          vx: (Math.random() - 0.5) * 1,
          vy: (Math.random() - 0.5) * 1 - 0.5,
          color:
            Math.random() > 0.5
              ? "rgba(121,82,82,"
              : "rgba(201,169,110,",
        });
      }
    }
    document.addEventListener("mousemove", handleMouseMove);

    function animate() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      sparkles = sparkles.filter((s) => s.life > 0);
      sparkles.forEach((s) => {
        s.x += s.vx;
        s.y += s.vy;
        s.life -= s.decay;
        const r = Math.max(0, s.size * s.life);
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = s.color + Math.max(0, s.life) * 0.6 + ")";
        ctx!.fill();

        if (s.size > 2 && r > 0.5) {
          ctx!.beginPath();
          ctx!.moveTo(s.x - r * 2, s.y);
          ctx!.lineTo(s.x + r * 2, s.y);
          ctx!.moveTo(s.x, s.y - r * 2);
          ctx!.lineTo(s.x, s.y + r * 2);
          ctx!.strokeStyle = s.color + Math.max(0, s.life) * 0.3 + ")";
          ctx!.lineWidth = 0.5;
          ctx!.stroke();
        }
      });
      animationId = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      document.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed top-0 left-0 w-full h-full pointer-events-none z-[9999]"
    />
  );
}
