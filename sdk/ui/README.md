# Primitives UI publiques

`sdk/ui/index.ts` expose `cn`, Button, Badge, Card, Select, Tabs, Toaster et `toast` aux modules natifs et à l'hôte. Les primitives sont adaptées des sources de référence `packages/shell-ui/ui/primitives/` du Creezio original ; `Button` et `cn` ont été extraits des composants déjà repris dans `admin/workspace/`, dont les anciens imports restent compatibles.

`SelectContent` accepte `portalContainer` pour rendre ses menus dans le portail du panneau workspace retenu. La navigation et les droits restent ceux du SDK workspace/access ; ces éléments visuels ne donnent aucune permission et ne construisent aucune route métier.
