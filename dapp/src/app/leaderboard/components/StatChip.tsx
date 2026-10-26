import { Skeleton } from "./Skeleton";

/**
 * "83 · Active droppers" pill in the table header.
 *
 * Splits the row evenly on mobile (`flex-1`), natural width at lg where it sits
 * beside the search box. The skeleton matches the value it replaces at BOTH
 * sizes — 16px then 24px — so the chip doesn't change height when data lands.
 */
export function StatChip({
  value,
  label,
  shortLabel,
  loading,
}: {
  value: number;
  label: string;
  shortLabel?: string;
  loading: boolean;
}) {
  return (
    <div className="bg-surface rounded-full py-4 px-4 lg:px-6 flex items-center justify-center lg:justify-start gap-x-1 lg:gap-x-4 flex-1 lg:flex-none min-w-0">
      {loading ? (
        <Skeleton className="h-4 lg:h-[24px] w-8 lg:w-10 shrink-0 bg-white" />
      ) : (
        <span className="text-heading text-base/none lg:text-2xl/none shrink-0">
          {value.toLocaleString("en-US")}
        </span>
      )}
      <span className="text-sm/none lg:text-base/none text-nav-muted truncate">
        {shortLabel ? (
          <>
            <span className="lg:hidden">{shortLabel}</span>
            <span className="hidden lg:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
    </div>
  );
}
