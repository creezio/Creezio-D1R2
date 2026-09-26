import { createElement } from 'react';
export function view() {
  return createElement('section', { 'data-module': 'example.witness' },
    createElement('h1', null, 'Module témoin'),
    createElement('p', null, 'Cette vue provient du module explicitement sélectionné.'),
    createElement('a', { href: '/api/modules/example.witness/status' }, 'Lire le statut public du module'));
}
