import { RuntimeStatus } from './runtime-status';
import { nativeAccess } from '../.creezio/generated/client';

export default function Home() {
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
