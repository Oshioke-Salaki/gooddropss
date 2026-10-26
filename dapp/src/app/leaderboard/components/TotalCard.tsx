import { Skeleton } from "./Skeleton";

/** Headline stat beside the toggle: total G$ dropped or claimed. */
export function TotalCard({
  value,
  label,
  loading,
}: {
  value: string;
  label: string;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-full py-4 px-6 lg:p-5 flex items-center justify-center gap-x-2 shrink-0 w-full text-center lg:w-fit mx-auto lg:mx-0">
      {loading ? (
        <Skeleton className="h-[28px] w-32" />
      ) : (
        <h3 className="text-sm/none lg:text-lg/none text-heading whitespace-nowrap">
          {value} G$
        </h3>
      )}
      <h5 className="text-nav-muted text-xs/none lg:text-base/none whitespace-nowrap">
        {label}
      </h5>
    </div>
  );
}
