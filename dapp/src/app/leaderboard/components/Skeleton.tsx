/** One shimmering placeholder block. Tokens only, so it restyles with the theme. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-surface ${className}`} aria-hidden />;
}

/** Avatar + two text lines — the shape every leaderboard entry shares. */
export function IdentitySkeleton() {
  return (
    <div className="flex items-center gap-x-4 min-w-0">
      <Skeleton className="w-[46px] h-[46px] shrink-0" />
      <div className="flex flex-col gap-y-4">
        <Skeleton className="h-[18px] w-28" />
        <Skeleton className="h-[14px] w-16" />
      </div>
    </div>
  );
}

export function AmountSkeleton() {
  return (
    <div className="flex flex-col gap-y-4 items-end shrink-0">
      <Skeleton className="h-[18px] w-16" />
      <Skeleton className="h-[14px] w-8" />
    </div>
  );
}
