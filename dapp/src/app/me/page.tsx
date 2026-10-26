"use client";
import { useAccount } from "wagmi";
import { Nav } from "@/components/Nav";
import { OwnProfile } from "@/components/profile/OwnProfile";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { useAuth } from "@/hooks/useAuth";

/**
 * /me — your own profile. A stable URL for "my profile" links that don't want
 * to know the address. Signed out, it asks you to sign in rather than
 * redirecting, so the page you land on is the page you asked for.
 */
export default function MePage() {
  const { address } = useAccount();
  const { authenticated, login, ready } = useAuth();
  const connected = authenticated && !!address;

  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-20">
          {connected ? (
            <OwnProfile address={address} />
          ) : (
            <>
              <h1 className="text-[32px]/none lg:text-4xl/none text-heading mb-6">Profile</h1>
              <div
                className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6
                  flex flex-col items-center text-center gap-y-4 mx-auto w-full max-w-[400px]"
              >
                {!ready ? (
                  <>
                    <Skeleton className="w-[60px] h-[60px]" />
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-56" />
                  </>
                ) : (
                  <>
                    <p className="text-xl/none text-heading">Sign in to see your profile</p>
                    <p className="text-sm/[140%] text-nav-muted">
                      Your stats, badges, streak and invite link live here.
                    </p>
                    <button
                      type="button"
                      onClick={() => login()}
                      className="mt-2 h-12 px-6 rounded-full bg-brand text-white text-base/none cursor-pointer
                        motion-safe:transition-opacity hover:opacity-90"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
