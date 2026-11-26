import { TELEGRAM_COMMUNITY_URL } from "@/lib/community";

/** Under an error that asks a wallet user to get a top-up: one tap to the community. */
export function GasHelpLink({ message }: { message: string }) {
  if (!/Telegram community/.test(message)) return null;
  return (
    <a
      href={TELEGRAM_COMMUNITY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex h-10 items-center justify-center rounded-full bg-white border border-line px-4 text-sm/none text-heading hover:bg-surface"
    >
      Open the Telegram community
    </a>
  );
}
