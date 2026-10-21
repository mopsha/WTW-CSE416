/** 75_000 -> "1:15 left", 2 h 5 min -> "2h 05m left", past -> "Time's up". */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Time’s up';
  const totalSec = Math.ceil(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m left`;
  return `${minutes}:${pad(seconds)} left`;
}
