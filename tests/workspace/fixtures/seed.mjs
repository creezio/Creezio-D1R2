/** Call only with an independently created, authorized synthetic DataPort. */
export async function seedWitnessRecords(port) {
  if (!port || typeof port.create !== 'function') throw new TypeError('Authorized fixture DataPort required.');
  for (const [id,title] of [['alpha','Fiche Alpha'],['beta','Fiche Bêta']])
    await port.create('record',{values:{id,title,revision:0}});
}
