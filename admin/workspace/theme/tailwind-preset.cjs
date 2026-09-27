/**
 * Preset Tailwind Creezio — thème générique extrait verbatim du design
 * system kit (gold TF) : accent orange (palette `sky` remappée),
 * neutres `slate` réchauffés (encre #14182f), fond crème via variables CSS.
 * AUCUN métier. CJS volontaire : chargé par tailwind.config (Node/jiti)
 * sans étape de build.
 *
 * Usage marque :
 *   presets: [require("@creezio/shell-ui/tailwind-preset")]
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  theme: {
    extend: {
      keyframes: {
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-4px)" },
          "40%, 80%": { transform: "translateX(4px)" },
        },
        "hub-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(16, 185, 129, 0.35)" },
          "50%": { boxShadow: "0 0 0 6px rgba(16, 185, 129, 0)" },
        },
        "unlock-pulse": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.03)" },
        },
        "mission-win": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(16, 185, 129, 0.2)" },
          "50%": { boxShadow: "0 0 12px 2px rgba(16, 185, 129, 0.35)" },
        },
      },
      animation: {
        shake: "shake 0.4s ease-in-out",
        "hub-pulse": "hub-pulse 1.5s ease-in-out infinite",
        "unlock-pulse": "unlock-pulse 2s ease-in-out infinite",
        "mission-win": "mission-win 2.5s ease-in-out infinite",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Accent (historiquement `sky`) : orange brand — recolore l'UI
        // sans toucher aux composants.
        sky: {
          50: "#fef4ec",
          100: "#fde5d2",
          200: "#fac9a5",
          300: "#f7a86d",
          400: "#f48c41",
          500: "#f0701d",
          600: "#d95f12",
          700: "#b84f10",
          800: "#93400f",
          900: "#78350f",
          950: "#451a03",
        },
        // Neutres : clairs réchauffés (fond crème), foncés tirés vers
        // l'encre #14182f (sidebar sombre).
        slate: {
          50: "#f8f7f4",
          100: "#f0efea",
          200: "#e3e1da",
          300: "#cdccc5",
          400: "#98999b",
          500: "#6b7080",
          600: "#4b5063",
          700: "#383d52",
          800: "#252940",
          900: "#14182f",
          950: "#0d101f",
        },
      },
      fontFamily: {
        serif: ["var(--font-brand-serif)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
