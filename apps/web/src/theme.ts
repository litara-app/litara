import { createTheme, defaultVariantColorsResolver, type VariantColorsResolver } from "@mantine/core";

// Mantine's default light/outline/subtle text colors and its "dimmed" gray fall
// below WCAG AA (4.5:1) on white. Darken them in light mode and keep Mantine's
// own lighter values in dark mode.
const resolver: VariantColorsResolver = (input) => {
  const base = defaultVariantColorsResolver(input);
  const name = input.color ?? "";
  if (!["light", "outline", "subtle"].includes(input.variant) || !input.theme.colors[name]) return base;
  const text = `light-dark(color-mix(in srgb, var(--mantine-color-${name}-9) 55%, black), var(--mantine-color-${name}-3))`;
  return { ...base, color: text, hover: base.hover };
};

export const theme = createTheme({
  primaryShade: { light: 8, dark: 6 },
  variantColorResolver: resolver,
});
