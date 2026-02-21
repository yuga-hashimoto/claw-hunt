export function calculateSpeed(latencyMs: number): number {
  const normalized = 1 - latencyMs / 10000;
  return Math.max(0, Math.min(1, normalized));
}

export function estimateQualityFromContent(content: string): number {
  const len = content.trim().length;
  if (len < 80) return 0.35;
  if (len < 200) return 0.55;
  if (len < 400) return 0.7;
  return 0.85;
}

export function computeFinalScore(quality: number, speed: number): number {
  return quality * 0.7 + speed * 0.3;
}
