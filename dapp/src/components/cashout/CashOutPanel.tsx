"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import {
  X, Loader2, Check, Plus, ChevronLeft, ChevronDown, ChevronRight, Search, Landmark, AlertCircle, Clock,
} from "lucide-react";
import { useSheetDrag } from "@/hooks/useSheetDrag";
import { useEscapeLayer, useFocusReturn } from "@/components/ui/layers";
import { formatG$ } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { formatNaira, splitAmount, GOODDROPS_FEE_PERCENT, type Bank, type CashOutView, type Quote } from "@/lib/goodcash";
import { forgetAccount, loadSavedAccounts, rememberAccount, useCashOut, type SavedAccount, type Setup } from "@/hooks/useCashOut";

interface Props {
  address: `0x${string}`;
  balance: bigint;
  onClose: () => void;
}

type Step = "amount" | "bank" | "banks" | "review";

const BTN = "shrink-0 w-full h-12 rounded-full bg-brand text-white text-[15px]/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 transition-colors disabled:bg-[#A4A4A4] disabled:cursor-not-allowed";
const INPUT = "w-full border border-line h-12 px-5 text-[15px]/none rounded-full placeholder:text-nav-muted text-heading outline-none focus:border-brand transition-colors disabled:opacity-60";

/** Plain decimal G$ from wei, whole G$ only (cash outs don't need cents). */
const wholeG = (wei: bigint) => (wei / 10n ** 18n).toString();
/** A plain number of G$ for display, e.g. 12,500 or 12,500.5. */
const fmtG = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
/** 50000.5 → "50,000.5" for display only; the value itself stays plain. */
const groupDigits = (v: string) => { const [w, f] = v.split("."); return (w ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? `.${f}` : ""); };
const cleanAmount = (v: string) => v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^(\d*\.\d{0,2}).*$/, "$1");

/**
 * Cash out: G$ from the wallet to the person's own Nigerian bank account.
 * Amount → bank → review → live progress. Every fee is shown before they
 * confirm, the bank's own name for the account is shown before they confirm,
 * and once money has moved there is no "try again", only progress.
 */
export function CashOutPanel({ address, balance, onClose }: Props) {
  const flow = useCashOut();
  const { phase } = flow;
  const busy = phase.kind === "creating" || phase.kind === "signing" || phase.kind === "toppingUp"
    || phase.kind === "sending" || phase.kind === "checking";
  const busyRef = useRef(false);
  busyRef.current = busy;
  const { sheetRef, sheetStyle, handleProps } = useSheetDrag({ onDismiss: () => { if (!busyRef.current) onClose(); } });
  useEscapeLayer(true, () => { if (!busyRef.current) onClose(); });
  useFocusReturn(true, sheetRef);

  const [setup, setSetup] = useState<Setup | null>(null);
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [quoting, setQuoting] = useState(false);

  // Open: load limits + banks, and pick up a cash out still in flight.
  useEffect(() => {
    track("cashout_opened");
    void flow.resume();
    fetch(`/api/cashout/setup?wallet=${address}`)
      .then((r) => r.json())
      .then((d: Setup) => setSetup(d))
      .catch(() => setSetup({ enabled: true, error: "You seem to be offline. Check your connection and try again." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Live quote as they type (and fresh every 25 s while they look at it).
  const amountNum = Number(amount);
  // What they type is the total leaving their wallet: our 1% plus what GoodCash converts.
  const { cashG, feeG } = useMemo(() => (amountNum > 0 ? splitAmount(amount) : { cashG: "", feeG: "0" }), [amount, amountNum]);
  const quoteTick = useQuoteTick(step === "review" || step === "amount");
  useEffect(() => {
    setQuoteErr("");
    if (!amount || !(amountNum > 0) || !setup?.enabled) { setQuote(null); return; }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cashout/quote?amountG=${encodeURIComponent(cashG)}`);
        const d = await r.json();
        if (cancelled) return;
        if (r.ok) setQuote(d as Quote);
        else { setQuote(null); setQuoteErr(d.error ?? "Couldn't get a price. Try again."); }
      } catch { if (!cancelled) setQuoteErr("You seem to be offline."); }
      finally { if (!cancelled) setQuoting(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [amount, amountNum, cashG, setup?.enabled, quoteTick]);

  // ── Bank account ────────────────────────────────────────────────────────────
  // Saved accounts (on this device). `picked` is the saved one in use; null
  // while they add a new account.
  const [saved, setSaved] = useState<SavedAccount[]>(() => loadSavedAccounts(address));
  const [picked, setPicked] = useState<number | null>(() => (loadSavedAccounts(address).length ? 0 : null));
  const [bank, setBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");
  useEffect(() => {
    setAccountName(""); setVerifyErr("");
    if (!bank || accountNumber.length !== 10) return;
    let cancelled = false;
    setVerifying(true);
    fetch("/api/cashout/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankCode: bank.code, accountNumber }),
    })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => { if (cancelled) return; if (ok && d.accountName) setAccountName(d.accountName); else setVerifyErr(d.error ?? "We couldn't check that account. Try again."); })
      .catch(() => { if (!cancelled) setVerifyErr("You seem to be offline."); })
      .finally(() => { if (!cancelled) setVerifying(false); });
    return () => { cancelled = true; };
  }, [bank, accountNumber]);

  const account: SavedAccount | null = picked !== null && saved[picked]
    ? saved[picked]
    : bank && accountName ? { bankCode: bank.code, bankName: bank.name, accountNumber, accountName } : null;

  // ── What stops them continuing ─────────────────────────────────────────────
  const balanceG = Number(formatUnits(balance, 18));
  const amountProblem = (() => {
    if (!amount || !(amountNum > 0)) return "";
    if (amountNum > balanceG) return "That's more G$ than you have.";
    if (setup?.leftTodayG !== undefined && amountNum > setup.leftTodayG) {
      return setup.leftTodayG > 0
        ? `You can cash out up to ${fmtG(setup.leftTodayG)} G$ more today.`
        : "You've reached today's cash-out limit. Come back tomorrow.";
    }
    if (setup?.maximumG && amountNum > setup.maximumG) return `The most you can cash out at once is ${fmtG(setup.maximumG)} G$.`;
    const min = quote?.minimumG ?? setup?.minimumG;
    if (min && Number(cashG) < min) return `The smallest cash out is ${fmtG(Math.ceil(min))} G$.`;
    return "";
  })();
  const amountReady = !!quote && !quoting && !amountProblem && !quoteErr && quote.enough !== false && quote.amountG === cashG;
  const shown = useMemo(() => (quote ? withOurFee(quote, feeG) : null), [quote, feeG]);

  const confirm = () => {
    if (!quote || !account || !setup?.mode) return;
    void flow.start({ amountG: cashG, feeG, quote, account, mode: setup.mode });
  };

  // ── Layout ──────────────────────────────────────────────────────────────────
  const following = phase.kind === "tracking" || phase.kind === "sending" || phase.kind === "checking";
  const title = following ? "Cash out" : step === "banks" ? "Choose your bank" : "Cash out to bank";
  const canGoBack = !following && !busy && step !== "amount";
  const back = () => setStep(step === "banks" ? "bank" : step === "review" ? "bank" : "amount");

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label="Cash out to bank"
      tabIndex={-1}
      className="outline-none bg-white rounded-t-3xl lg:rounded-3xl p-6 flex flex-col gap-y-5 font-sans
        max-h-[88dvh] overflow-y-auto lg:max-h-[calc(100dvh-var(--spacing-nav)-32px)] panel-in-lg"
      style={{ boxShadow: "0px 0px 12px 0px #0000000A", paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))", ...sheetStyle }}
    >
      <div {...handleProps}>
        <span aria-hidden className="lg:hidden block w-9 h-1 mx-auto -mt-2 mb-4 rounded-full bg-line" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {canGoBack && (
              <button type="button" onClick={back} aria-label="Back"
                className="p-1.5 -ml-1 text-black rounded-full bg-surface cursor-pointer hover:opacity-80 transition-opacity">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-base/[100%] text-heading truncate">{title}</h2>
            {setup?.mode === "test" && (
              <span className="shrink-0 py-1 px-2.5 rounded-full bg-streak-bg text-streak text-xs/none">Test mode</span>
            )}
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="p-1.5 text-black rounded-full bg-surface cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {following ? (
        <Progress
          phase={phase}
          naira={phase.kind === "tracking" ? phase.cashOut.naira : (quote?.receive.naira ?? 0)}
          accountName={phase.kind === "tracking" ? (phase.cashOut.accountName ?? account?.accountName) : account?.accountName}
          bankLine={phase.kind === "tracking" && phase.cashOut.bankName ? `${phase.cashOut.bankName} ••${phase.cashOut.accountLast4}` : account ? `${account.bankName} ••${account.accountNumber.slice(-4)}` : ""}
          onDone={onClose}
          onAgain={() => { flow.reset(); setAmount(""); setQuote(null); setStep("amount"); }}
        />
      ) : !setup ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="h-[120px] rounded-3xl bg-surface animate-pulse" />
          <div className="h-14 rounded-full bg-surface animate-pulse" />
        </div>
      ) : !setup.enabled ? (
        <Notice title="Cash out is coming soon" body="You'll be able to send G$ straight to your bank account from here." />
      ) : setup.error ? (
        <Notice title="Cash out is busy" body={setup.error} />
      ) : step === "amount" ? (
        <>
          <div className="flex flex-col items-center gap-3 pt-2">
            <label htmlFor="cashout-amount" className="text-sm/none text-nav-muted">You cash out</label>
            <div className="flex items-baseline justify-center gap-2 w-full">
              <input
                id="cashout-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={groupDigits(amount)}
                onChange={(e) => setAmount(cleanAmount(e.target.value.replace(/,/g, "")))}
                className="min-w-0 max-w-full text-center text-[34px]/none text-heading outline-none placeholder:text-[#C9C9C9] bg-transparent"
                style={{ width: `${Math.max(2, groupDigits(amount || "0").length + 0.5)}ch` }}
                autoFocus
              />
              <span className="text-lg/none text-nav-muted">G$</span>
            </div>
            <div className="flex items-center gap-3 text-sm/none">
              <span className="text-nav-muted">Balance: {formatG$(balance)} G$</span>
              <button type="button" onClick={() => setAmount(wholeG(balance))}
                className="bg-brand-soft rounded-full py-1.5 px-3 text-brand cursor-pointer hover:opacity-80 transition-opacity">
                Max
              </button>
            </div>
          </div>

          <QuoteCard quote={shown} loading={quoting && !!amount} error={amountProblem || quoteErr} empty={!amount} />

          <button className={BTN} disabled={!amountReady} onClick={() => setStep("bank")}>Continue</button>
          <p className="text-center text-xs/[145%] text-nav-muted -mt-2">
            Paid to your Nigerian bank account, usually in minutes.
            {setup.leftTodayG !== undefined && setup.leftTodayG < (setup.dailyCapG ?? Infinity) && ` ${fmtG(setup.leftTodayG)} G$ left today.`}
          </p>
          <RecentCashOuts wallet={address} onOpen={flow.open} />
        </>
      ) : step === "bank" ? (
        <>
          {picked !== null ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm/none text-nav-muted">Send it to</p>
              <ul className="flex flex-col gap-2.5">
                {saved.map((a, i) => (
                  <li key={a.bankCode + a.accountNumber} className="relative">
                    <button type="button" onClick={() => setPicked(i)} aria-pressed={picked === i}
                      className="w-full text-left cursor-pointer rounded-2xl">
                      <AccountCard account={a} selected={picked === i} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1.5 text-sm/none text-brand cursor-pointer hover:underline">
                  <Plus className="w-4 h-4" /> Add another account
                </button>
                <button type="button"
                  onClick={() => { const list = forgetAccount(address, saved[picked]); setSaved(list); setPicked(list.length ? 0 : null); }}
                  className="text-sm/none text-nav-muted cursor-pointer hover:text-danger">
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <span className="text-sm/none text-nav-muted">Bank</span>
                <button type="button" onClick={() => setStep("banks")}
                  className={`${INPUT} flex items-center justify-between text-left cursor-pointer`}>
                  <span className={bank ? "text-heading truncate" : "text-nav-muted"}>{bank?.name ?? "Choose your bank"}</span>
                  <ChevronDown className="w-5 h-5 text-nav-muted shrink-0" />
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <label htmlFor="cashout-account" className="text-sm/none text-nav-muted">Account number</label>
                <div className="relative">
                  <input id="cashout-account" inputMode="numeric" autoComplete="off" placeholder="10 digits" maxLength={10}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className={`${INPUT} pr-14 tracking-[0.08em]`} />
                  {verifying && <Loader2 className="w-5 h-5 animate-spin text-nav-muted absolute top-1/2 right-5 -translate-y-1/2" />}
                </div>
              </div>
              {accountName && bank && (
                <AccountCard account={{ bankCode: bank.code, bankName: bank.name, accountNumber, accountName }} selected />
              )}
              {verifyErr && <p role="status" className="text-sm/[145%] text-danger -mt-1">{verifyErr}</p>}
              {saved.length > 0 && (
                <button type="button" onClick={() => setPicked(0)} className="self-start text-sm/none text-brand cursor-pointer hover:underline">
                  Use a saved account
                </button>
              )}
            </div>
          )}
          <button className={BTN} disabled={!account} onClick={() => {
            if (!account) return;
            // Remember it now, so it's there next time even if they stop here.
            const list = rememberAccount(address, account);
            setSaved(list); setPicked(0); setBank(null); setAccountNumber("");
            flow.reset(); setStep("review");
          }}>Continue</button>
          <p className="text-center text-xs/[145%] text-nav-muted -mt-2">Only send to an account in your own name. Saved accounts stay on this device.</p>
        </>
      ) : step === "banks" ? (
        <BankList banks={setup.banks ?? []} onPick={(b) => { setBank(b); setStep("bank"); }} />
      ) : (
        <Review
          amount={amount}
          quote={shown}
          quoting={quoting}
          account={account}
          phase={phase}
          onConfirm={confirm}
          onChangeAccount={() => setStep("bank")}
          onEditAmount={() => { flow.reset(); setStep("amount"); }}
        />
      )}

      <p className="text-center text-[11px]/none text-nav-muted -mt-1">Powered by GoodCash</p>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

/**
 * The quote as the person should see it: GoodDrops' 1% (taken in G$, valued at
 * the quote's own G$ rate) as the first fee line, then GoodCash's lines.
 */
function withOurFee(q: Quote, feeG: string): Quote {
  // The quote's G$ → naira rate before fees: what the bank gets plus the naira
  // fees, over the G$ left once the G$-priced lines come off.
  const nairaFees = q.fees.reduce((t, f) => t + (typeof f.naira === "number" ? f.naira : 0), 0);
  const gOff = q.fees.reduce((t, f) => t + (typeof f.naira !== "number" && f.amountG ? Number(f.amountG) : 0), 0);
  const base = Number(q.amountG) - gOff;
  const nairaPerG = base > 0 ? (q.receive.naira + nairaFees) / base : 0;
  const priced = q.fees.map((f) => (typeof f.naira === "number" || !f.amountG || !nairaPerG ? f : { ...f, naira: Number(f.amountG) * nairaPerG }));
  const fee = Number(feeG);
  return {
    ...q,
    fees: fee > 0
      ? [{ type: "gooddrops_fee", label: `GoodDrops fee (${GOODDROPS_FEE_PERCENT}%)`, amountG: feeG, ...(nairaPerG ? { naira: fee * nairaPerG } : {}) }, ...priced]
      : priced,
  };
}

/** Bumps every 25 s while `on`, so a quote never goes stale on screen. */
function useQuoteTick(on: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((x) => x + 1), 25_000);
    return () => clearInterval(t);
  }, [on]);
  return n;
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-4">
      <span className="w-12 h-12 rounded-full bg-brand-soft text-brand flex items-center justify-center"><Landmark className="w-6 h-6" /></span>
      <p className="text-base/[120%] text-heading">{title}</p>
      <p className="text-sm/[145%] text-nav-muted max-w-[300px]">{body}</p>
    </div>
  );
}

export function QuoteCard({ quote, loading, error, empty }: { quote: Quote | null; loading: boolean; error: string; empty: boolean }) {
  const [open, setOpen] = useState(false);
  if (error) {
    return (
      <div role="status" className="rounded-2xl bg-surface px-4 py-3.5 flex items-center gap-2.5 text-sm/[145%] text-danger">
        <AlertCircle className="w-5 h-5 shrink-0" /> {error}
      </div>
    );
  }
  const totalFeeNaira = quote ? quote.fees.reduce((s, f) => s + (f.naira ?? 0), 0) : 0;
  return (
    <div className="shrink-0 rounded-2xl bg-surface px-4 py-3.5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm/none text-nav-muted">You receive</span>
        {loading || (!quote && !empty) ? (
          <span className="h-5 w-24 rounded-full bg-line animate-pulse" />
        ) : (
          <span className="text-xl/none text-heading">{quote ? formatNaira(quote.receive.naira) : "₦0"}</span>
        )}
      </div>
      {quote && !loading && (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="flex items-center justify-between text-sm/none text-nav-muted cursor-pointer hover:text-heading">
            <span>Fees {formatNaira(totalFeeNaira)}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && <FeeLines quote={quote} />}
        </>
      )}
    </div>
  );
}

export function FeeLines({ quote, bare }: { quote: Quote; bare?: boolean }) {
  return (
    <ul className={`flex flex-col gap-2 text-[13px]/[130%] ${bare ? "" : "border-t border-line pt-3"}`}>
      {quote.fees.map((f) => (
        <li key={f.type + f.label} className="flex items-start justify-between gap-3">
          <span className="text-nav-muted">{f.label}{typeof f.percent === "number" && f.percent > 0 && !f.label.includes("%") ? ` (${f.percent}%)` : ""}</span>
          <span className="text-heading shrink-0">{typeof f.naira === "number" ? formatNaira(f.naira) : f.amountG ? `${fmtG(Number(f.amountG))} G$` : ""}</span>
        </li>
      ))}
      <li className="flex items-start justify-between gap-3">
        <span className="text-nav-muted">Network fee</span>
        <span className="text-heading shrink-0">Free</span>
      </li>
      {quote.nairaPerDollar > 0 && (
        <li className="text-xs/[140%] text-nav-muted pt-1">Rate: {formatNaira(quote.nairaPerDollar)} per $1</li>
      )}
    </ul>
  );
}

export function AccountCard({ account, selected }: { account: SavedAccount; selected?: boolean }) {
  return (
    <div className={`shrink-0 rounded-2xl px-4 py-3 flex items-center gap-3 border ${selected ? "border-brand bg-brand-soft/40" : "border-line"}`}>
      <span className="w-9 h-9 rounded-full bg-white border border-line flex items-center justify-center shrink-0">
        <Landmark className="w-4 h-4 text-heading" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px]/[125%] text-heading line-clamp-2 break-words">{account.accountName}</p>
        <p className="text-sm/[130%] text-nav-muted mt-0.5">{account.bankName} ••{account.accountNumber.slice(-4)}</p>
      </div>
      {selected && (
        <span className="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center shrink-0"><Check className="w-3 h-3" strokeWidth={3} /></span>
      )}
    </div>
  );
}

export function BankList({ banks, onPick }: { banks: Bank[]; onPick: (b: Bank) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = [...banks].sort((a, b) => a.name.localeCompare(b.name));
    return s ? all.filter((b) => b.name.toLowerCase().includes(s)) : all;
  }, [banks, q]);
  const popular = q ? [] : banks.filter((b) => b.popular);
  const row = (b: Bank) => (
    <li key={b.code}>
      <button type="button" onClick={() => onPick(b)}
        className="w-full flex items-center justify-between gap-3 py-3 px-1 text-left text-[15px]/[120%] text-heading cursor-pointer hover:text-brand">
        <span className="truncate">{b.name}</span>
        <ChevronRight className="w-4 h-4 text-nav-muted shrink-0" />
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="w-4 h-4 text-nav-muted absolute left-5 top-1/2 -translate-y-1/2" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search banks" aria-label="Search banks"
          className={`${INPUT} pl-12`} />
      </div>
      {popular.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {popular.map((b) => (
            <button key={b.code} type="button" onClick={() => onPick(b)}
              className="py-2 px-3.5 rounded-full bg-surface text-[13px]/none text-heading cursor-pointer hover:bg-brand-soft hover:text-brand transition-colors">
              {b.name}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-sm/[145%] text-nav-muted py-4 text-center">No bank matches &ldquo;{q}&rdquo;.</p>
      ) : (
        <ul className="divide-y divide-line max-h-[44dvh] overflow-y-auto">{list.map(row)}</ul>
      )}
    </div>
  );
}

export function Review({ amount, quote, quoting, account, phase, onConfirm, onChangeAccount, onEditAmount }: {
  amount: string; quote: Quote | null; quoting: boolean; account: SavedAccount | null;
  phase: ReturnType<typeof useCashOut>["phase"];
  onConfirm: () => void; onChangeAccount: () => void; onEditAmount: () => void;
}) {
  const working = phase.kind === "creating" || phase.kind === "signing" || phase.kind === "toppingUp";
  const error = phase.kind === "error" ? phase.message : "";
  const limitHit = phase.kind === "error" && (phase.code === "daily_limit" || phase.code === "amount_too_large" || phase.code === "amount_too_small");
  if (!quote || !account) return null;
  return (
    <>
      <div className="flex flex-col items-center text-center gap-2 pt-1">
        <span className="text-sm/none text-nav-muted">You&apos;ll receive</span>
        <span className="text-[30px]/none text-heading">{formatNaira(quote.receive.naira)}</span>
      </div>
      <div className="shrink-0 rounded-2xl border border-line divide-y divide-line">
        <div className="px-4 py-3.5 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm/none text-nav-muted">To</span>
            {!working && <button type="button" onClick={onChangeAccount} className="text-sm/none text-brand cursor-pointer hover:underline">Change</button>}
          </div>
          <p className="text-[15px]/[130%] text-heading break-words">{account.accountName}</p>
          <p className="text-sm/[130%] text-nav-muted">{account.bankName} ••{account.accountNumber.slice(-4)}</p>
        </div>
        <Row label="You send" value={`${fmtG(Number(amount))} G$`} action={!working ? { label: "Edit", onClick: onEditAmount } : undefined} />
        <div className="px-4 py-3.5"><FeeLines quote={quote} bare /></div>
      </div>

      <div className="flex flex-col gap-3">
        <button className={BTN} onClick={limitHit ? onEditAmount : onConfirm} disabled={working || quoting}>
          {working && <Loader2 className="w-5 h-5 animate-spin" />}
          {phase.kind === "creating" ? "Getting your cash out ready…"
            : phase.kind === "toppingUp" ? "Getting things ready…"
            : phase.kind === "signing" ? "Confirm in your wallet…"
            : limitHit ? "Change amount"
            : error ? "Try again"
            : `Cash out ${formatNaira(quote.receive.naira)}`}
        </button>
        {error ? (
          <p role="status" className="text-sm/[145%] text-danger text-center">{error}</p>
        ) : (
          <p className="text-xs/[145%] text-nav-muted text-center flex items-center justify-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Arrives in your bank in minutes
          </p>
        )}
      </div>
    </>
  );
}

function Row({ label, value, action }: { label: string; value: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="px-4 py-3.5 flex items-center justify-between gap-4">
      <span className="text-sm/none text-nav-muted shrink-0">{label}</span>
      <div className="flex items-center gap-3 min-w-0 text-[15px]/none text-heading">
        <span className="min-w-0">{value}</span>
        {action && (
          <button type="button" onClick={action.onClick} className="text-sm/none text-brand cursor-pointer hover:underline shrink-0">{action.label}</button>
        )}
      </div>
    </div>
  );
}

export function Progress({ phase, naira, accountName, bankLine, onDone, onAgain }: {
  phase: ReturnType<typeof useCashOut>["phase"]; naira: number; accountName?: string; bankLine: string;
  onDone: () => void; onAgain: () => void;
}) {
  const c: CashOutView | null = phase.kind === "tracking" ? phase.cashOut : null;
  const status = c?.status ?? "sent";
  const paid = status === "paid";
  const bad = status === "failed" || status === "refunded" || status === "expired";

  if (bad) {
    const body = status === "refunded" || status === "failed"
      ? "The bank couldn't be paid, so your money was sent back to your wallet in dollars (USDT). It's safe there."
      : "This cash out closed before anything was sent. Nothing left your wallet.";
    return (
      <div className="flex flex-col items-center text-center gap-5 py-2">
        <span className="w-12 h-12 rounded-full bg-surface text-heading flex items-center justify-center"><AlertCircle className="w-6 h-6" /></span>
        <div className="flex flex-col gap-2">
          <p className="text-base/[120%] text-heading">{status === "expired" ? "Cash out closed" : "Your bank wasn't paid"}</p>
          <p className="text-sm/[150%] text-nav-muted max-w-[320px]">{body}</p>
        </div>
        <button className={BTN} onClick={onAgain}>Start a new cash out</button>
      </div>
    );
  }

  const steps = [
    { label: "G$ sent", done: phase.kind === "tracking" && status !== "awaiting_signature" },
    { label: "Your bank is being paid", done: paid },
    { label: "Paid", done: paid },
  ];
  const activeIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="flex flex-col gap-5" role="status" aria-live="polite">
      <div className="flex flex-col items-center text-center gap-3 pt-1">
        <span className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${paid ? "bg-brand text-white" : "bg-brand-soft text-brand"}`}>
          {paid ? <Check className="w-6 h-6" strokeWidth={2.25} /> : <Loader2 className="w-6 h-6 animate-spin" />}
        </span>
        <span className="text-[28px]/none text-heading">{formatNaira(naira)}</span>
        <div className="flex flex-col items-center gap-1 text-sm/[145%] text-nav-muted">
          <span>{paid ? "has been paid to" : phase.kind === "checking" ? "Checking on your cash out…" : "on its way to"}</span>
          {accountName && phase.kind !== "checking" && (
            <>
              <span className="text-[15px]/[130%] text-heading">{accountName}</span>
              {bankLine && <span>{bankLine}</span>}
            </>
          )}
        </div>
      </div>

      <ol className="flex flex-col gap-3.5 px-1">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${s.done ? "bg-brand text-white" : i === activeIdx ? "bg-brand-soft text-brand" : "bg-surface text-nav-muted"}`}>
              {s.done ? <Check className="w-3 h-3" strokeWidth={3} /> : i === activeIdx ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
            </span>
            <span className={`text-[15px]/none ${s.done || i === activeIdx ? "text-heading" : "text-nav-muted"}`}>{s.label}</span>
          </li>
        ))}
      </ol>

      {paid ? (
        <button className={BTN} onClick={onDone}>Done</button>
      ) : (
        <p className="text-xs/[150%] text-nav-muted text-center -mt-2">
          {phase.kind === "checking"
            ? "Don't send it again. We're making sure your G$ went through."
            : "This usually takes a few minutes. You can close this, it keeps going."}
        </p>
      )}
    </div>
  );
}

export function RecentCashOuts({ wallet, onOpen }: { wallet: string; onOpen: (c: CashOutView) => void }) {
  const [list, setList] = useState<CashOutView[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cashout?wallet=${wallet}`).then((r) => r.json()).then((d) => { if (!cancelled) setList((d.data ?? []).filter((c: CashOutView) => c.status !== "awaiting_signature" && c.status !== "expired").slice(0, 3)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [wallet]);
  if (!list || list.length === 0) return null;
  const label: Record<string, string> = { sent: "On its way", processing: "On its way", paid: "Paid", failed: "Returned", refunded: "Returned" };
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-5">
      <p className="text-sm/none text-nav-muted mb-1">Recent</p>
      {list.map((c) => (
        <button key={c.id} type="button" onClick={() => onOpen(c)}
          className="flex items-center justify-between gap-3 py-2 text-left cursor-pointer hover:opacity-80">
          <span className="min-w-0">
            <span className="block text-[15px]/[130%] text-heading">{formatNaira(c.naira)}</span>
            <span className="block text-xs/[130%] text-nav-muted">{fmtG(Number(c.amountG))} G$ · {new Date(c.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</span>
          </span>
          <span className={`text-xs/none py-1.5 px-2.5 rounded-full shrink-0 ${c.status === "paid" ? "bg-brand-soft text-brand" : c.status === "failed" || c.status === "refunded" ? "bg-surface text-heading" : "bg-streak-bg text-streak"}`}>
            {label[c.status] ?? c.status}
          </span>
        </button>
      ))}
    </div>
  );
}

export default CashOutPanel;
