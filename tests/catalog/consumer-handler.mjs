/** Local merchant.cart fixture: consume only the published, versioned Catalogue query. */
export async function previewCatalogProduct(input,context){
  const {product}=await context.operations.query({moduleId:'creezio.catalog',
    operationId:'product.get',input:{id:input.id}});
  return {output:{productId:product.id,name:product.name,priceMinor:product.priceMinor,
    currency:product.currency,revision:product.revision}};
}
