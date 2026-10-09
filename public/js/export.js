// Génère un fichier Excel par laboratoire et un ZIP qui les regroupe, directement dans le navigateur.
// ExcelJS et JSZip sont fournis par vendor/exceljs.min.js et vendor/jszip.min.js.
const Export = (() => {
const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function nomFichierSur(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'FOURNISSEUR';
}

async function classeurFournisseur(f, lignes, tauxTVA, horodatage) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Appli Commande PUI';
  const ws = wb.addWorksheet('Commande', { views: [{ state: 'frozen', ySplit: 5 }] });
  ws.columns = [
    { key: 'code', width: 16 }, { key: 'produit', width: 38 }, { key: 'qte', width: 14 },
    { key: 'qteMin', width: 13 }, { key: 'pump', width: 14 }, { key: 'ht', width: 15 }
  ];
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = `Bon de commande — ${f.nomFR}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `Code fournisseur : ${f.codeFR}`;
  ws.getCell('A3').value = `Date : ${horodatage.toLocaleDateString('fr-FR')}`;

  const entete = ws.getRow(5);
  entete.values = ['Code produit', 'Produit', 'Qté commandée', 'Qté min cmd', 'PUMP HT (€)', 'Montant HT (€)'];
  entete.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  entete.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });

  let ligneExcel = 6;
  for (const l of lignes) {
    const r = ws.getRow(ligneExcel);
    r.values = [l.code, l.produit, l.qte, l.qteMin, l.pump, { formula: `C${ligneExcel}*E${ligneExcel}`, result: l.qte * l.pump }];
    ligneExcel++;
  }
  const derniere = ligneExcel - 1;
  const totalHT = lignes.reduce((s, l) => s + l.qte * l.pump, 0);
  const tHT = ligneExcel + 1, tTVA = ligneExcel + 2, tTTC = ligneExcel + 3;
  ws.getCell(`E${tHT}`).value = 'Total HT';
  ws.getCell(`F${tHT}`).value = { formula: `SUM(F6:F${derniere})`, result: totalHT };
  ws.getCell(`E${tTVA}`).value = `TVA ${(tauxTVA * 100).toLocaleString('fr-FR')} %`;
  ws.getCell(`F${tTVA}`).value = { formula: `F${tHT}*${tauxTVA}`, result: totalHT * tauxTVA };
  ws.getCell(`E${tTTC}`).value = 'Total TTC';
  ws.getCell(`F${tTTC}`).value = { formula: `F${tHT}+F${tTVA}`, result: totalHT * (1 + tauxTVA) };
  [tHT, tTVA, tTTC].forEach(n => { ws.getCell(`E${n}`).font = { bold: true }; ws.getCell(`F${n}`).font = { bold: true }; });

  ws.getColumn('pump').numFmt = '#,##0.000';
  ws.getColumn('ht').numFmt = '#,##0.00 €';
  ws.getColumn('qte').numFmt = '#,##0';
  return wb.xlsx.writeBuffer();
}

// Retourne les fichiers sous forme de Blob : { fichiers: [{ nom, fournisseur, lignes, blob }], archive: { nom, blob } }.
async function genererExports(fournisseurs, tauxTVA) {
  const horodatage = new Date();
  const jour = horodatage.toISOString().slice(0, 10);
  const zip = new JSZip();
  const fichiers = [];
  for (const f of fournisseurs) {
    const lignes = f.lignes.filter(l => l.qte > 0);
    if (!lignes.length) continue;
    const buffer = await classeurFournisseur(f, lignes, tauxTVA, horodatage);
    const nom = `Commande_${nomFichierSur(f.nomFR)}_${nomFichierSur(f.codeFR)}_${jour}.xlsx`;
    zip.file(nom, buffer);
    fichiers.push({ nom, fournisseur: f.nomFR, lignes: lignes.length, blob: new Blob([buffer], { type: TYPE_XLSX }) });
  }
  let archive = null;
  if (fichiers.length) {
    archive = { nom: `Commandes_${jour}.zip`, blob: await zip.generateAsync({ type: 'blob' }) };
  }
  return { fichiers, archive };
}

return { genererExports };
})();
