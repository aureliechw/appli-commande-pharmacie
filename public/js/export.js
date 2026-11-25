// Génère, directement dans le navigateur, un fichier Excel unique regroupant tous les fournisseurs retenus,
// au format attendu en aval (modèle prev_reap_phar_JJMM.xlsx) :
// feuille « temp », colonnes CODPRO | NOMPRO | UF | QTE_MIN_FOUR | CODE_FR, une ligne par produit commandé.
// QTE_MIN_FOUR porte la quantité commandée ; l'UF vaut toujours 996.
// ExcelJS est fourni par vendor/exceljs.min.js.
const Export = (() => {
const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UF = 996;

// Retourne { nom, blob, lignes, fournisseurs }, ou null s'il n'y a aucune quantité à commander.
async function genererExport(fournisseurs) {
  const lignes = fournisseurs.flatMap(f => f.lignes.filter(l => l.qte > 0).map(l => ({ ...l, codeFR: f.codeFR })));
  if (!lignes.length) return null;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Appli Commande PUI';
  const ws = wb.addWorksheet('temp');
  ws.columns = [
    { header: 'CODPRO', width: 12.86 },
    { header: 'NOMPRO', width: 36.29 },
    { header: 'UF', width: 36.29 },
    { header: 'QTE_MIN_FOUR', width: 15 },
    { header: 'CODE_FR', width: 11.14 }
  ];
  for (const l of lignes) ws.addRow([String(l.code), String(l.produit), UF, l.qte, String(l.codeFR)]);

  const buffer = await wb.xlsx.writeBuffer();
  const d = new Date();
  const jjmm = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0');
  return {
    nom: `prev_reap_phar_${jjmm}.xlsx`,
    blob: new Blob([buffer], { type: TYPE_XLSX }),
    lignes: lignes.length,
    fournisseurs: new Set(lignes.map(l => l.codeFR)).size
  };
}

return { genererExport };
})();
