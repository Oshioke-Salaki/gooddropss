/** Ordinal suffix: 1 → 1st, 2 → 2nd, 3 → 3rd, 4 → 4th, 11 → 11th, 21 → 21st. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const MEDALS = ["/first-medal.svg", "/second-medal.svg", "/third-medal.svg"];

/**
 * The circular rank chip. `highlight` is the brand fill used on your own row.
 *
 * Ranks 1–3 show their medal instead: below lg the podium collapses into
 * ordinary rows, and the medal is what still marks them out.
 */
export function RankBadge({ rank, highlight = false }: { rank: number; highlight?: boolean }) {
  if (rank <= 3 && !highlight) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={MEDALS[rank - 1]}
        alt={ordinal(rank)}
        width={46}
        height={46}
        className="w-20 h-20 lg:w-11.5 lg:h-11.5 shrink-0 object-contain"
      />
    );
  }
  return (
    <div
      className={`font-anta flex justify-center items-center rounded-full w-11.5 h-11.5 text-xs shrink-0 ${
        highlight ? "bg-brand text-white" : "bg-surface text-heading"
      }`}
    >
      {ordinal(rank)}
    </div>
  );
}
