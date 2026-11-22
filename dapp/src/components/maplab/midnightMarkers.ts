// Midnight's look for the map's own markers and controls (drops, clusters,
// landmarks, events, zoom, My location). The real map builds them in
// components/map/markers.ts and MapView; this restyles them only inside the lab
// page's `.gd-midnight .gd-lab-map`, so no other map, sheet or page changes.
//
//   • Glass pills: dark midnight glass with a faint blue edge.
//   • Value and count chips (inside pills only): gold, because they are the
//     treasure. Your own location dot stays blue: you are not treasure.
//   • Landmark pins: brand blue instead of red.
//   • Controls: the same dark glass, so nothing white shouts over the night.
//   • Touch: markers lift and glow under the pointer and press in when tapped,
//     so everything on the map invites a tap.
//
// When Midnight graduates to the real map this becomes a proper theme prop on
// those components; scoped CSS keeps the lab from touching them meanwhile.

export const MIDNIGHT_SCOPE = "gd-midnight";
export const LAB_MAP = "gd-lab-map";

const S = `.${MIDNIGHT_SCOPE} .${LAB_MAP}`;
const PILL = `[class*="bg-[#FFFFFF33]"]`;
const GLASS = "background:rgba(8,12,40,.72)!important;box-shadow:0 0 0 1px rgba(111,148,255,.22),0 8px 22px rgba(0,0,0,.45)!important;backdrop-filter:blur(14px)";

export const MIDNIGHT_MARKER_CSS = `
${S} .maplibregl-marker ${PILL}{${GLASS}}
${S} .maplibregl-marker ${PILL} [style*="background:#"],
${S} .maplibregl-marker ${PILL} .bg-brand{
  background:linear-gradient(180deg,#FFE9A8,#FFC23D)!important;border-color:#FFB400!important;color:#3A2600!important;
  box-shadow:0 0 10px rgba(255,180,0,.45)}
${S} .maplibregl-marker img[src="/location-pin.svg"]{
  filter:hue-rotate(215deg) saturate(1.5) brightness(1.15) drop-shadow(0 0 6px rgba(47,91,255,.6))}

${S} .maplibregl-marker:not(.gd-beam-root)>div{transition:transform .28s cubic-bezier(.2,.9,.25,1.2),filter .28s ease}
@media (hover:hover){
  ${S} .maplibregl-marker:not(.gd-beam-root):hover{z-index:5}
  ${S} .maplibregl-marker:not(.gd-beam-root):hover>div{transform:translateY(-3px) scale(1.06);filter:drop-shadow(0 8px 16px rgba(255,180,0,.35))}
}
${S} .maplibregl-marker:not(.gd-beam-root):active>div{transform:scale(.96);transition-duration:.08s}

${S} .bg-nav-controls{background:rgba(8,12,40,.78)!important;color:#D6DEFF!important}
${S} .bg-nav-controls:hover{background:rgba(24,34,96,.9)!important}
${S} .bg-\\[\\#CBCBCB\\]{background:rgba(111,148,255,.2)!important;box-shadow:0 8px 22px rgba(0,0,0,.45)}
${S} .bg-surface.border-line{${GLASS};border-color:transparent!important;color:#D6DEFF}
${S} .bg-surface.border-line .text-nav-active,${S} .bg-surface.border-line .text-nav-muted{color:#D6DEFF!important}
${S} .maplibregl-ctrl-attrib{background:rgba(8,12,40,.6)!important;color:#7C8BC8}

@media (prefers-reduced-motion: reduce){${S} .maplibregl-marker>div{transition:none!important}}
`;
