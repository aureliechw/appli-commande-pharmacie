// Étape 5 : lecture de l'export ANSM et croisement local (sans IA).
// Le site de l'ANSM refuse les requêtes venant d'une page web (CORS) : l'export est
// téléchargé chaque jour par GitHub Actions et publié avec le site (CONFIG.fichierANSM).
const ANSM = (() => {

// ---------- Normalisation ----------

function norm(s) {
  return String(s || '')
    .replace(/[µμ]/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/Â°/g, '°');
}

function mots(s) {
  return norm(s).replace(/[^A-Z0-9%]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

// ---------- Formes galéniques ----------

const FORMES = [
  ['INJECTABLE', /\b(INJ\w*|PERF\w*|PARENTERAL\w*|SERINGUES?|SER|STYLOS?|KPEN|CARTOUCHES?|DILUER|INTRAVEINEUSE|IV|IM|SC|IM-IV|SE|AMP|AMPOULES?|AB|PDR ET SOL|PDR SOL)\b/],
  ['COLLYRE', /\b(COLL\w*|OPHT\w*|OPH|INTRAOCULAIRE)\b/],
  ['INHALATION', /\b(INHAL\w*|INH|AEROSOL|NEBUL\w*|TURBUHALER|RESPIMAT|DISKUS)\b/],
  ['NASAL', /\b(NASAL\w*|NAS)\b/],
  ['TRANSDERMIQUE', /\b(TRANSDERM\w*|TRANSD|PATCH|TTS|DISP TRANSD)\b/],
  ['VAGINAL', /\b(VAG\w*|OVULES?)\b/],
  ['RECTAL', /\b(RECT\w*|LAVEMENT|SUPPO\w*|SUP)\b/],
  ['BUVABLE', /\b(BUV\w*|SIROP|SIR|ORALE?|GOUTTES|GTTES?|SACHETS?|SACH|GRANULES?|GRAN|SA)\b/],
  ['COMPRIME', /\b(COMPRIMES?|CPR?S?|CPS|LYOC|OROD\w*|FILM|EFF)\b/],
  ['GELULE', /\b(GELULES?|GELU|GLES?|CAPSULES?|CAPS)\b/],
  ['TOPIQUE', /\b(CREMES?|CR|POMMADES?|POM|PDE|LOTION|CUTANE\w*|EMULSION|SHAMPOO\w*|GEL|DERMIQUE)\b/]
];

const LIBELLE_FORME = {
  INJECTABLE: 'injectable', COLLYRE: 'collyre', INHALATION: 'inhalation', NASAL: 'nasal',
  TRANSDERMIQUE: 'transdermique', VAGINAL: 'vaginal', RECTAL: 'rectal', BUVABLE: 'buvable / orale',
  COMPRIME: 'comprimé', GELULE: 'gélule', TOPIQUE: 'cutané / topique', POMMADE_OPH: 'pommade ophtalmique'
};

function formes(texteNormalise) {
  const t = ' ' + texteNormalise.replace(/[+]/g, ' ET ').replace(/[^A-Z0-9-]+/g, ' ') + ' ';
  const res = new Set();
  for (const [cat, re] of FORMES) if (re.test(t)) res.add(cat);
  // Pommade/gel ophtalmique ≠ collyre.
  if (res.has('COLLYRE') && /\b(POMMADE|POM|PDE|GEL)\b/.test(t) && !/\bCOLL\w*/.test(t)) {
    res.delete('COLLYRE'); res.delete('TOPIQUE'); res.add('POMMADE_OPH');
  }
  // « GEL » seul peut être une gélule ou un gel cutané, sauf si une autre voie est précisée.
  if (/\bGEL\b/.test(t) && ![...res].some(f => f !== 'TOPIQUE')) res.add('GELULE');
  if (res.has('INJECTABLE') && res.has('BUVABLE') && !/\bBUV/.test(t)) res.delete('BUVABLE');
  return res;
}

// ---------- Dosages ----------

const UNITES = {
  MG: 'MG', G: 'G', GR: 'G', UG: 'UG', MCG: 'UG', MICROGRAMME: 'UG', MICROGRAMMES: 'UG', Y: 'UG',
  UI: 'UI', U: 'UI', UNITE: 'UI', UNITES: 'UI', MUI: 'MUI', MU: 'MUI',
  ML: 'ML', '%': '%', MEQ: 'MEQ', MMOL: 'MMOL', MICROLITRES: 'UL'
};

function canonique(valeur, unite) {
  let v = valeur, u = unite;
  if (u === 'G') { v *= 1000; u = 'MG'; }
  if (u === 'UG') { v /= 1000; u = 'MG'; }
  if (u === 'MUI') { v *= 1e6; u = 'UI'; }
  return `${Math.round(v * 10000) / 10000}${u}`;
}

// Extrait les dosages : « 25 et 75 mg » → 25MG, 75MG ; « 1 g/5 ml » → 1000MG.
function dosages(texteNormalise) {
  const t = texteNormalise
    .replace(/(\d)\s(\d{3})\b/g, '$1$2')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)([A-Z%])/g, '$1 $2')
    .replace(/([A-Z%])(\d)/g, '$1 $2')
    .replace(/[\/,()+]/g, ' | ');
  const tokens = t.split(/\s+/).filter(Boolean);
  const res = new Set();
  let enAttente = [];
  let apresBarre = false;
  for (const tok of tokens) {
    if (tok === '|') { apresBarre = true; continue; }
    if (/^\d+(\.\d+)?$/.test(tok)) {
      if (apresBarre) enAttente = []; // dénominateur de « 100 mg/2 ml » : on l'ignore
      enAttente.push(parseFloat(tok));
      apresBarre = false;
      continue;
    }
    if ((tok === 'MILLION' || tok === 'MILLIONS') && enAttente.length) {
      enAttente = enAttente.map(v => v * 1e6);
      continue;
    }
    const unite = UNITES[tok];
    if (unite && enAttente.length) {
      if (unite !== 'ML') enAttente.forEach(v => res.add(canonique(v, unite)));
      enAttente = [];
    } else if (tok !== 'ET' && !unite) {
      enAttente = [];
    }
    apresBarre = false;
  }
  return res;
}

// ---------- Laboratoires ----------

const LABOS = {
  ARROW: ['ARROW', 'ARW', 'ARL'],
  VIATRIS: ['VIATRIS', 'VIA', 'VTR', 'MYLAN', 'MYL'],
  TEVA: ['TEVA', 'TVC', 'TVS', 'TEV'],
  EG: ['EG', 'EGL'],
  SANDOZ: ['SANDOZ', 'SDZ'],
  BIOGARAN: ['BIOGARAN', 'BGR', 'BGA', 'BIOG'],
  ZENTIVA: ['ZENTIVA', 'ZEN', 'ZTV', 'WINTHROP'],
  ACCORD: ['ACCORD', 'ACC'],
  HIKMA: ['HIKMA', 'HIK'],
  FRESENIUS: ['FRESENIUS', 'KABI', 'KBI', 'FRK'],
  AGUETTANT: ['AGUETTANT', 'AGT', 'PROAMP'],
  PANPHARMA: ['PANPHARMA', 'PAN'],
  BBRAUN: ['BRAUN', 'BBRAUN', 'BBM'],
  BAXTER: ['BAXTER', 'BAX'],
  RENAUDIN: ['RENAUDIN', 'REN'],
  KALCEKS: ['KALCEKS', 'KAL'],
  SUN: ['SUN'],
  ZYDUS: ['ZYDUS', 'ZYD'],
  CRISTERS: ['CRISTERS', 'CRT'],
  ALMUS: ['ALMUS', 'ALM'],
  SANOFI: ['SANOFI', 'WINTHROP'],
  PFIZER: ['PFIZER', 'PFZ', 'HOSPIRA'],
  MEDAC: ['MEDAC'],
  REIG: ['REIG', 'REI'],
  ACS: ['ACS', 'DOBFAR'],
  APHP: ['APHP', 'AGEPS'],
  THEA: ['THEA'],
  GERDA: ['GERDA'],
  SUBSTIPHARM: ['SUBSTIPHARM', 'SUB'],
  QILU: ['QILU'],
  KRKA: ['KRKA'],
  EUROGENERICS: ['EUROGENERICS']
};

const ALIAS_LABO = {};
for (const [labo, alias] of Object.entries(LABOS)) alias.forEach(a => { ALIAS_LABO[a] = labo; });

function labosDansMots(liste) {
  const res = new Set();
  liste.forEach((m, i) => {
    if (ALIAS_LABO[m]) res.add(ALIAS_LABO[m]);
    const deux = m + (liste[i + 1] || '');
    if (ALIAS_LABO[deux]) res.add(ALIAS_LABO[deux]);
  });
  return res;
}

// ---------- Substances ----------

const MOTS_VIDES = new Set(['DE', 'D', 'DU', 'DES', 'LA', 'LE', 'L', 'ET', 'EN', 'A', 'AU', 'AUX',
  'CHLORHYDRATE', 'DICHLORHYDRATE', 'HYDROCHLORURE', 'ACETATE', 'SULFATE', 'PHOSPHATE', 'DIPHOSPHATE',
  'FUMARATE', 'MALEATE', 'MESILATE', 'MESYLATE', 'TARTRATE', 'SUCCINATE', 'HYDROGENOSUCCINATE',
  'PAMOATE', 'MONOHYDRATE', 'DIHYDRATE', 'TRIHYDRATE', 'HEMIHYDRATE', 'ANHYDRE', 'SODIQUE',
  'POTASSIQUE', 'DIPOTASSIQUE', 'CALCIQUE', 'MAGNESIQUE', 'BASE', 'SEL', 'METILSULFATE', 'BROMHYDRATE',
  'CITRATE', 'BESILATE', 'TOSILATE', 'SOUCHE', 'VIRUS', 'VIVANT', 'ATTENUE', 'INACTIVE', 'SEL']);

// « potassium (bicarbonate de) / potassium (citrate de) » → [[POTASSIUM, BICARBONATE], [POTASSIUM, CITRATE]]
function substances(dciBrute) {
  const t = norm(dciBrute).replace(/\(\([^]*?\)\)/g, ' ');
  const parties = [];
  let courant = '', profondeur = 0;
  for (const c of t) {
    if (c === '(') profondeur++;
    if (c === ')') profondeur = Math.max(0, profondeur - 1);
    if (profondeur === 0 && /[,\/+]/.test(c)) { parties.push(courant); courant = ''; } else courant += c;
  }
  parties.push(courant);
  const utiles = s => s.replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/)
    .filter(m => m.length >= 4 && !MOTS_VIDES.has(m) && !/^\d/.test(m));
  return parties
    .map(p => {
      const principal = utiles(p.replace(/\([^)]*\)?/g, ' '));
      // Le contenu des parenthèses n'est retenu que pour un ion seul : « sodium (bicarbonate de) ».
      if (principal.length && !principal.every(m => NOMS_COMMUNS.has(m))) return principal;
      return utiles(p);
    })
    .filter(l => l.length);
}

// Mots qui ne suffisent pas à identifier une marque (« Vitamine A Provepharm »).
const NOMS_COMMUNS = new Set(['VITAMINE', 'ACIDE', 'SODIUM', 'CHLORURE', 'POTASSIUM', 'CALCIUM', 'MAGNESIUM',
  'GLUCOSE', 'EAU', 'SOLUTE', 'INSULINE', 'HEPARINE', 'ALCOOL', 'SERUM', 'VACCIN', 'LACTATE', 'BICARBONATE',
  'GLUCONATE', 'PHOSPHATE', 'SULFATE', 'CHLORHYDRATE', 'SPECIALITES', 'SPECIALITE', 'GAMME']);

// ---------- Lecture de l'export ANSM ----------

function analyserTitre(titre) {
  const t = String(titre || '').replace(/\|/g, ' ');
  // La DCI est entre crochets en fin de titre (crochet fermant parfois absent).
  const idxCroch = t.lastIndexOf('[');
  const dci = idxCroch >= 0 ? t.slice(idxCroch + 1).replace(/\].*$/, '') : '';
  let corps = idxCroch >= 0 ? t.slice(0, idxCroch) : t;
  corps = corps.replace(/\s*[–—-]\s*$/, '').trim();
  const n = norm(corps);
  const idxVirgule = corps.indexOf(',');
  const specialite = (idxVirgule > 0 ? corps.slice(0, idxVirgule) : corps).replace(/\([^)]*\)/g, ' ').trim();
  const nomSansDosage = norm(specialite).split(/\s\d|\d/)[0].replace(/\bL\.?P\.?\b|\bLP\b/g, ' ');
  const motsNom = nomSansDosage.replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (motsNom.length > 1 && (MOTS_VIDES.has(motsNom[0]) || motsNom[0].length < 2)) motsNom.shift();
  const listeSubst = substances(dci);
  const motsDci = new Set(listeSubst.flat());
  const dansDci = m => motsDci.has(m) || (m.length >= 5 && [...motsDci].some(d => d.startsWith(m)));
  const generique = /^SPECIALITES?$|^GAMME$/.test(motsNom[0] || '');
  const estDci = motsNom.slice(0, 2).some(dansDci);
  // Marque = premiers mots du nom quand ce n'est pas la DCI.
  const marque = !generique && !estDci ? motsNom.slice(0, 2) : [];
  // Mots de labo = mots du nom qui ne sont ni la DCI ni des mots de liaison (ex. « Kétoprofène Pharmy II »).
  const motsLabo = estDci ? motsNom.filter(m => !dansDci(m) && m.length >= 2 && !MOTS_VIDES.has(m)
    && !['II', 'LP', 'TOUS', 'DOSAGES', 'DOSAGE', 'FORMES'].includes(m) && formes(m).size === 0) : [];
  return {
    specialite: corps,
    dci,
    substances: listeSubst,
    marque,
    labos: labosDansMots(mots(corps)),
    motsLabo,
    generique,
    tousDosages: /TOUS DOSAGES|GAMME/.test(n),
    dosages: dosages(n),
    formes: formes(n)
  };
}

function lireExportANSM(buffer, statutsActifs) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const lignes = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: false });
  const entete = (lignes[0] || []).map(h => norm(h).trim());
  const col = nom => entete.findIndex(h => h.startsWith(nom));
  const iTitre = col('TITRE'), iMaj = col('DATE DE MISE A JOUR'), iStatut = col('STATUT'), iUrl = col('URL');
  if (iTitre < 0 || iStatut < 0) throw new Error("Format de l'export ANSM non reconnu (colonnes Titre/Statut absentes).");
  const actifs = new Set(statutsActifs.map(norm));
  return lignes.slice(1)
    .filter(r => r[iTitre] && r[iStatut] && actifs.has(norm(r[iStatut]).trim()))
    .map(r => ({
      titre: String(r[iTitre]).trim(),
      statut: String(r[iStatut]).trim(),
      maj: r[iMaj] || '',
      url: iUrl >= 0 ? r[iUrl] || '' : '',
      ...analyserTitre(r[iTitre])
    }));
}

// Charge l'export publié avec le site ; signale s'il est absent ou trop ancien.
async function chargerAlertes(config) {
  try {
    // no-cache : revalide auprès du serveur pour obtenir l'export du jour.
    const [repFichier, repMeta] = await Promise.all([
      fetch(config.fichierANSM, { cache: 'no-cache' }),
      fetch(config.metaANSM, { cache: 'no-cache' })
    ]);
    if (!repFichier.ok) throw new Error('export introuvable (HTTP ' + repFichier.status + ')');
    const alertes = lireExportANSM(await repFichier.arrayBuffer(), config.statutsANSMActifs);
    const meta = repMeta.ok ? await repMeta.json() : { date: null, source: 'téléchargement automatique' };
    const ageHeures = meta.date ? (Date.now() - new Date(meta.date)) / 36e5 : Infinity;
    const avertissement = ageHeures > config.ageMaxANSMHeures
      ? `L'export ANSM ${meta.date ? `date du ${new Date(meta.date).toLocaleString('fr-FR')}` : "n'est pas daté"} : il n'a pas pu être mis à jour récemment. Pour un croisement à jour, chargez l'export manuellement (« Export ANSM manuel »).`
      : null;
    return { alertes, meta, avertissement };
  } catch (e) {
    return {
      alertes: [], meta: null,
      avertissement: `Export ANSM indisponible (${e.message}) : croisement ANSM non réalisé. Vous pouvez charger l'export ANSM manuellement.`
    };
  }
}

// ---------- Croisement ----------

function motCorrespond(motProduit, motRef, estDernier) {
  if (motProduit === motRef) return true;
  // Libellés tronqués à 30 caractères ou abrégés : préfixe suffisamment long.
  if (motRef.startsWith(motProduit) && (motProduit.length >= 6 || (estDernier && motProduit.length >= 5))) return true;
  return false;
}

function contientMot(motsProduit, motRef) {
  return motsProduit.some((m, i) => motCorrespond(m, motRef, i === motsProduit.length - 1));
}

const RANG = { CONFIRME: 3, PROBABLE: 2, DOUTE: 1 };
const SEL_CALCIQUE = /\s(CALCIQUE|CA|CALC)\s/;
const SEL_SODIQUE = /\s(SODIQUE|NA|SOD)\s/;
function libelleDosage(d) {
  const m = d.match(/^([\d.]+)(.*)$/);
  if (!m) return d.toLowerCase();
  let v = parseFloat(m[1]), u = m[2].toLowerCase();
  if (u === 'mg' && v < 0.1) { v = Math.round(v * 1e6) / 1e3; u = 'µg'; }
  return `${v.toLocaleString('fr-FR')} ${u}`;
}
const liste = s => [...s].map(x => LIBELLE_FORME[x] || libelleDosage(x)).join(', ');

function evaluer(produit, a) {
  const nomN = norm(produit.produit);
  const motsP = mots(produit.produit);

  // 1. Molécule : marque identique, ou toutes les substances de la 1re DCI présentes
  //    (la DCI doit ouvrir le libellé : « SODIUM » dans « TELEBRIX 12 SODIUM » ne compte pas).
  const correspondanceMarque = a.marque.length > 0 && motsP[0] === a.marque[0] &&
    (!(NOMS_COMMUNS.has(a.marque[0]) || a.marque[0].length < 4) || a.marque.length < 2 || motsP[1] === a.marque[1]);
  const correspondanceDci = a.substances.length > 0 &&
    a.substances[0].every(m => contientMot(motsP, m)) &&
    a.substances[0].some(m => contientMot(motsP.slice(0, 2), m));
  if (!correspondanceMarque && !correspondanceDci) return null;
  // Sel différent (héparine calcique ≠ héparine sodique) : autre substance.
  const dciN = ' ' + mots(a.dci).join(' ') + ' ';
  for (const [sel, autre] of [[SEL_CALCIQUE, SEL_SODIQUE], [SEL_SODIQUE, SEL_CALCIQUE]]) {
    if (sel.test(dciN) && autre.test(' ' + motsP.join(' ') + ' ')) return null;
  }

  // 2. Forme galénique : OK, DIFFERENTE ou INCONNUE (libellé tronqué ou abrégé).
  const formesP = formes(nomN);
  let etatForme;
  if (a.formes.size === 0) etatForme = 'NON_PRECISEE';
  else if (formesP.size === 0) etatForme = 'INCONNUE';
  else etatForme = [...formesP].some(f => a.formes.has(f)) ? 'OK' : 'DIFFERENTE';
  const formeOK = etatForme === 'OK' || etatForme === 'NON_PRECISEE';

  // 3. Laboratoire.
  let laboOK, noteLabo;
  const labosP = new Set([...labosDansMots(motsP), ...labosDansMots(mots(produit.nomFR))]);
  if (correspondanceMarque) {
    laboOK = true; noteLabo = 'spécialité de marque identique';
  } else if (a.marque.length) {
    // Alerte sur une spécialité de marque, produit générique : autre laboratoire.
    laboOK = false; noteLabo = `spécialité ANSM « ${a.marque.join(' ')} » ≠ produit`;
  } else if (a.labos.size) {
    laboOK = [...a.labos].some(l => labosP.has(l));
    noteLabo = laboOK ? `labo ${[...a.labos].join('/')} identique`
      : `labo ANSM ${[...a.labos].join('/')} ≠ produit (${[...labosP].join('/') || produit.nomFR})`;
  } else if (a.motsLabo.length) {
    const motsFR = mots(produit.nomFR);
    laboOK = a.motsLabo.some(m => contientMot(motsP, m) || contientMot(motsFR, m));
    noteLabo = laboOK ? `labo « ${a.motsLabo.join(' ')} » identique`
      : `labo ANSM « ${a.motsLabo.join(' ')} » ≠ produit (${[...labosP].join('/') || produit.nomFR})`;
  } else {
    laboOK = true; noteLabo = 'alerte non limitée à un laboratoire';
  }

  if (etatForme === 'DIFFERENTE' && !laboOK) return null;

  // 4. Dosage.
  const dosP = dosages(nomN);
  const dosageOK = a.tousDosages || [...dosP].some(d => a.dosages.has(d));

  let confiance;
  if (formeOK && laboOK) confiance = dosageOK ? 'CONFIRME' : 'PROBABLE';
  else if (etatForme === 'INCONNUE' && laboOK && dosageOK) confiance = 'PROBABLE';
  else confiance = 'DOUTE';

  const notes = [];
  notes.push(correspondanceMarque ? `Marque ${a.marque[0]}` : `DCI ${a.substances[0].join(' ').toLowerCase()}`);
  notes.push({
    NON_PRECISEE: 'forme non précisée par l\'ANSM',
    OK: `forme ${liste(a.formes)} concordante`,
    INCONNUE: `forme non identifiable dans le libellé (ANSM : ${liste(a.formes)})`,
    DIFFERENTE: `forme différente (ANSM : ${liste(a.formes)} / produit : ${liste(formesP)})`
  }[etatForme]);
  notes.push(noteLabo);
  notes.push(a.tousDosages ? 'tous dosages concernés'
    : dosageOK ? 'dosage identique'
      : `dosage à vérifier (ANSM : ${liste(a.dosages) || 'non précisé'} / produit : ${liste(dosP) || 'non identifié'})`);
  return { confiance, note: notes.join(' ; ') };
}

function croiser(commandes, alertes) {
  for (const p of commandes) {
    let meilleur = null;
    let nb = 0;
    for (const a of alertes) {
      const r = evaluer(p, a);
      if (!r) continue;
      nb++;
      if (!meilleur || RANG[r.confiance] > RANG[meilleur.confiance] ||
          (RANG[r.confiance] === RANG[meilleur.confiance] && String(a.maj) > String(meilleur.maj))) {
        meilleur = { ...r, statut: a.statut, specialite: a.titre, maj: a.maj, url: a.url };
      }
    }
    if (meilleur && nb > 1) meilleur.note += ` (+${nb - 1} autre(s) alerte(s) possible(s))`;
    p.ansm = meilleur;
  }
}

return { chargerAlertes, lireExportANSM, croiser, analyserTitre, dosages, formes };
})();
