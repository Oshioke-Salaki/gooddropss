"use client";
import { Trophy, UserPlus, ArrowRight, CalendarDays } from "lucide-react";
import { coveredReferralSlots, podiumWei, type CompConfig, type RefCompConfig } from "@/lib/competition";
import { Countdown, fmtG, useNow } from "./shared";

// Start/end in WAT: the season is run from Nigeria and every flyer quotes WAT,
// so the page says the same thing whatever the viewer's own clock is.
const when = (sec: number, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", ...opts }).format(new Date(sec * 1000));
const startLabel = (sec: number) =>
  `${when(sec, { weekday: "short", day: "numeric", month: "short" })}, ${when(sec, { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase()} WAT`;
// endsAt is exclusive: a midnight end reads as the day before, "end of Wed 25 Nov".
const endLabel = (sec: number) => when(sec - 1, { weekday: "short", day: "numeric", month: "short" });

/**
 * The run-up to a season: one countdown, the combined prize, and a card per
 * competition that jumps to its board (rules and prizes live there).
 */
export function SeasonRunUp({ points, refs, onPick }: {
  points: CompConfig;
  refs: RefCompConfig;
  onPick: (tab: "points" | "referrals") => void;
}) {
  const now = useNow(); // ticks here only, so the boards below don't re-render each second
  const startsAt = Math.min(points.startsAt, refs.startsAt);
  const endsAt = Math.max(points.endsAt, refs.endsAt);
  const totalWei = (BigInt(points.potWei) + BigInt(refs.potWei) + BigInt(podiumWei(refs))).toString();
  const perRefG = Math.round(Number(refs.perReferralWei) / 1e18);
  const winners = points.tiers.length;
  const slots = coveredReferralSlots(refs);

  return (
    <section
      aria-label="Next competition"
      className="mb-6 rounded-3xl bg-brand text-white p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 lg:gap-10 overflow-hidden"
    >
      <div className="flex flex-col gap-y-5 min-w-0">
        <span className="inline-flex items-center gap-2 self-start rounded-full bg-white/15 px-3.5 py-2.5 text-sm/none">
          <CalendarDays className="w-[18px] h-[18px]" strokeWidth={2} />
          {startLabel(startsAt)} to end of {endLabel(endsAt)}
        </span>
        <div>
          <p className="font-anta text-[40px]/none lg:text-[56px]/none tabular-nums break-words">
            {fmtG(totalWei)} <span className="text-white/70">G$</span>
          </p>
          <p className="text-base/[150%] text-white/80 mt-3 max-w-[460px]">
            Up for grabs across two competitions. Drop, hunt and bring your friends:
            every verified person you reach moves you up.
          </p>
        </div>
        {/* The shared countdown, on a white panel so its tiles keep their contrast. */}
        <div className="bg-white rounded-3xl p-4 text-heading">
          <Countdown phase="upcoming" target={startsAt} now={now} />
        </div>
        <p className="text-sm/[150%] text-white/80">
          Get ready now: verify with GoodDollar and line up your friends. Only activity after the start counts.
        </p>
      </div>

      <div className="flex flex-col gap-4 min-w-0 lg:justify-center">
        <CompCard
          icon={<Trophy className="w-5 h-5" strokeWidth={1.75} />}
          name="Points competition"
          pot={fmtG(points.potWei)}
          lines={[`Top ${winners} share the pot`, "Score by dropping, claiming and referring"]}
          cta="Prizes and rules"
          onClick={() => onPick("points")}
        />
        <CompCard
          icon={<UserPlus className="w-5 h-5" strokeWidth={1.75} />}
          name="Referral competition"
          pot={fmtG(refs.potWei)}
          lines={[
            `${perRefG.toLocaleString()} G$ for every friend who joins`,
            `Unlock at ${refs.threshold} referrals, then paid as you go · ${slots} paid spots`,
          ]}
          cta="How it works"
          onClick={() => onPick("referrals")}
        />
      </div>
    </section>
  );
}

function CompCard({ icon, name, pot, lines, cta, onClick }: {
  icon: React.ReactNode; name: string; pot: string; lines: string[]; cta: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left bg-white text-heading rounded-3xl p-5 flex flex-col gap-y-3 cursor-pointer
        motion-safe:transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      <span className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full bg-brand-soft text-brand flex items-center justify-center shrink-0">{icon}</span>
        <span className="text-base/none">{name}</span>
      </span>
      <span className="text-[28px]/none">{pot} <span className="text-nav-muted">G$</span></span>
      <span className="flex flex-col gap-y-1.5">
        {lines.map((l) => <span key={l} className="text-sm/[145%] text-nav-muted">{l}</span>)}
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm/none text-brand">
        {cta}
        <ArrowRight className="w-4 h-4 motion-safe:transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
      </span>
    </button>
  );
}
