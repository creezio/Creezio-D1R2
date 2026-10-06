/** Static, same-origin registry page. The owner cookie remains HttpOnly. */
export const registryPage = String.raw`<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Registre Creezio</title><script src="/registry.js" defer></script></head>
<body>
<main>
  <h1>Registre Creezio</h1>
  <p>Enregistrez un projet et ses installations Sites ou Cloudflare avec votre identité vérifiée.</p>
  <p id="status" role="status" aria-live="polite">Vérification de la session…</p>
  <section id="sign-in" hidden>
    <h2>Connexion propriétaire</h2>
    <p><a href="/v1/owners/github/start">Se connecter avec GitHub</a></p>
    <form id="email-start-form">
      <label for="owner-email">Ou recevoir un code par email</label>
      <input id="owner-email" name="email" type="email" autocomplete="email" required>
      <button id="email-start" type="submit">Envoyer un code</button>
    </form>
    <form id="email-verify-form" hidden>
      <p id="email-challenge-info"></p>
      <label for="owner-code">Code à huit chiffres reçu par email</label>
      <input id="owner-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" required>
      <button id="email-verify" type="submit">Vérifier le code</button>
      <p>Pour demander un nouveau code, utilisez le formulaire email ci-dessus. L'envoi est toujours explicite.</p>
    </form>
  </section>
  <section id="owner-panel" hidden>
    <h2>Mes projets</h2>
    <button id="owner-logout" type="button">Se déconnecter</button>
    <label for="project-select">Projet existant</label>
    <select id="project-select"><option value="">Choisir un projet</option></select>
    <button id="refresh-projects" type="button">Actualiser les projets</button>
    <form id="project-form">
      <h3>Enregistrer un projet</h3>
      <label for="project-name">Nom</label>
      <input id="project-name" name="name" maxlength="120" required>
      <label for="project-origin">URL source ou dépôt HTTPS</label>
      <input id="project-origin" name="origin" type="url" maxlength="2048" required>
      <button id="create-project" type="submit">Enregistrer le projet</button>
    </form>
    <section id="installation-panel" hidden>
      <h2>Installations du projet</h2>
      <label for="installation-select">Installation existante</label>
      <select id="installation-select"><option value="">Choisir une installation</option></select>
      <button id="refresh-installations" type="button">Actualiser les installations</button>
      <p>Le jeton n'est affiché qu'à la création ou à la rotation. Conservez le fichier téléchargé hors du navigateur.</p>
      <button id="create-sites" type="button">Créer une installation Sites</button>
      <button id="create-cloudflare" type="button">Créer une installation Cloudflare</button>
      <button id="rotate" type="button">Remplacer le jeton de l'installation choisie</button>
      <section id="deployments-panel" hidden>
        <h3>Déploiements déclarés</h3>
        <p>Ces déclarations indiquent la provenance enregistrée ; elles ne prouvent pas la version actuellement servie.</p>
        <button id="refresh-deployments" type="button">Actualiser les déclarations</button>
        <p id="deployments-status" role="status"></p>
        <ul id="deployments-list"></ul>
      </section>
    </section>
    <p id="download" hidden></p>
  </section>
</main>
</body></html>`;

/** Kept separate so CSP can reject inline scripts and all third-party code. */
export const registryScript = String.raw`'use strict';
const byId = id => document.getElementById(id);
let projects = [], installations = [], projectsComplete = false, installationsComplete = false;
let projectId = '', installationId = '', unresolvedProject = false, unresolvedInstallation = false;
let pendingToken = null, busy = false;
let challenge = null, authBusy = false, verifyUncertain = false;
let deploymentsRead = 0;
let ownerEpoch = 0;
const status = message => { byId('status').textContent = message; };
const authControls = () => {
  byId('email-start').disabled = authBusy;
  byId('owner-email').disabled = authBusy;
  byId('email-verify').disabled = authBusy || !challenge || verifyUncertain;
  byId('owner-code').disabled = authBusy || !challenge || verifyUncertain;
};
const authError = error => {
  switch (error.message) {
    case 'invalid_input': return 'Email ou code invalide. Le code comporte huit chiffres.';
    case 'configuration_unavailable': return 'Connexion par email indisponible sur ce registre.';
    case 'rate_limited': return 'Trop de demandes de code. Réessayez plus tard.';
    case 'service_unavailable': return 'Envoi du code indisponible. Réessayez plus tard.';
    case 'forbidden': return 'Code refusé, expiré ou déjà utilisé. Corrigez-le ou demandez un nouveau code.';
    default: return 'Service indisponible. Réessayez plus tard.';
  }
};
const setBusy = value => {
  busy = value;
  byId('project-select').disabled = value;
  byId('installation-select').disabled = value || !installationsComplete;
  byId('refresh-projects').disabled = value;
  byId('refresh-installations').disabled = value;
  byId('create-project').disabled = value || !!pendingToken || unresolvedProject || !projectsComplete;
  byId('create-sites').disabled = value || !!pendingToken || unresolvedInstallation || !installationsComplete;
  byId('create-cloudflare').disabled = value || !!pendingToken || unresolvedInstallation || !installationsComplete;
  byId('rotate').disabled = value || !!pendingToken || !installationsComplete || !installationId;
  byId('owner-logout').disabled = value || !!pendingToken;
  byId('refresh-deployments').disabled = value || !installationId;
};
async function api(path, method, value) {
  const headers = {'accept': 'application/json'};
  if (method !== 'GET') headers['x-creezio-request'] = '1';
  if (value !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {method, credentials: 'same-origin', cache: 'no-store',
    redirect: 'error', headers, ...(value === undefined ? {} : {body: JSON.stringify(value)})});
  let data;
  try { data = await response.json(); } catch { throw new Error('Réponse illisible.'); }
  if (!response.ok) {
    const error = new Error(data?.error?.code || 'Requête refusée.');
    error.status = response.status;
    throw error;
  }
  return {data, status: response.status};
}
async function showOwner(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId) throw new Error('Réponse propriétaire incomplète.');
  const epoch = ++ownerEpoch;
  challenge = null;
  byId('owner-code').value = '';
  byId('sign-in').hidden = true;
  byId('owner-panel').hidden = false;
  try {
    await loadProjects();
    if (epoch !== ownerEpoch) return;
    status(projectsComplete ? 'Session propriétaire vérifiée.' : 'Inventaire des projets incomplet.');
  } catch {
    if (epoch === ownerEpoch)
      status('Session propriétaire vérifiée ; lecture des projets indisponible. Actualisez les projets.');
  }
}
async function startEmail(event) {
  event.preventDefault();
  if (authBusy || byId('sign-in').hidden === true) return;
  const email = byId('owner-email').value.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status('Saisissez une adresse email valide.'); return;
  }
  authBusy = true; authControls();
  try {
    const response = await api('/v1/owners/email/start', 'POST', {email});
    if (response.status !== 202 || !response.data?.challengeId || !response.data?.expiresAt)
      throw new Error('Réponse de demande de code incomplète.');
    challenge = {id: response.data.challengeId, email};
    verifyUncertain = false;
    byId('owner-code').value = '';
    byId('email-challenge-info').textContent = 'Code envoyé à ' + email + '. Valable jusqu’au ' +
      new Date(response.data.expiresAt).toLocaleString('fr-FR') + '.';
    byId('email-verify-form').hidden = false;
    status('Code envoyé. Saisissez les huit chiffres reçus par email.');
  } catch (error) {
    status(error.status ? authError(error)
      : 'Envoi du code incertain. Aucun nouvel envoi automatique ; utilisez « Envoyer un code » pour réessayer explicitement.');
  } finally { authBusy = false; authControls(); }
}
async function verifyEmail(event) {
  event.preventDefault();
  if (authBusy || !challenge || verifyUncertain || byId('sign-in').hidden === true) return;
  const code = byId('owner-code').value.trim();
  if (!/^[0-9]{8}$/.test(code)) { status('Saisissez les huit chiffres du code.'); return; }
  const challengeId = challenge.id;
  authBusy = true; authControls();
  try {
    const response = await api('/v1/owners/email/verify', 'POST', {challengeId, code});
    if (response.status !== 200 || !response.data?.ownerId || !response.data?.verifiedAt)
      throw new Error('Réponse de vérification incomplète.');
    await showOwner(response.data.ownerId);
  } catch (error) {
    if (error.status && error.status < 500) {
      byId('owner-code').value = '';
      status(authError(error));
    } else {
      verifyUncertain = true;
      byId('owner-code').value = '';
      try {
        const owner = await api('/v1/owners/me', 'GET');
        if (owner.data?.ownerId) await showOwner(owner.data.ownerId);
        else status('Vérification incertaine. Demandez un nouveau code explicitement.');
      } catch {
        status('Vérification incertaine. Aucun renvoi automatique ; demandez un nouveau code explicitement.');
      }
    }
  } finally { authBusy = false; authControls(); }
}
function showSignedOut() {
  ownerEpoch++;
  projects = []; installations = []; projectsComplete = false; installationsComplete = false;
  projectId = ''; installationId = ''; challenge = null; verifyUncertain = false;
  unresolvedProject = false; unresolvedInstallation = false;
  byId('owner-code').value = '';
  byId('email-verify-form').hidden = true;
  byId('owner-panel').hidden = true;
  byId('sign-in').hidden = false;
  renderProjects();
  status('Session fermée. Connectez-vous avec GitHub ou par email.');
}
async function logout() {
  if (busy || pendingToken || byId('owner-panel').hidden) return;
  setBusy(true);
  try {
    const response = await api('/v1/owners/logout', 'POST');
    if (response.status !== 200 || response.data?.status !== 'signed_out')
      throw new Error('Réponse de déconnexion incomplète.');
    showSignedOut();
  } catch {
    try {
      await api('/v1/owners/me', 'GET');
      status('Déconnexion incertaine. La session est encore active ; réessayez explicitement.');
    } catch (error) {
      if (error.status === 401) showSignedOut();
      else status('Déconnexion incertaine. Vérification de session indisponible.');
    }
  } finally { setBusy(false); }
}
function renderProjects() {
  const select = byId('project-select');
  select.replaceChildren(new Option('Choisir un projet', ''));
  for (const item of projects) select.add(new Option(item.name + ' — ' + item.origin, item.projectId));
  select.value = projects.some(item => item.projectId === projectId) ? projectId : '';
  if (!select.value) { projectId = ''; clearInstallations(); }
  byId('installation-panel').hidden = !projectId;
  setBusy(busy);
}
function renderInstallations() {
  const select = byId('installation-select');
  select.replaceChildren(new Option('Choisir une installation', ''));
  for (const item of installations)
    select.add(new Option(item.target + ' — ' + item.installationId + (item.revokedAt ? ' (révoquée)' : ''), item.installationId));
  select.value = installations.some(item => item.installationId === installationId) ? installationId : '';
  if (!select.value) { installationId = ''; clearDeployments(); }
  byId('deployments-panel').hidden = !installationId;
  setBusy(busy);
}
function clearDeployments() {
  deploymentsRead++;
  byId('deployments-list').replaceChildren();
  byId('deployments-status').textContent = '';
  byId('deployments-panel').hidden = true;
}
async function loadDeployments(scopeProjectId = projectId, scopeInstallationId = installationId) {
  if (!scopeProjectId || !scopeInstallationId) { clearDeployments(); return; }
  const read = ++deploymentsRead;
  byId('deployments-panel').hidden = false;
  byId('deployments-status').textContent = 'Lecture des déclarations…';
  const response = (await api('/v1/installations/' + encodeURIComponent(scopeInstallationId) + '/deployments', 'GET')).data;
  if (read !== deploymentsRead || projectId !== scopeProjectId || installationId !== scopeInstallationId) return;
  if (response.installationId !== scopeInstallationId || !Array.isArray(response.deployments))
    throw new Error('Réponse des déclarations invalide.');
  const list = byId('deployments-list');
  list.replaceChildren();
  for (const item of response.deployments) {
    const entry = document.createElement('li');
    const versions = [item.artifact?.coreVersion && 'Core ' + item.artifact.coreVersion,
      item.artifact?.contractVersion && 'contrat ' + item.artifact.contractVersion,
      item.publishedSha && 'SHA publié ' + item.publishedSha].filter(Boolean).join(', ');
    entry.textContent = (item.declaredAt || 'Date inconnue') + ' — ' + (versions || 'version non renseignée') +
      ' — ' + (item.url || 'URL non renseignée') +
      (item.repositoryUrl ? ' — dépôt : ' + item.repositoryUrl : '');
    list.append(entry);
  }
  byId('deployments-panel').hidden = false;
  byId('deployments-status').textContent = response.complete === true
    ? (response.deployments.length ? response.deployments.length + ' déclaration(s) enregistrée(s).'
      : 'Aucune déclaration enregistrée pour cette installation.')
    : 'Liste limitée aux ' + (response.limit || 100) + ' déclarations les plus récentes ; historique incomplet.';
}
function clearInstallations() {
  installations = [];
  installationsComplete = false;
  installationId = '';
  clearDeployments();
  renderInstallations();
}
async function loadProjects() {
  const epoch = ownerEpoch;
  const response = (await api('/v1/projects', 'GET')).data;
  if (epoch !== ownerEpoch || byId('owner-panel').hidden) return;
  projects = response.projects;
  projectsComplete = response.complete === true;
  renderProjects();
  if (!projectsComplete) status('Inventaire des projets incomplet : création et réconciliation bloquées.');
  return response;
}
async function loadInstallations(scopeId = projectId) {
  if (!scopeId) { clearInstallations(); return; }
  const epoch = ownerEpoch;
  installationsComplete = false;
  setBusy(busy);
  const response = (await api('/v1/projects/' + encodeURIComponent(scopeId) + '/installations', 'GET')).data;
  if (epoch !== ownerEpoch || projectId !== scopeId) return;
  installations = response.installations;
  installationsComplete = response.complete === true;
  renderInstallations();
  if (installationId) {
    try { await loadDeployments(scopeId, installationId); }
    catch { byId('deployments-status').textContent = 'Lecture des déclarations indisponible. Réessayez explicitement.'; }
  }
  if (!installationsComplete) status('Inventaire des installations incomplet : création et réconciliation bloquées.');
  return response;
}
function offerToken(value) {
  pendingToken = value;
  const area = byId('download');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Télécharger maintenant le jeton (une seule fois)';
  button.addEventListener('click', () => {
    if (!pendingToken) return;
    const content = JSON.stringify({schemaVersion: 1, projectId: pendingToken.projectId,
      installationId: pendingToken.installationId, target: pendingToken.target, token: pendingToken.token}) + '\n';
    const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'creezio-installation-' + pendingToken.installationId + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    pendingToken = null;
    area.replaceChildren();
    area.hidden = true;
    setBusy(busy);
    status('Téléchargement lancé. Vérifiez le fichier avant de quitter cette page.');
  }, {once: true});
  area.replaceChildren(button);
  area.hidden = false;
  setBusy(busy);
  status('Jeton créé. Téléchargez-le maintenant ; le registre ne pourra pas le réafficher.');
}
async function chooseProject(id) {
  projectId = id;
  clearInstallations();
  renderProjects();
  if (projectId) await loadInstallations();
}
async function createProject(event) {
  event.preventDefault();
  if (busy || pendingToken || unresolvedProject || !projectsComplete) return;
  const name = byId('project-name').value.trim();
  let origin;
  try { origin = new URL(byId('project-origin').value).href; }
  catch { status('URL HTTPS invalide.'); return; }
  if (!name || !origin.startsWith('https://')) { status('Nom et URL HTTPS requis.'); return; }
  setBusy(true);
  try {
    await loadProjects();
    if (!projectsComplete) return;
    const matches = projects.filter(item => item.name === name && item.origin === origin);
    if (matches.length === 1) {
      await chooseProject(matches[0].projectId);
      status('Projet déjà enregistré : sélectionné sans nouvelle création.');
      return;
    }
    if (matches.length > 1) { status('Plusieurs projets identiques : choisissez leur ID après inspection.'); return; }
    const before = new Set(projects.map(item => item.projectId));
    let created;
    try {
      created = await api('/v1/projects', 'POST', {name, origin});
      if (created.status !== 201) throw new Error('Acquittement de création inattendu.');
    } catch (error) {
      if (error.status && error.status < 500) { status('Création refusée : ' + error.message); return; }
      try {
        await loadProjects();
        const added = projects.filter(item => !before.has(item.projectId) && item.name === name && item.origin === origin);
        if (projectsComplete && added.length === 1) {
          await chooseProject(added[0].projectId);
          status('Réponse perdue ; un seul nouveau projet exact est visible. ID récupéré sans rejouer le POST.');
        } else {
          unresolvedProject = true;
          status('Création incertaine, même si aucun projet nouveau n’est encore visible. Inspectez avant toute autre tentative.');
        }
      } catch {
        unresolvedProject = true;
        status('Création incertaine et lecture indisponible. Aucun nouvel envoi automatique.');
      }
      return;
    }
    projectId = created.data.projectId;
    try { await loadProjects(); await chooseProject(projectId); status('Projet enregistré.'); }
    catch { status('Projet enregistré ; rechargez la liste des installations avant de continuer.'); }
  } catch (error) { status('Lecture des projets indisponible : ' + error.message); }
  finally { setBusy(false); }
}
async function createInstallation(target) {
  if (busy || pendingToken || unresolvedInstallation || !projectId || !installationsComplete) return;
  const scopeId = projectId;
  setBusy(true);
  try {
    await loadInstallations(scopeId);
    if (!installationsComplete) return;
    const existing = installations.filter(item => item.target === target && !item.revokedAt);
    if (existing.length) {
      status('Une installation ' + target + ' existe déjà. Sélectionnez son ID ; aucune nouvelle installation créée.');
      return;
    }
    const before = new Set(installations.map(item => item.installationId));
    let created;
    try {
      created = await api('/v1/installations', 'POST', {projectId: scopeId, target});
      if (created.status !== 201) throw new Error('Acquittement de création inattendu.');
    } catch (error) {
      if (error.status && error.status < 500) { status('Création refusée : ' + error.message); return; }
      try {
        await loadInstallations(scopeId);
        const added = installations.filter(item => !before.has(item.installationId) && item.target === target);
        unresolvedInstallation = true;
        if (installationsComplete && added.length === 1) {
          installationId = added[0].installationId;
          renderInstallations();
          status('Installation créée mais jeton perdu. ID retrouvé ; rotation explicite nécessaire pour obtenir un jeton.');
        } else status('Création incertaine, même si aucune installation nouvelle n’est visible. Inspectez avant toute autre tentative.');
      } catch {
        unresolvedInstallation = true;
        status('Création incertaine et lecture indisponible. Aucun nouvel envoi automatique.');
      }
      return;
    }
    installationId = created.data.installationId;
    offerToken(created.data);
    try { await loadInstallations(scopeId); }
    catch { status('Installation créée et jeton prêt ; téléchargez-le avant de recharger la page.'); }
  } catch (error) { status('Lecture des installations indisponible : ' + error.message); }
  finally { setBusy(false); }
}
async function rotateToken() {
  if (busy || pendingToken || !installationsComplete || !installationId) return;
  const scopeId = projectId, scopeInstallationId = installationId;
  const selected = installations.find(item => item.installationId === installationId);
  if (!selected || selected.revokedAt) return;
  if (!window.confirm('Remplacer le jeton de cette installation ? Tout ancien jeton sera invalidé.')) return;
  setBusy(true);
  let rotated;
  try {
    rotated = await api('/v1/installations/' + encodeURIComponent(scopeInstallationId) + '/rotate', 'POST');
    if (rotated.status !== 200) throw new Error('Acquittement de rotation inattendu.');
  } catch (error) {
    status('Rotation incertaine. Vérifiez la version du jeton par lecture ; ne rejouez pas automatiquement.');
    try { await loadInstallations(scopeId); } catch { /* The uncertain state remains visible. */ }
    setBusy(false);
    return;
  }
  offerToken({projectId: scopeId, installationId: scopeInstallationId, target: selected.target, token: rotated.data.token});
  try { await loadInstallations(scopeId); }
  catch { status('Jeton de remplacement prêt ; téléchargez-le avant de recharger la page.'); }
  setBusy(false);
}
byId('project-form').addEventListener('submit', createProject);
byId('email-start-form').addEventListener('submit', startEmail);
byId('email-verify-form').addEventListener('submit', verifyEmail);
byId('owner-logout').addEventListener('click', logout);
byId('project-select').addEventListener('change', async event => {
  if (busy) return;
  const epoch = ownerEpoch;
  try { await chooseProject(event.target.value); }
  catch { if (epoch === ownerEpoch) status('Installations indisponibles.'); }
});
byId('installation-select').addEventListener('change', event => {
  if (busy || !installationsComplete) return;
  installationId = event.target.value;
  clearDeployments();
  setBusy(busy);
  if (installationId) void loadDeployments().catch(() => {
    byId('deployments-status').textContent = 'Lecture des déclarations indisponible. Réessayez explicitement.';
  });
});
byId('refresh-deployments').addEventListener('click', async () => {
  if (busy || !installationId) return;
  try { await loadDeployments(); }
  catch { byId('deployments-status').textContent = 'Lecture des déclarations indisponible. Réessayez explicitement.'; }
});
byId('refresh-projects').addEventListener('click', async () => {
  if (busy) return;
  const epoch = ownerEpoch;
  try {
    await loadProjects();
    if (epoch === ownerEpoch) status(projectsComplete ? 'Projets actualisés.' : 'Inventaire incomplet.');
  } catch { if (epoch === ownerEpoch) status('Lecture des projets indisponible.'); }
});
byId('refresh-installations').addEventListener('click', async () => {
  if (busy) return;
  const epoch = ownerEpoch;
  try {
    await loadInstallations();
    if (epoch === ownerEpoch) status(installationsComplete ? 'Installations actualisées.' : 'Inventaire incomplet.');
  } catch { if (epoch === ownerEpoch) status('Lecture des installations indisponible.'); }
});
byId('create-sites').addEventListener('click', () => { void createInstallation('sites'); });
byId('create-cloudflare').addEventListener('click', () => { void createInstallation('cloudflare'); });
byId('rotate').addEventListener('click', () => { void rotateToken(); });
setBusy(false);
authControls();
api('/v1/owners/me', 'GET').then(async response => {
  await showOwner(response.data?.ownerId);
}).catch(error => {
  byId('sign-in').hidden = false;
  status(error.status === 401 ? 'Connectez-vous avec GitHub ou par email pour enregistrer vos projets.'
    : 'Vérification de session indisponible. Réessayez plus tard.');
});`;
