import { RuntimeStatus } from './runtime-status';
import { front, nativeAccess } from '../.creezio/generated/client';
import { FrontHost } from './front/host';

export default async function Home({searchParams}: {searchParams: Promise<Record<string,string|string[]|undefined>>}) {
  if (front.kind === 'theme') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (Array.isArray(value)) for (const item of value) query.append(key, item);
      else if (value !== undefined) query.append(key, value);
    }
    return <FrontHost initialUrl={`/${query.size ? `?${query}` : ''}`} />;
  }
  return <main className="welcome">
    <header className="brand"><span className="mark" aria-hidden="true">c</span>Creezio</header>
    <section className="welcome-body">
      <p className="eyebrow">Environnement de développement</p>
      <h1>Votre application<br />commence ici.</h1>
      <p className="intro">Le socle commun est en construction. Cette installation permet de vérifier le démarrage de l’application et ses connexions de stockage.</p>
      <RuntimeStatus />
      <nav className="access-links" aria-label="Connexion">
        {nativeAccess.admin && <a href="/workspace/admin">Ouvrir le workspace Creezio</a>}
        {nativeAccess.app && <a href="/access/app">Se connecter à l’application</a>}
      </nav>
      <p className="footnote">Le workspace affiche les vues des modules installés selon vos accès. Les autres modules natifs sont en cours de construction.</p>
    </section>
    <footer>Un socle commun. Vos modules. Votre interface.</footer>
  </main>;
}
