import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Creezio',
  description: 'Votre socle d’application modulaire.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
