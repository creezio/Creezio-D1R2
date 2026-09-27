import type { ReactNode } from 'react';
import '../admin/workspace/styles.css';
import '../admin/workspace/theme/theme.css';
import './globals.css';
import '../sdk/access/styles.css';
import '../sdk/workspace/styles.css';

export const metadata = {
  title: 'Creezio',
  description: 'Votre socle d’application modulaire.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
