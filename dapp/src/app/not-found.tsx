import Link from "next/link";
import { Map } from "lucide-react";
import { Nav } from "@/components/Nav";
import { BrandMark } from "@/components/BrandMark";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav px-4 flex items-center justify-center min-h-[calc(100dvh-var(--spacing-nav))]">
        <div className="w-full max-w-[420px] bg-white rounded-3xl p-6 shadow-[0px_0px_12px_0px_#0000000A] flex flex-col items-center text-center">
          <span className="w-16 h-16 rounded-full bg-brand-soft flex items-center justify-center">
            <BrandMark className="w-9 h-9" />
          </span>
          <h1 className="text-xl/none text-heading mt-5">Nothing hidden here</h1>
          <p className="text-sm/[150%] text-nav-muted mt-3">
            This page doesn&apos;t exist, or the drop link has expired. The live drops are on the map.
          </p>
          <Link
            href="/"
            className="mt-6 h-12 px-6 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90"
          >
            <Map className="w-[18px] h-[18px]" strokeWidth={1.75} />
            Back to the map
          </Link>
        </div>
      </div>
    </div>
  );
}
