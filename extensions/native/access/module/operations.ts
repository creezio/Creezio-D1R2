/** The statically declared Access operations execute only through the trusted
 * core T04/T06 bridge. The module receives no credential, SQL or private port. */
export function hostOnly(): never {
  throw new Error('Native Access operation requires the host executor.');
}
