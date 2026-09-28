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
  <p id="sign-in" hidden><a href="/v1/owners/github/start">Se connecter avec GitHub</a></p>
  <section id="owner-panel" hidden>
    <h2>Mes projets</h2>
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
const status = message => { byId('status').textContent = message; };
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
  if (!select.value) installationId = '';
  setBusy(busy);
}
function clearInstallations() {
  installations = [];
  installationsComplete = false;
  installationId = '';
  renderInstallations();
}
async function loadProjects() {
  const response = (await api('/v1/projects', 'GET')).data;
  projects = response.projects;
  projectsComplete = response.complete === true;
  renderProjects();
  if (!projectsComplete) status('Inventaire des projets incomplet : création et réconciliation bloquées.');
  return response;
}
async function loadInstallations(scopeId = projectId) {
  if (!scopeId) { clearInstallations(); return; }
  installationsComplete = false;
  setBusy(busy);
  const response = (await api('/v1/projects/' + encodeURIComponent(scopeId) + '/installations', 'GET')).data;
  if (projectId !== scopeId) throw new Error('Projet modifié pendant la lecture.');
  installations = response.installations;
  installationsComplete = response.complete === true;
  renderInstallations();
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
byId('project-select').addEventListener('change', async event => {
  if (busy) return;
  try { await chooseProject(event.target.value); } catch { status('Installations indisponibles.'); }
});
byId('installation-select').addEventListener('change', event => {
  if (busy || !installationsComplete) return;
  installationId = event.target.value; setBusy(busy);
});
byId('refresh-projects').addEventListener('click', async () => {
  if (busy) return;
  try { await loadProjects(); status(projectsComplete ? 'Projets actualisés.' : 'Inventaire incomplet.'); }
  catch { status('Lecture des projets indisponible.'); }
});
byId('refresh-installations').addEventListener('click', async () => {
  if (busy) return;
  try { await loadInstallations(); status(installationsComplete ? 'Installations actualisées.' : 'Inventaire incomplet.'); }
  catch { status('Lecture des installations indisponible.'); }
});
byId('create-sites').addEventListener('click', () => { void createInstallation('sites'); });
byId('create-cloudflare').addEventListener('click', () => { void createInstallation('cloudflare'); });
byId('rotate').addEventListener('click', () => { void rotateToken(); });
setBusy(false);
api('/v1/owners/me', 'GET').then(async () => {
  byId('owner-panel').hidden = false;
  await loadProjects();
  status(projectsComplete ? 'Session propriétaire vérifiée.' : 'Inventaire des projets incomplet.');
}).catch(error => {
  byId('sign-in').hidden = false;
  status(error.status === 401 ? 'Connectez-vous avec GitHub pour enregistrer vos projets.'
    : 'Vérification de session indisponible. Réessayez plus tard.');
});`;
