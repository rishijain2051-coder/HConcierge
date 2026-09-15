/**
 * One authored icon set: 24×24, 1.5 stroke, round caps and joins, currentColor.
 * Drawn here rather than pulled from a library so the weight matches Instrument
 * Sans at the sizes we actually use, and so nothing ships as an emoji.
 */

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconHome(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 10.2 12 3.8l8.5 6.4V19a1.3 1.3 0 0 1-1.3 1.3H4.8A1.3 1.3 0 0 1 3.5 19z" />
      <path d="M9.4 20.3v-6h5.2v6" />
    </Icon>
  )
}

/** Dining: a cloche, not cutlery — it reads as room service rather than a restaurant. */
export function IconDining(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.2 16.4a8.8 8.8 0 0 1 17.6 0z" />
      <path d="M2.2 19.6h19.6" />
      <path d="M12 7.6V5.9" />
      <circle cx="12" cy="4.6" r="1.1" />
    </Icon>
  )
}

/** Services: the reception bell the product is replacing. */
export function IconBell(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 17.4a8 8 0 0 1 16 0z" />
      <path d="M2.6 20.4h18.8" />
      <path d="M12 9.4V7.2" />
      <circle cx="12" cy="5.9" r="1.2" />
    </Icon>
  )
}

export function IconInfo(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11.2v5.1" />
      <path d="M12 7.9h.01" />
    </Icon>
  )
}

export function IconChat(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20.3 11.5c0 3.9-3.7 7.1-8.3 7.1a9.6 9.6 0 0 1-2.6-.35L4.6 20l1.1-3.35A6.7 6.7 0 0 1 3.7 11.5c0-3.92 3.72-7.1 8.3-7.1s8.3 3.18 8.3 7.1Z" />
    </Icon>
  )
}

export function IconPlay(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M8.4 5.7 18.2 12l-9.8 6.3z" />
    </Icon>
  )
}

export function IconRestart(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.4 4.6v4.3h-4.3" />
    </Icon>
  )
}

export function IconArrowRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.8 12h14.4" />
      <path d="m13.6 6.4 5.6 5.6-5.6 5.6" />
    </Icon>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m5 12.8 4.6 4.4L19 6.8" />
    </Icon>
  )
}

export function IconAlert(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 4.3 21.2 20H2.8z" />
      <path d="M12 10.4v3.8" />
      <path d="M12 17.1h.01" />
    </Icon>
  )
}


export function IconPhoneOff(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9.3 4.6 5.1 6.2c-.9.35-1.4 1.3-1.2 2.25.5 2.3 1.7 5 3.9 7.2 2.2 2.2 4.9 3.4 7.2 3.9.95.2 1.9-.3 2.25-1.2l1.6-4.2-4-1.9-1.6 2a13 13 0 0 1-4-4l2-1.6z" />
      <path d="M4 20 20 4" />
    </Icon>
  )
}


export function IconReceipt(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 3.6v16.8l2.4-1.6 2.4 1.6 2.4-1.6 2.4 1.6 2.4-1.6V3.6z" />
      <path d="M9.2 8.4h5.6M9.2 12h5.6M9.2 15.6h3.2" />
    </Icon>
  )
}

export function IconMinus(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 12h12" />
    </Icon>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 6v12M6 12h12" />
    </Icon>
  )
}

export function IconChevron(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 9.5 12 15.5 18 9.5" />
    </Icon>
  )
}

export function IconClose(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </Icon>
  )
}

/** Filled when alerts are armed, so the state reads without colour alone. */
export function IconAlarm({ on = false, ...p }: IconProps & { on?: boolean }) {
  return (
    <Icon {...p}>
      <path
        d="M18 16.2V11a6 6 0 1 0-12 0v5.2L4.4 18.4h15.2z"
        fill={on ? 'currentColor' : 'none'}
        fillOpacity={on ? 0.16 : 0}
      />
      <path d="M9.6 21.2a2.6 2.6 0 0 0 4.8 0" />
    </Icon>
  )
}

/** The phone navigation. Three rules at the same stroke as everything else. */
export function IconMenu(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.8 7.2h16.4" />
      <path d="M3.8 12h16.4" />
      <path d="M3.8 16.8h16.4" />
    </Icon>
  )
}
