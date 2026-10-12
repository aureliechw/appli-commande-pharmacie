// Étapes 1 à 4 du prompt : indicateurs, déclencheurs, quantités, compléments.
// Exécuté dans le navigateur ; XLSX est fourni par vendor/xlsx.full.min.js.
const Calcul = (() => {

const COLONNES_REQUISES = ['CODPRO', 'CODREA', 'NOMPRO', 'QTE_MIN_FOUR', 'STOCK', 'EN_CDE',
  'CONSO_M-1', 'CONSO_M-2', 'CONSO_M-3', 'CONSO_M-11', 'CODE_FR', 'NOM_FR', 'DELREA', 'SEUIL_CSS', 'PUMP', 'RESERVE'];

function nombre(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function texte(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// Lit l'onglet "temp" (ou le premier onglet) et normalise les en-têtes complétés d'espaces.
function lireFichierSource(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const nomOnglet = wb.SheetNames.find(n => n.trim().toLowerCase() === 'temp') || wb.SheetNames[0];
  const brutes = XLSX.utils.sheet_to_json(wb.Sheets[nomOnglet], { defval: null });
  if (!brutes.length) throw new Error('Le fichier ne contient aucune ligne.');
  const lignes = brutes.map(r => {
    const o = {};
    for (const k of Object.keys(r)) o[k.trim().toUpperCase()] = r[k];
    return o;
  });
  const manquantes = COLONNES_REQUISES.filter(c => !(c in lignes[0]));
  if (manquantes.length) throw new Error('Colonnes manquantes dans le fichier : ' + manquantes.join(', '));
  return lignes;
}

function estBloque(code, codesExclus) {
  return Boolean(code) && codesExclus.includes(code);
}

function frequencePourNbRefs(n) {
  if (n > 50) return 10;
  if (n >= 20) return 15;
  return 30;
}

function arrondiMultipleSup(q, multiple) {
  return Math.ceil(q / multiple) * multiple;
}

function quantiteACommander(p) {
  const stockALivraison = p.stockEffectif - p.consoJour * p.delai;
  let besoin = p.consoJour * 30 - stockALivraison;
  if (besoin <= 0) besoin = p.qteMin;
  return Math.max(p.qteMin, arrondiMultipleSup(besoin, p.qteMin));
}

const fmt = n => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString('fr-FR') : '∞');

// Explique pourquoi un produit n'a été ni déclencheur ni complément.
function raisonNonRetenu(p, fournisseursDeclenches) {
  const raisons = [];
  if (p.consoJour === 0) {
    raisons.push(p.enCommande > 0
      ? `aucune consommation (M-1, M-2, M-3, M-11) et ${fmt(p.enCommande)} déjà en commande`
      : `aucune consommation (M-1, M-2, M-3, M-11), stock ${fmt(p.stock)} suffisant`);
    return raisons.join(' ; ');
  }
  if (p.typeCalcul === 'FS9') raisons.push(`FS9 : stock eff. ${fmt(p.stockEffectif)} ≥ stock min ${fmt(p.stockMin)}`);
  raisons.push(`${fmt(p.joursStock)} j de stock ≥ seuil ${p.seuil} j`);
  if (!fournisseursDeclenches.has(p.codeFR)) {
    raisons.push('aucun déclencheur chez ce fournisseur, donc pas de complément');
  } else {
    const joursDansFreq = (p.stockEffectif - p.consoJour * p.freq) / p.consoJour;
    raisons.push(`complément non retenu : dans ${p.freq} j, ${fmt(joursDansFreq)} j de stock ≥ seuil ${p.seuil} j`);
  }
  return raisons.join(' ; ');
}

function calculerCommandes(lignesBrutes, config) {
  const tous = lignesBrutes.map(r => {
    const m1 = Math.max(0, nombre(r['CONSO_M-1']));
    const m2 = Math.max(0, nombre(r['CONSO_M-2']));
    const m3 = Math.max(0, nombre(r['CONSO_M-3']));
    const m11 = Math.max(0, nombre(r['CONSO_M-11']));
    // Moyenne des seuls mois M-1/M-2/M-3 non nuls (0 si les trois sont nuls).
    const moisUtiles = [m1, m2, m3].filter(v => v > 0);
    const moyenne = moisUtiles.length ? moisUtiles.reduce((a, b) => a + b, 0) / moisUtiles.length : 0;
    const consoPrev = Math.max(moyenne, m11);
    const consoJour = consoPrev / 30;
    const stock = nombre(r.STOCK);
    const enCommande = nombre(r.EN_CDE);
    const reserve = nombre(r.RESERVE);
    // RESERVE = quantité demandée par les services ; stock effectif jamais négatif.
    const stockEffectif = Math.max(0, stock + enCommande - reserve);
    const delai = nombre(r.DELREA);
    const qteMinBrute = nombre(r.QTE_MIN_FOUR);
    const typeBrut = texte(r.CODREA).toUpperCase();
    return {
      code: texte(r.CODPRO),
      produit: texte(r.NOMPRO),
      typeFS: typeBrut,
      typeCalcul: typeBrut === 'FS5' ? 'FS6' : typeBrut,
      blocage: texte(r.BLOCAGE).toUpperCase(),
      stockMin: nombre(r.SEUIL_CSS),
      qteMin: qteMinBrute > 0 ? qteMinBrute : 1,
      qteMinAbsente: !(qteMinBrute > 0),
      stock, enCommande, reserve, stockEffectif,
      m1, m2, m3, m11, moyenne, nbMoisMoyenne: moisUtiles.length, consoPrev, consoJour,
      viaM11: m11 > moyenne,
      joursStock: consoJour > 0 ? stockEffectif / consoJour : Infinity,
      delai,
      seuil: 10 + delai,
      codeFR: texte(r.CODE_FR),
      nomFR: texte(r.NOM_FR),
      pump: nombre(r.PUMP)
    };
  });

  // Produits bloqués (AUT, EB, C) : ignorés, ni proposés, ni ajoutables, ni comptés pour la fréquence.
  const exclus = tous.filter(p => estBloque(p.blocage, config.codesBlocageExclus));
  const produits = tous.filter(p => !estBloque(p.blocage, config.codesBlocageExclus));

  // Fréquence : nombre total de références (non bloquées) du fournisseur dans le fichier.
  const nbRefs = {};
  produits.forEach(p => { nbRefs[p.codeFR] = (nbRefs[p.codeFR] || 0) + 1; });
  produits.forEach(p => { p.freq = frequencePourNbRefs(nbRefs[p.codeFR]); });

  const candidats = produits;

  // Étape 2 : déclencheurs.
  for (const p of candidats) {
    const motifs = [];
    if (p.stock === 0 && p.enCommande === 0 && p.consoJour === 0) {
      motifs.push('Stock nul, rien en commande, sans conso → qté min');
      p.casParticulier = true;
    } else {
      if (p.typeCalcul === 'FS9' && p.stockEffectif < p.stockMin) {
        motifs.push(`FS9 : stock eff. ${fmt(p.stockEffectif)} < stock min ${fmt(p.stockMin)}`);
      }
      if (p.joursStock < p.seuil) {
        motifs.push(`${p.typeCalcul} : ${fmt(p.joursStock)} j de stock < seuil ${p.seuil} j`);
      }
    }
    if (motifs.length) {
      p.type = 'DECLENCHEUR';
      p.motif = 'Déclencheur — ' + motifs.join(' ; ');
    }
  }

  // Étape 3 : quantités des déclencheurs.
  for (const p of candidats) {
    if (p.type !== 'DECLENCHEUR') continue;
    p.qteCalculee = p.casParticulier ? p.qteMin : quantiteACommander(p);
  }

  // Étape 4 : compléments pour les fournisseurs ayant au moins un déclencheur.
  const fournisseursDeclenches = new Set(candidats.filter(p => p.type === 'DECLENCHEUR').map(p => p.codeFR));
  for (const p of candidats) {
    if (p.type || !fournisseursDeclenches.has(p.codeFR) || p.consoJour <= 0) continue;
    const stockDansFreq = p.stockEffectif - p.consoJour * p.freq;
    const joursDansFreq = stockDansFreq / p.consoJour;
    if (joursDansFreq < p.seuil) {
      p.type = 'COMPLEMENT';
      p.motif = `Complément — dans ${p.freq} j : ${fmt(joursDansFreq)} j de stock < seuil ${p.seuil} j`;
      p.qteCalculee = quantiteACommander(p);
    }
  }

  const commandes = candidats.filter(p => p.type);
  // Stock épuisé avant la réception d'une commande passée aujourd'hui.
  produits.forEach(p => { p.ruptureAvantLivraison = p.consoJour > 0 && p.joursStock < p.delai; });

  // Produits non retenus : l'utilisateur peut les ajouter, avec la raison de leur exclusion.
  const nonRetenus = candidats.filter(p => !p.type);
  for (const p of nonRetenus) {
    p.motif = 'Non retenu — ' + raisonNonRetenu(p, fournisseursDeclenches);
    p.qteCalculee = quantiteACommander(p);
  }
  nonRetenus.sort((a, b) => a.produit.localeCompare(b.produit, 'fr'));
  commandes.sort((a, b) =>
    a.nomFR.localeCompare(b.nomFR, 'fr') ||
    (a.type === b.type ? 0 : a.type === 'DECLENCHEUR' ? -1 : 1) ||
    a.joursStock - b.joursStock ||
    a.produit.localeCompare(b.produit, 'fr'));

  return {
    commandes,
    nonRetenus,
    stats: {
      nbProduitsFichier: tous.length,
      nbExclusBlocage: exclus.length,
      detailExclus: exclus.map(p => ({ code: p.code, produit: p.produit, blocage: p.blocage }))
    }
  };
}

return { lireFichierSource, calculerCommandes, nombre, texte };
})();
