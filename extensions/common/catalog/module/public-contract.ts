/** Versioned business boundary for authorized consumers, never anonymous exposure. */
export const CATALOG_MODULE_ID='creezio.catalog' as const;
export const CATALOG_PORT_ID='catalog.products' as const;
export const CATALOG_PORT_VERSION='1.0.0' as const;
export const CATALOG_OPERATIONS=Object.freeze({
  search:'product.search',get:'product.get',categories:'category.list'
} as const);
export type CatalogProduct=Readonly<{id:string;sku:string;name:string;description:string;
  attributes:readonly {key:string;value:string}[];categoryId:string|null;priceMinor:number;
  currency:string;status:'published';revision:number;createdAt:string;updatedAt:string}>;
export type CatalogProductSummary=Pick<CatalogProduct,'id'|'sku'|'name'|'categoryId'|'priceMinor'|
  'currency'|'status'|'revision'|'updatedAt'>;
export type CatalogSearchInput=Readonly<{limit:number;cursor?:string;query?:string;categoryId?:string}>;
export type CatalogSearchOutput=Readonly<{items:readonly CatalogProductSummary[];nextCursor:string|null;
  complete:boolean;scanned:number}>;
export type CatalogGetInput=Readonly<{id:string}>;
export type CatalogGetOutput=Readonly<{product:CatalogProduct}>;
