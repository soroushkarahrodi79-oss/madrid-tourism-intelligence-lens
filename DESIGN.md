---
name: Madrid Urban Evidence Lens · Discover
description: The public entrance to Madrid's urban evidence observatory.
colors:
  midnight: "#07111c"
  orbital-dark: "#03080f"
  paper: "#f5f2ea"
  muted: "#d5dee7"
  coral: "#f06445"
  coral-hover: "#ff8a70"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "clamp(5rem, 10.4vw, 10.5rem)"
    fontWeight: 670
    lineHeight: 0.88
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "clamp(1.8rem, 3.8vw, 4.3rem)"
    fontWeight: 520
    lineHeight: 1
    letterSpacing: "-0.027em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(.95rem, 1.25vw, 1.12rem)"
    lineHeight: 1.55
spacing:
  gutter: "clamp(24px, 5vw, 88px)"
components:
  enter-lens:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.midnight}"
    padding: "0 18px"
    height: "52px"
  enter-lens-hover:
    backgroundColor: "{colors.coral-hover}"
---

# Discover design

## Overview

Earth to Madrid is the visual idea for the public Discover landing. Seen first at planetary scale and then from the ISS over Madrid, the city is the subject of a single composition. This guide applies to [Discover](discover/index.html). The analytical workspace has its own visual system.

## Colors

Midnight provides the field for warm paper typography and cooler supporting text. Coral identifies the entry action and the active language. The 2px paper focus outline keeps keyboard location visible independently of those colors.

## Typography

Source Serif 4 gives “MADRID.” its headline scale. A second, lighter serif line completes the title. Inter supports the wordmark, language controls, explanation and links. Both faces use the existing local font files.

## Layout

The landing uses a masthead, an introduction anchored low and left, and a footline for methodology and image credit. Desktop allocates the right side to the city. At 920px and below the image spans the width. At 680px and below the photo occupies the upper field and fades into the stacked text. The composition grows vertically if the text needs more room.

## Elevation & Depth

Depth comes from the scale of the images and translucent washes that protect the type. The optional 2.7-second descent crossfades the globe and the Iberian Peninsula into the static photograph. The copy and links stay in place throughout. Reduced motion and unavailable animation images leave the still composition.

## Components

- **Explore Lens** is the sole filled action, with a flat coral rectangle, an arrow and a 52px minimum height.
- **Language** uses two 44px controls with a coral underline and a pressed state for the current locale.
- **Methodology and credit** sit on a hairline rule as understated, underlined links.

## Do's and Don'ts

Keep a clear area for the title and preserve the direct link to the observatory in each language. Treat the artwork as editorial imagery and retain its [source credits](discover/media/SOURCES.md).
