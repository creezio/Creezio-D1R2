import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils.ts";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-slate-900 text-white",
        secondary: "border-transparent bg-slate-100 text-slate-700",
        outline: "border-slate-200 text-slate-700",
        success: "border-transparent bg-emerald-100 text-emerald-800",
        warning: "border-transparent bg-amber-100 text-amber-800",
        danger: "border-transparent bg-red-100 text-red-800",
        info: "border-transparent bg-sky-100 text-sky-800",
        muted: "border-transparent bg-slate-50 text-slate-500",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * <span> et non <div> : un badge est utilisé DANS des <p>, <a> et <span>
 * (fiche produit, dashboard, préférences…). Un <div> y est du HTML invalide :
 * le parseur navigateur restructure le DOM (ferme le <p> avant le div) et
 * l'hydratation React échoue (« Hydration failed » #418/#422, cascade
 * possible en #310) — écran « Application error » dans l'app desktop.
 */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
