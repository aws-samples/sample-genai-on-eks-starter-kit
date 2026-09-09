import type { SVGProps } from "react";

/**
 * Sidebar glyphs, one per section id. 16px stroke icons in currentColor so
 * they inherit the item's ink and need no colour tokens of their own. Inline
 * rather than an icon package: eight glyphs are not worth a dependency, and
 * the collapsed rail is the only place they appear.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Svg(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

/** Gauge — At a Glance. */
const Gauge = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 15a8 8 0 1 1 16 0" />
    <path d="M12 15l4-5" />
    <circle cx="12" cy="15" r="1" fill="currentColor" />
    <path d="M3 19h18" />
  </Svg>
);

/** Globe with cost tick — Network & Cost. */
const Network = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
  </Svg>
);

/** Bolt — LLM Performance. */
const Bolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 3L5 14h6l-1 7 9-12h-6l1-6z" />
  </Svg>
);

/** Stacked layers — Cache Hit Rate. */
const Layers = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Svg>
);

/** Heartbeat trace — L7 RED. */
const Activity = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Svg>
);

/** Connected nodes — Service Map. */
const Graph = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M8 7.5l3 8M16 7.5l-3 8M8.5 6h7" />
  </Svg>
);

/** Chip — GPU & Accelerators. */
const Chip = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
    <rect x="10" y="10" width="4" height="4" />
    <path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4" />
  </Svg>
);

/** Arrow out of a box — Deep Links. */
const ExternalLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);

/** Chevrons for the collapse toggle; `direction` points where the rail will move. */
export const Chevrons = ({ direction, ...p }: IconProps & { direction: "left" | "right" }) => (
  <Svg {...p}>
    {direction === "left" ? <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /> : <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />}
  </Svg>
);

const ICONS: Record<string, (p: IconProps) => React.JSX.Element> = {
  "at-a-glance": Gauge,
  network: Network,
  llm: Bolt,
  cache: Layers,
  l7: Activity,
  "service-map": Graph,
  gpu: Chip,
  links: ExternalLink,
};

/** Icon for a section id; a plain dot for ids the map does not know, so a new section never renders blank. */
export function SectionIcon({ id, ...props }: IconProps & { id: string }) {
  const Icon = ICONS[id];
  if (Icon) return <Icon {...props} />;
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Svg>
  );
}
