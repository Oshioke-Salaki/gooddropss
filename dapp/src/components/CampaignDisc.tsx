"use client";
import { useState } from "react";
import type { Campaign } from "@/types";

/**
 * Campaign logo on a disc tinted with the campaign's colour, falling back to
 * its initial. Shared by the sponsor page and the batch creator so the two can
 * never draw the same campaign differently.
 */
export function CampaignDisc({ campaign, size = 48 }: { campaign: Campaign; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full text-heading"
      style={{ width: size, height: size, background: `${campaign.color}33`, fontSize: Math.round(size * 0.4), lineHeight: 1 }}
      aria-hidden
    >
      {campaign.logo && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={campaign.logo}
          alt=""
          width={size}
          height={size}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        campaign.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
