import type {FrontBrand} from '../../sdk/front/types';

/** Application-owned presentation. Core and theme updates must preserve this file. */
export const frontBrand: FrontBrand = Object.freeze({
  name: 'Creezio',
  description: 'Votre application',
});

/** Selection is never authority: the server checks membership for this context. */
export const frontContextId = 'application';
