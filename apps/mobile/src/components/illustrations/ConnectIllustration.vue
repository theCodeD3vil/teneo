<!-- a Mac and a phone linked over the air, the link locked: sync is
     local and encrypted -->
<template>
  <svg viewBox="0 0 200 140" fill="none" aria-hidden="true">
    <ellipse
      cx="100"
      cy="84"
      rx="94"
      ry="50"
      class="illus-swell fill-primary/8" />

    <!-- Mac -->
    <g class="illus-rise" style="--illus-delay: 80ms">
      <rect
        x="24"
        y="40"
        width="88"
        height="58"
        rx="6"
        stroke-width="2"
        class="fill-background stroke-foreground/20" />
      <rect
        x="30"
        y="46"
        width="76"
        height="46"
        rx="3"
        class="fill-primary/10" />
      <rect
        x="37"
        y="53"
        width="40"
        height="6"
        rx="3"
        class="fill-primary/70" />
      <rect
        x="37"
        y="64"
        width="56"
        height="5"
        rx="2.5"
        class="fill-foreground/15" />
      <rect
        x="37"
        y="73"
        width="48"
        height="5"
        rx="2.5"
        class="fill-foreground/15" />
      <rect
        x="37"
        y="82"
        width="32"
        height="5"
        rx="2.5"
        class="fill-foreground/15" />
      <path
        d="M14 100h108a2 2 0 0 1 2 2v1a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5v-1a2 2 0 0 1 2-2Z"
        class="fill-foreground/15" />
      <rect
        x="56"
        y="100"
        width="24"
        height="3"
        rx="1.5"
        class="fill-foreground/20" />
    </g>

    <!-- phone -->
    <g class="illus-rise" style="--illus-delay: 180ms">
      <rect
        x="140"
        y="48"
        width="42"
        height="76"
        rx="8"
        stroke-width="2"
        class="fill-background stroke-foreground/20" />
      <rect
        x="145"
        y="55"
        width="32"
        height="62"
        rx="4"
        class="fill-primary/10" />
      <rect
        x="149"
        y="62"
        width="20"
        height="5"
        rx="2.5"
        class="fill-primary/70" />
      <rect
        x="149"
        y="72"
        width="24"
        height="4"
        rx="2"
        class="fill-foreground/15" />
      <rect
        x="149"
        y="80"
        width="20"
        height="4"
        rx="2"
        class="fill-foreground/15" />
      <rect
        x="149"
        y="88"
        width="14"
        height="4"
        rx="2"
        class="fill-foreground/15" />
    </g>

    <!-- the link, flowing from the Mac to the phone -->
    <g class="illus-swell" style="--illus-delay: 320ms">
      <path
        d="M96 34Q130-4 162 42"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="2 6"
        class="stroke-primary/60 motion-safe:animate-dash-flow" />
    </g>
    <g class="illus-pop" style="--illus-delay: 440ms">
      <circle
        cx="129.5"
        cy="17"
        r="11"
        stroke-width="3"
        class="fill-primary stroke-background" />
      <path
        d="M125.5 16v-3a4 4 0 0 1 8 0v3"
        stroke-width="2"
        class="stroke-primary-foreground" />
      <rect
        x="123.5"
        y="15.5"
        width="12"
        height="9"
        rx="2"
        class="fill-primary-foreground" />
    </g>

    <circle
      cx="58"
      cy="22"
      r="2"
      class="illus-pop fill-primary/40"
      style="--illus-delay: 520ms" />
    <circle
      cx="182"
      cy="30"
      r="3"
      class="illus-pop fill-primary/25"
      style="--illus-delay: 580ms" />
    <circle
      cx="18"
      cy="70"
      r="2"
      class="illus-pop fill-primary/30"
      style="--illus-delay: 640ms" />
  </svg>
</template>
