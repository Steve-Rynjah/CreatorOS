import { Bebas_Neue, Montserrat, Oswald, Outfit, Roboto } from "next/font/google";

/** UI font (same as the Trade Journal app). */
export const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700", "900"], variable: "--font-roboto" });
export const oswald = Oswald({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-oswald" });
export const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-montserrat",
});
export const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas" });

export const fontVariables = [outfit, roboto, oswald, montserrat, bebas].map((f) => f.variable).join(" ");

/** Fonts usable for on-video text. `family` is a CSS font-family list usable by canvas. */
export const TEXT_FONTS: { key: string; label: string; family: string }[] = [
  { key: "roboto", label: "Roboto", family: roboto.style.fontFamily },
  { key: "oswald", label: "Oswald", family: oswald.style.fontFamily },
  { key: "montserrat", label: "Montserrat", family: montserrat.style.fontFamily },
  { key: "bebas", label: "Bebas Neue", family: bebas.style.fontFamily },
  { key: "georgia", label: "Georgia", family: "Georgia, 'Times New Roman', serif" },
  { key: "arial", label: "Arial", family: "Arial, Helvetica, sans-serif" },
];

export function fontFamily(key: string) {
  return (TEXT_FONTS.find((f) => f.key === key) ?? TEXT_FONTS[0]).family;
}

/** Canvas doesn't trigger web-font downloads, so load them explicitly. */
export async function preloadCanvasFonts() {
  if (typeof document === "undefined") return;
  await Promise.all(
    TEXT_FONTS.flatMap((f) => [
      document.fonts.load(`400 40px ${f.family}`),
      document.fonts.load(`700 40px ${f.family}`),
      document.fonts.load(`800 40px ${f.family}`),
      document.fonts.load(`italic 900 40px ${f.family}`),
    ]),
  ).catch(() => {});
}
