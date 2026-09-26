import { RuntimeStatus } from './runtime-status';

export default function Home() {
  return <main className="welcome">
    <header className="brand"><span className="mark" aria-hidden="true">c</span>Creezio</header>
    <section className="welcome-body">
      <p className="eyebrow">Environnement de développement</p>
      <h1>Votre application<br />commence ici.</h1>
      <p className="intro">Le socle commun est en construction. Cette installation permet de vérifier le démarrage de l’application et ses connexions de stockage.</p>
      <RuntimeStatus />
      <p className="footnote">Les comptes, le workspace et les modules natifs seront raccordés dans les prochaines étapes de construction.</p>
    </section>
    <footer>Un socle commun. Vos modules. Votre interface.</footer>
  </main>;
}
