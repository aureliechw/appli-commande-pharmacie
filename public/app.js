'use strict';

const CLE_STOCKAGE = 'appliCommande:session';
const etat = { analyse: null, lignes: [], tauxTVA: 0.021, replies: new Set() };

const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const num = (v, f = nf0) => (v == null ? '∞' : f.format(v));

const CLASSE_STATUT = {
  'Rupture de stock': 'rupture',
  "Tension d'approvisionnement": 'tension',
  'Arrêt de commercialisation': 'arret',
  'Remise à disposition': 'remise'
};
const ORDRE_CONFIANCE = { CONFIRME: 0, PROBABLE: 1, DOUTE: 2 };

// ---------- Persistance locale (confort : reprise après rechargement de la page) ----------

function sauvegarder() {
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify({
      analyse: etat.analyse,
      modifs: etat.lignes.filter(l => l.type !== 'AJOUT').map(l => ({ id: l.id, qte: l.qte, supprimee: l.supprimee })),
      ajouts: etat.lignes.filter(l => l.type === 'AJOUT').map(l => ({ code: l.code, qte: l.qte }))
    }));
  } catch (e) { /* stockage indisponible : sans conséquence */ }
}

function restaurer() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return false;
    const { analyse, modifs, ajouts } = JSON.parse(brut);
    if (!analyse || !analyse.commandes) return false;
    initialiser(analyse);
    const parId = new Map(modifs.map(m => [m.id, m]));
    etat.lignes.forEach(l => {
      const m = parId.get(l.id);
      if (m) { l.qte = m.qte; l.supprimee = m.supprimee; }
    });
    (ajouts || []).forEach(a => { const l = ajouterProduit(a.code); if (l) l.qte = a.qte; });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- Chargement ----------

const inputFichier = $('#fichier');
const zone = $('#zoneFichier');

inputFichier.addEventListener('change', () => {
  $('#libelleFichier').textContent = inputFichier.files[0] ? inputFichier.files[0].name : 'Choisir ou déposer le fichier du jour';
});
['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('survol'); }));
['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('survol'); }));
zone.addEventListener('drop', e => {
  if (e.dataTransfer.files.length) {
    inputFichier.files = e.dataTransfer.files;
    inputFichier.dispatchEvent(new Event('change'));
  }
});

$('#formChargement').addEventListener('submit', async e => {
  e.preventDefault();
  if (!inputFichier.files[0]) return;
  if (etat.analyse && etat.lignes.some(l => l.supprimee || l.qte !== l.qteCalculee || l.type === 'AJOUT') &&
      !confirm('Une commande en cours contient des modifications. Les remplacer par une nouvelle analyse ?')) return;

  $('#erreur').hidden = true;
  $('#accueil').hidden = true;
  $('#resultats').hidden = true;
  $('#barreExport').hidden = true;
  $('#chargementEnCours').hidden = false;
  $('#btnAnalyser').disabled = true;
  try {
    initialiser(await analyser(inputFichier.files[0], $('#fichierAnsm').files[0]));
    sauvegarder();
    afficher();
  } catch (err) {
    $('#erreur').textContent = 'Analyse impossible : ' + err.message;
    $('#erreur').hidden = false;
    if (etat.analyse) afficher(); else $('#accueil').hidden = false;
  } finally {
    $('#chargementEnCours').hidden = true;
    $('#btnAnalyser').disabled = false;
  }
});

const nombreJSON = n => (Number.isFinite(n) ? n : null);

// Champs conservés pour l'affichage et la sauvegarde locale.
function versClient(p) {
  return {
    code: p.code, produit: p.produit, typeFS: p.typeFS, blocage: p.blocage,
    stockMin: p.stockMin, qteMin: p.qteMin, qteMinAbsente: p.qteMinAbsente,
    stock: p.stock, enCommande: p.enCommande, stockEffectif: p.stockEffectif,
    m1: p.m1, m2: p.m2, m3: p.m3, m11: p.m11, moyenne: p.moyenne,
    consoPrev: p.consoPrev, consoJour: p.consoJour, joursStock: nombreJSON(p.joursStock),
    delai: p.delai, seuil: p.seuil, freq: p.freq,
    qteCalculee: p.qteCalculee, type: p.type, motif: p.motif,
    viaM11: p.viaM11, ruptureAvantLivraison: p.ruptureAvantLivraison,
    codeFR: p.codeFR, nomFR: p.nomFR, pump: p.pump, ansm: p.ansm
  };
}

// Analyse entièrement locale : le fichier du jour ne quitte pas le poste.
async function analyser(fichier, fichierANSM) {
  const lignes = Calcul.lireFichierSource(await fichier.arrayBuffer());
  const { commandes, nonRetenus, stats } = Calcul.calculerCommandes(lignes, CONFIG);

  let resultatANSM;
  if (fichierANSM) {
    const alertes = ANSM.lireExportANSM(await fichierANSM.arrayBuffer(), CONFIG.statutsANSMActifs);
    resultatANSM = { alertes, meta: { date: new Date().toISOString(), source: 'chargement manuel' }, avertissement: null };
  } else {
    resultatANSM = await ANSM.chargerAlertes(CONFIG);
  }
  ANSM.croiser(commandes, resultatANSM.alertes);
  ANSM.croiser(nonRetenus, resultatANSM.alertes);

  return {
    nomFichier: fichier.name,
    dateAnalyse: new Date().toISOString(),
    tauxTVA: CONFIG.tauxTVA,
    commandes: commandes.map(versClient),
    nonRetenus: nonRetenus.map(versClient),
    stats,
    ansm: {
      nbAlertes: resultatANSM.alertes.length,
      date: resultatANSM.meta && resultatANSM.meta.date,
      source: resultatANSM.meta && resultatANSM.meta.source,
      avertissement: resultatANSM.avertissement
    }
  };
}

function initialiser(analyse) {
  etat.analyse = analyse;
  etat.tauxTVA = analyse.tauxTVA;
  etat.lignes = analyse.commandes.map((c, i) => ({ ...c, id: c.code + '|' + i, qte: c.qteCalculee, supprimee: false }));
  // Tous les laboratoires sont repliés par défaut.
  etat.replies = new Set(etat.lignes.map(l => l.codeFR));
}

// Ajoute à la commande un médicament non préconisé ; le motif garde la raison de son exclusion.
function ajouterProduit(code) {
  if (etat.lignes.some(l => l.code === code)) return null;
  const p = (etat.analyse.nonRetenus || []).find(x => x.code === code);
  if (!p) return null;
  const l = { ...p, type: 'AJOUT', id: 'ajout|' + p.code, qte: p.qteCalculee, supprimee: false };
  etat.lignes.push(l);
  return l;
}

// ---------- Calculs ----------

function fournisseurs() {
  const map = new Map();
  for (const l of etat.lignes) {
    if (!map.has(l.codeFR)) map.set(l.codeFR, { codeFR: l.codeFR, nomFR: l.nomFR, freq: l.freq, lignes: [] });
    map.get(l.codeFR).lignes.push(l);
  }
  return [...map.values()].sort((a, b) => a.nomFR.localeCompare(b.nomFR, 'fr'));
}

const compter = (lignes, type) => lignes.filter(l => l.type === type).length;

function couts(lignes) {
  const ht = lignes.filter(l => !l.supprimee).reduce((s, l) => s + (l.qte || 0) * l.pump, 0);
  const tva = ht * etat.tauxTVA;
  return { ht, tva, ttc: ht + tva };
}

const actives = () => etat.lignes.filter(l => !l.supprimee && l.qte > 0);

// ---------- Affichage ----------

function afficher() {
  const a = etat.analyse;
  $('#accueil').hidden = true;
  $('#resultats').hidden = false;
  $('#barreExport').hidden = false;
  $('#infoFichier').textContent = `${a.nomFichier} — analysé le ${new Date(a.dateAnalyse).toLocaleString('fr-FR')}`;

  const av = $('#avertissementAnsm');
  av.hidden = !a.ansm.avertissement;
  av.textContent = a.ansm.avertissement || '';
  $('#infoAnsm').textContent = a.ansm.date
    ? `${a.ansm.nbAlertes} alertes actives — export ANSM du ${new Date(a.ansm.date).toLocaleString('fr-FR')} (${a.ansm.source})`
    : 'Export ANSM indisponible';
  $('#infoExclus').textContent = a.stats.nbExclusBlocage
    ? `${a.stats.nbExclusBlocage} produit(s) exclu(s) pour code blocage : ` +
      a.stats.detailExclus.map(p => `${p.produit} (${p.blocage})`).join(', ')
    : '';

  majListeFournisseurs();
  rendreFournisseurs();
  majBilan();
  majHauteursCollantes();
}

function majListeFournisseurs() {
  $('#allerA').innerHTML = '<option value="">Aller au fournisseur…</option>' +
    fournisseurs().map(f => `<option value="${esc(f.codeFR)}">${esc(f.nomFR)}</option>`).join('');
}

function classesLigne(l) {
  const c = [{ DECLENCHEUR: 'ligne-declencheur', COMPLEMENT: 'ligne-complement', AJOUT: 'ligne-ajout' }[l.type]];
  if (l.ansm) {
    c.push('ansm-' + (CLASSE_STATUT[l.ansm.statut] || 'tension'));
    if (l.ansm.confiance === 'DOUTE') c.push('ansm-doute');
  }
  return c.join(' ');
}

function celluleQte(l) {
  const modifiee = l.qte !== l.qteCalculee;
  const nonMultiple = l.qte > 0 && l.qteMin > 1 && l.qte % l.qteMin !== 0;
  return `<td class="num col-qte">
    <input type="number" class="qte${modifiee ? ' modifiee' : ''}${nonMultiple ? ' non-multiple' : ''}"
      min="0" step="${l.qteMin}" value="${l.qte}" data-id="${esc(l.id)}"
      aria-label="Quantité à commander pour ${esc(l.produit)}"
      title="${nonMultiple ? `Attention : pas un multiple de ${l.qteMin}` : `Multiple de commande : ${l.qteMin}`}">
    <span class="qte-calc"${modifiee ? '' : ' hidden'}>calculé ${nf0.format(l.qteCalculee)}
      <button type="button" class="btn-lien" data-reinit="${esc(l.id)}" title="Revenir à la quantité calculée">↺</button></span>
  </td>`;
}

function ligneHTML(l) {
  const a = l.ansm;
  const statut = a ? `<span class="statut statut-${CLASSE_STATUT[a.statut] || 'tension'}">⚠ ${esc(a.statut)}</span>` : '';
  const tags = (l.viaM11 ? '<span class="tag tag-m11" title="Conso prévisionnelle = conso M-11">M-11</span>' : '') +
    (l.ruptureAvantLivraison ? '<span class="tag tag-epuise" title="Le stock sera épuisé avant la livraison">Épuisé avant livraison</span>' : '') +
    (l.qteMinAbsente ? '<span class="tag tag-epuise" title="Qté min absente du fichier : 1 utilisée">Qté min ?</span>' : '');
  const typeBadge = {
    DECLENCHEUR: '<span class="badge badge-declencheur">Déclencheur</span>',
    COMPLEMENT: '<span class="badge badge-complement">Complément</span>',
    AJOUT: '<span class="badge badge-ajout">Ajout manuel</span>'
  }[l.type];
  const motif = esc(l.motif.replace(/^(Déclencheur|Complément) — /, '').replace(/^Non retenu — /, 'Non retenu par l\'application : '));
  return `<tr class="${classesLigne(l)}" data-id="${esc(l.id)}">
    <td class="col-code">${esc(l.code)}</td>
    <td class="col-produit">${esc(l.produit)}${tags}</td>
    ${celluleQte(l)}
    <td>${esc(l.typeFS)}</td>
    <td class="num">${num(l.stockMin)}</td>
    <td class="num">${num(l.qteMin)}</td>
    <td class="num">${num(l.stock)}</td>
    <td class="num">${num(l.enCommande)}</td>
    <td class="num">${num(l.stockEffectif)}</td>
    <td class="num">${num(l.m1)}</td>
    <td class="num">${num(l.m2)}</td>
    <td class="num">${num(l.m3)}</td>
    <td class="num${l.viaM11 ? ' cell-m11' : ''}">${num(l.m11)}</td>
    <td class="num${l.viaM11 ? ' cell-m11' : ''}" title="Moyenne M-1/M-2/M-3 : ${nf1.format(l.moyenne)}">${num(l.consoPrev, nf1)}</td>
    <td class="num">${num(l.consoJour, nf2)}</td>
    <td class="num${l.ruptureAvantLivraison ? ' jours-critique' : ''}">${num(l.joursStock, nf1)}</td>
    <td class="num">${num(l.delai)}</td>
    <td class="num">${num(l.seuil)}</td>
    <td class="num">${num(l.freq)}</td>
    <td class="motif">${typeBadge}${motif}</td>
    <td>${statut}</td>
    <td>${a ? `<span class="confiance confiance-${a.confiance}">${a.confiance}</span>` : ''}</td>
    <td class="texte-long">${a ? (a.url ? `<a class="lien-ansm" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.specialite)}</a>` : esc(a.specialite)) : ''}</td>
    <td>${a ? esc(formatDate(a.maj)) : ''}</td>
    <td class="texte-long">${a ? esc(a.note) : ''}</td>
    <td class="col-action"><button type="button" class="btn-icone" data-suppr="${esc(l.id)}" title="Supprimer la ligne" aria-label="Supprimer ${esc(l.produit)}">✕</button></td>
  </tr>`;
}

function formatDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// Colonnes (largeurs fixes partagées par l'en-tête collant et le corps du tableau).
const COLONNES = [
  ['Code produit', 92, 'col-code'], ['Produit', 240, 'col-produit'], ['Qté à commander', 104, 'col-qte num'],
  ['Type FS', 58], ['Stock min', 64, 'num'], ['Qté min cmd', 64, 'num'], ['Stock', 64, 'num'],
  ['En commande', 78, 'num'], ['Stock effectif', 72, 'num'], ['Conso M-1', 66, 'num'], ['Conso M-2', 66, 'num'],
  ['Conso M-3', 66, 'num'], ['Conso M-11', 72, 'num'], ['Conso prev/mois', 78, 'num'], ['Conso/jour', 72, 'num'],
  ['Jours stock', 70, 'num'], ['Délai liv. (j)', 64, 'num'], ['Seuil (j)', 58, 'num'], ['Fréq cmd (j)', 62, 'num'],
  ['Motif commande', 280, 'motif'], ['⚠ Statut ANSM', 190], ['Confiance', 92], ['Spécialité ANSM (alerte)', 300],
  ['Màj ANSM', 88], ['Note ANSM', 340], ['Suppr.', 46, 'col-action']
];
const LARGEUR_TABLE = COLONNES.reduce((s, c) => s + c[1], 0);
const COLGROUP = '<colgroup>' + COLONNES.map(c => `<col style="width:${c[1]}px">`).join('') + '</colgroup>';

function enteteHTML() {
  return COLGROUP + '<thead><tr>' + COLONNES.map(([titre, , cls]) =>
    `<th${cls ? ` class="${cls}"` : ''}>${cls && cls.startsWith('col-qte') ? `<b>${esc(titre)}</b>` : esc(titre)}</th>`
  ).join('') + '</tr></thead>';
}

function filtre() {
  const q = $('#recherche').value.trim().toLowerCase();
  const type = $('#filtreType').value;
  const fa = $('#filtreAnsm').checked, fm = $('#filtreM11').checked, fe = $('#filtreEpuise').checked;
  return l => !l.supprimee &&
    (!q || l.produit.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)) &&
    (!type || l.type === type) && (!fa || l.ansm) && (!fm || l.viaM11) && (!fe || l.ruptureAvantLivraison);
}

function rendreFournisseurs() {
  const garde = filtre();
  const entete = enteteHTML();
  const sansFiltre = estSansFiltre();
  const html = fournisseurs().map(f => {
    const visibles = f.lignes.filter(garde);
    const supprimees = f.lignes.filter(l => l.supprimee).length;
    const restantes = f.lignes.filter(l => !l.supprimee);
    if (!visibles.length && !(supprimees && !restantes.length && sansFiltre)) return '';
    const nbD = compter(restantes, 'DECLENCHEUR');
    const nbC = compter(restantes, 'COMPLEMENT');
    const nbA = compter(restantes, 'AJOUT');
    // Replié par défaut, sauf quand un filtre ou une recherche est actif.
    const replie = etat.replies.has(f.codeFR) && sansFiltre;
    return `<section class="fournisseur${replie ? ' replie' : ''}" id="f-${esc(f.codeFR)}" data-fr="${esc(f.codeFR)}">
      <div class="fournisseur-collant">
        <div class="fournisseur-entete" data-basculer="${esc(f.codeFR)}">
          <div class="fournisseur-nom">
            <span class="chevron">▾</span>
            <h3>${esc(f.nomFR)}</h3>
            <span class="discret">${esc(f.codeFR)} · ${restantes.length} ligne(s) : ${nbD} déclencheur(s), ${nbC} complément(s)${nbA ? `, ${nbA} ajout(s) manuel(s)` : ''} · commande tous les ${f.freq} j</span>
          </div>
          <div class="couts" data-couts="${esc(f.codeFR)}">${coutsHTML(f.lignes)}</div>
        </div>
        <div class="entetes-colonnes">
          <table class="commande" style="width:${LARGEUR_TABLE}px">${entete}</table>
        </div>
      </div>
      <div class="table-conteneur">
        <table class="commande" style="width:${LARGEUR_TABLE}px">${COLGROUP}<tbody>${visibles.map(ligneHTML).join('')}</tbody></table>
      </div>
      ${supprimees ? `<div class="fournisseur-pied">${supprimees} ligne(s) supprimée(s) —
        <button type="button" class="btn-lien" data-restaurer="${esc(f.codeFR)}">restaurer</button></div>` : ''}
    </section>`;
  }).join('');
  $('#fournisseurs').innerHTML = html || '<p class="discret">Aucune ligne ne correspond aux filtres.</p>';
}

function estSansFiltre() {
  return !$('#recherche').value.trim() && !$('#filtreType').value &&
    !$('#filtreAnsm').checked && !$('#filtreM11').checked && !$('#filtreEpuise').checked;
}

function coutsHTML(lignes) {
  const c = couts(lignes);
  return `<div class="cout"><div class="cout-libelle">Total HT</div><div class="cout-valeur">${euro.format(c.ht)}</div></div>
    <div class="cout"><div class="cout-libelle">TVA ${nf1.format(etat.tauxTVA * 100)} %</div><div class="cout-valeur">${euro.format(c.tva)}</div></div>
    <div class="cout cout-ttc"><div class="cout-libelle">Total TTC</div><div class="cout-valeur">${euro.format(c.ttc)}</div></div>`;
}

function majBilan() {
  const lignes = etat.lignes.filter(l => !l.supprimee);
  const nbFourn = new Set(lignes.map(l => l.codeFR)).size;
  const nbD = compter(lignes, 'DECLENCHEUR');
  const nbC = compter(lignes, 'COMPLEMENT');
  const nbA = compter(lignes, 'AJOUT');
  const alertes = lignes.filter(l => l.ansm);
  const total = couts(lignes);
  const kpi = (v, lib) => `<div class="kpi"><div class="kpi-valeur">${v}</div><div class="kpi-libelle">${lib}</div></div>`;
  $('#kpis').innerHTML =
    kpi(nf0.format(lignes.length), 'Lignes de commande') +
    kpi(nf0.format(nbFourn), 'Fournisseurs concernés') +
    kpi(nf0.format(nbD), 'Déclencheurs') +
    kpi(nf0.format(nbC), 'Compléments') +
    kpi(nf0.format(nbA), 'Ajouts manuels') +
    kpi(nf0.format(alertes.length), 'Alertes ANSM') +
    kpi(euro.format(total.ttc), `Total TTC (HT ${euro.format(total.ht)})`);

  alertes.sort((x, y) => ORDRE_CONFIANCE[x.ansm.confiance] - ORDRE_CONFIANCE[y.ansm.confiance] ||
    x.produit.localeCompare(y.produit, 'fr'));
  $('#tableAnsm tbody').innerHTML = alertes.length
    ? alertes.map(l => `<tr data-aller="${esc(l.id)}" title="${esc(l.ansm.specialite)}">
        <td>${esc(l.produit)}</td><td>${esc(l.code)}</td>
        <td><span class="statut statut-${CLASSE_STATUT[l.ansm.statut] || 'tension'}">${esc(l.ansm.statut)}</span></td>
        <td><span class="confiance confiance-${l.ansm.confiance}">${l.ansm.confiance}</span></td>
        <td>${esc(l.nomFR)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="discret">Aucune alerte ANSM pour les produits à commander.</td></tr>';

  const exportables = actives();
  $('#barreTotaux').innerHTML =
    `<span>${exportables.length} ligne(s) · ${new Set(exportables.map(l => l.codeFR)).size} fournisseur(s)</span>
     <span>HT ${euro.format(total.ht)}</span><span>TVA ${euro.format(total.tva)}</span>
     <span>TTC <b>${euro.format(total.ttc)}</b></span>`;
}

function majFournisseur(codeFR) {
  const f = fournisseurs().find(x => x.codeFR === codeFR);
  const zoneCouts = document.querySelector(`[data-couts="${CSS.escape(codeFR)}"]`);
  if (f && zoneCouts) zoneCouts.innerHTML = coutsHTML(f.lignes);
}

// ---------- Interactions ----------

const ligneParId = id => etat.lignes.find(l => l.id === id);

$('#fournisseurs').addEventListener('input', e => {
  const input = e.target.closest('input.qte');
  if (!input) return;
  const l = ligneParId(input.dataset.id);
  const v = Math.max(0, Math.round(Number(input.value)));
  l.qte = Number.isFinite(v) && input.value !== '' ? v : 0;
  const modifiee = l.qte !== l.qteCalculee;
  const nonMultiple = l.qte > 0 && l.qteMin > 1 && l.qte % l.qteMin !== 0;
  input.classList.toggle('modifiee', modifiee);
  input.classList.toggle('non-multiple', nonMultiple);
  input.title = nonMultiple ? `Attention : pas un multiple de ${l.qteMin}` : `Multiple de commande : ${l.qteMin}`;
  input.parentElement.querySelector('.qte-calc').hidden = !modifiee;
  majFournisseur(l.codeFR);
  majBilan();
  sauvegarder();
});

$('#fournisseurs').addEventListener('click', e => {
  const suppr = e.target.closest('[data-suppr]');
  if (suppr) {
    const l = ligneParId(suppr.dataset.suppr);
    // Un ajout manuel supprimé retourne dans la liste des médicaments ajoutables.
    if (l.type === 'AJOUT') etat.lignes.splice(etat.lignes.indexOf(l), 1);
    else l.supprimee = true;
    rendreFournisseurs(); majBilan(); majListeFournisseurs(); sauvegarder();
    return;
  }
  const reinit = e.target.closest('[data-reinit]');
  if (reinit) {
    const l = ligneParId(reinit.dataset.reinit);
    l.qte = l.qteCalculee;
    const tr = reinit.closest('tr');
    tr.outerHTML = ligneHTML(l);
    majFournisseur(l.codeFR); majBilan(); sauvegarder();
    return;
  }
  const rest = e.target.closest('[data-restaurer]');
  if (rest) {
    etat.lignes.filter(l => l.codeFR === rest.dataset.restaurer).forEach(l => { l.supprimee = false; });
    rendreFournisseurs(); majBilan(); sauvegarder();
    return;
  }
  const bascule = e.target.closest('[data-basculer]');
  if (bascule) {
    const code = bascule.dataset.basculer;
    if (etat.replies.has(code)) etat.replies.delete(code); else etat.replies.add(code);
    bascule.closest('.fournisseur').classList.toggle('replie');
  }
});

// Entrée dans une quantité : passer à la ligne suivante.
$('#fournisseurs').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('input.qte')) return;
  e.preventDefault();
  const champs = [...document.querySelectorAll('input.qte')].filter(c => c.offsetParent !== null);
  const suivant = champs[champs.indexOf(e.target) + 1];
  if (suivant) { suivant.focus(); suivant.select(); }
});

// Défilement horizontal synchronisé entre l'en-tête collant et le corps du tableau.
document.addEventListener('scroll', e => {
  const cible = e.target;
  if (!(cible instanceof Element)) return;
  const section = cible.closest('.fournisseur');
  if (!section) return;
  let autre = null;
  if (cible.classList.contains('table-conteneur')) autre = section.querySelector('.entetes-colonnes');
  else if (cible.classList.contains('entetes-colonnes')) autre = section.querySelector('.table-conteneur');
  if (autre && autre.scrollLeft !== cible.scrollLeft) autre.scrollLeft = cible.scrollLeft;
}, true);

// Hauteurs des bandeaux collants (en-tête de page + filtres) pour positionner celui du laboratoire.
function majHauteursCollantes() {
  const entete = document.querySelector('.entete');
  const hEntete = getComputedStyle(entete).position === 'sticky' ? entete.offsetHeight : 0;
  document.documentElement.style.setProperty('--haut-entete', hEntete + 'px');
  document.documentElement.style.setProperty('--haut-filtres', document.querySelector('.filtres').offsetHeight + 'px');
}
window.addEventListener('resize', majHauteursCollantes);
new ResizeObserver(majHauteursCollantes).observe(document.querySelector('.entete'));

['#recherche', '#filtreType', '#filtreAnsm', '#filtreM11', '#filtreEpuise'].forEach(s =>
  $(s).addEventListener(s === '#recherche' ? 'input' : 'change', rendreFournisseurs));

function allerA(selecteur) {
  const cible = document.querySelector(selecteur);
  if (!cible) return;
  const section = cible.closest('.fournisseur');
  if (section && section.classList.contains('replie')) {
    etat.replies.delete(section.dataset.fr);
    section.classList.remove('replie');
  }
  cible.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (cible.tagName === 'TR') {
    cible.classList.remove('surligne'); void cible.offsetWidth; cible.classList.add('surligne');
  }
}

$('#allerA').addEventListener('change', e => {
  if (e.target.value) allerA(`#f-${CSS.escape(e.target.value)}`);
  e.target.value = '';
});

$('#tableAnsm').addEventListener('click', e => {
  const tr = e.target.closest('[data-aller]');
  if (!tr) return;
  const l = ligneParId(tr.dataset.aller);
  if (!filtre()(l)) {
    reinitialiserFiltres();
    rendreFournisseurs();
  }
  allerA(`tr[data-id="${CSS.escape(l.id)}"]`);
});

$('#toutReplier').addEventListener('click', () => {
  fournisseurs().forEach(f => etat.replies.add(f.codeFR));
  document.querySelectorAll('.fournisseur').forEach(s => s.classList.add('replie'));
});
$('#toutDeplier').addEventListener('click', () => {
  etat.replies.clear();
  document.querySelectorAll('.fournisseur').forEach(s => s.classList.remove('replie'));
});

// ---------- Ajout d'un médicament non préconisé ----------

const dialogueAjout = $('#dialogueAjout');
const normaliser = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

$('#btnAjout').addEventListener('click', () => {
  $('#rechercheAjout').value = '';
  rechercherAjout();
  dialogueAjout.showModal();
  $('#rechercheAjout').focus();
});

$('#rechercheAjout').addEventListener('input', rechercherAjout);

function rechercherAjout() {
  const q = normaliser($('#rechercheAjout').value.trim());
  const zoneRes = $('#resultatsAjout');
  if (q.length < 2) {
    zoneRes.innerHTML = `<p class="discret">${(etat.analyse.nonRetenus || []).length} produit(s) non retenu(s) disponibles.</p>`;
    return;
  }
  const correspond = p => normaliser(p.produit).includes(q) || normaliser(p.code).includes(q);
  const dansCommande = new Map(etat.lignes.map(l => [l.code, l]));
  const resultats = [
    ...etat.lignes.filter(correspond),
    ...(etat.analyse.nonRetenus || []).filter(p => !dansCommande.has(p.code) && correspond(p))
  ].sort((a, b) => a.produit.localeCompare(b.produit, 'fr'));
  if (!resultats.length) { zoneRes.innerHTML = '<p class="discret">Aucun produit trouvé.</p>'; return; }

  const MAX = 50;
  zoneRes.innerHTML = `<table class="table-ansm">
    <thead><tr><th>Code</th><th>Produit</th><th>Fournisseur</th><th class="num">Stock eff.</th><th class="num">Jours stock</th><th>Situation</th><th></th></tr></thead>
    <tbody>${resultats.slice(0, MAX).map(p => {
      const ligne = dansCommande.get(p.code);
      let situation, action;
      if (!ligne) {
        situation = esc(p.motif.replace(/^Non retenu — /, ''));
        action = `<button type="button" class="btn btn-petit" data-ajouter="${esc(p.code)}">Ajouter</button>`;
      } else if (ligne.supprimee) {
        situation = 'Préconisé, supprimé de la commande';
        action = `<button type="button" class="btn btn-petit" data-ajouter="${esc(p.code)}">Restaurer</button>`;
      } else {
        situation = ligne.type === 'AJOUT' ? 'Déjà ajouté' : 'Déjà dans la commande';
        action = `<button type="button" class="btn btn-petit" data-voir="${esc(ligne.id)}">Voir</button>`;
      }
      return `<tr><td>${esc(p.code)}</td><td>${esc(p.produit)}${p.ansm ? ` <span class="statut statut-${CLASSE_STATUT[p.ansm.statut] || 'tension'}">⚠ ANSM</span>` : ''}</td>
        <td>${esc(p.nomFR)}</td><td class="num">${num(p.stockEffectif)}</td><td class="num">${num(p.joursStock, nf1)}</td>
        <td class="situation">${situation}</td><td>${action}</td></tr>`;
    }).join('')}</tbody></table>
    ${resultats.length > MAX ? `<p class="discret">${resultats.length - MAX} autre(s) résultat(s) : précisez la recherche.</p>` : ''}`;
}

function reinitialiserFiltres() {
  $('#recherche').value = ''; $('#filtreType').value = '';
  ['#filtreAnsm', '#filtreM11', '#filtreEpuise'].forEach(s => { $(s).checked = false; });
}

$('#resultatsAjout').addEventListener('click', e => {
  const btnAjout = e.target.closest('[data-ajouter]');
  const btnVoir = e.target.closest('[data-voir]');
  if (!btnAjout && !btnVoir) return;
  let l;
  if (btnAjout) {
    const code = btnAjout.dataset.ajouter;
    l = etat.lignes.find(x => x.code === code);
    if (l) l.supprimee = false; else l = ajouterProduit(code);
  } else {
    l = ligneParId(btnVoir.dataset.voir);
  }
  if (!l) return;
  dialogueAjout.close();
  etat.replies.delete(l.codeFR);
  reinitialiserFiltres();
  rendreFournisseurs(); majBilan(); majListeFournisseurs(); sauvegarder();
  allerA(`tr[data-id="${CSS.escape(l.id)}"]`);
  const champ = document.querySelector(`input.qte[data-id="${CSS.escape(l.id)}"]`);
  if (champ) setTimeout(() => { champ.focus({ preventScroll: true }); champ.select(); }, 400);
});

// ---------- Validation et export ----------

const dialogue = $('#dialogueExport');
let liensExport = [];

$('#btnValider').addEventListener('click', () => {
  const liste = fournisseurs()
    .map(f => ({ ...f, lignes: f.lignes.filter(l => !l.supprimee && l.qte > 0) }))
    .filter(f => f.lignes.length);
  if (!liste.length) { alert('Aucune ligne à exporter.'); return; }
  const nonMultiples = actives().filter(l => l.qteMin > 1 && l.qte % l.qteMin !== 0).length;
  $('#listeExport').innerHTML = liste.map(f => `<label>
      <input type="checkbox" checked value="${esc(f.codeFR)}">
      <span>${esc(f.nomFR)}</span>
      <span class="discret">${f.lignes.length} ligne(s)</span>
      <span>${euro.format(couts(f.lignes).ttc)} TTC</span></label>`).join('');
  $('#resultatExport').innerHTML = nonMultiples
    ? `<div class="bandeau bandeau-alerte">${nonMultiples} quantité(s) ne sont pas des multiples de la qté min de commande.</div>` : '';
  $('#btnConfirmerExport').disabled = false;
  majTotalExport();
  dialogue.showModal();
});

function selectionExport() {
  const codes = new Set([...$('#listeExport').querySelectorAll('input:checked')].map(i => i.value));
  return fournisseurs()
    .filter(f => codes.has(f.codeFR))
    .map(f => ({ codeFR: f.codeFR, nomFR: f.nomFR, lignes: f.lignes.filter(l => !l.supprimee && l.qte > 0) }));
}

function majTotalExport() {
  const sel = selectionExport();
  const c = couts(sel.flatMap(f => f.lignes));
  $('#totalExport').textContent = `${sel.length} fichier(s) — HT ${euro.format(c.ht)} · TVA ${euro.format(c.tva)} · TTC ${euro.format(c.ttc)}`;
}
$('#listeExport').addEventListener('change', majTotalExport);

$('#btnConfirmerExport').addEventListener('click', async () => {
  const sel = selectionExport();
  if (!sel.length) return;
  const btn = $('#btnConfirmerExport');
  btn.disabled = true;
  $('#resultatExport').innerHTML = '<div class="attente" style="margin:8px 0"><div class="spinner"></div>Génération des fichiers…</div>';
  try {
    const resultat = await Export.genererExports(sel.map(f => ({
      codeFR: f.codeFR, nomFR: f.nomFR,
      lignes: f.lignes.map(l => ({ code: l.code, produit: l.produit, qte: l.qte, qteMin: l.qteMin, pump: l.pump }))
    })), etat.tauxTVA);
    if (!resultat.fichiers.length) throw new Error('Aucune ligne à exporter.');
    // Les liens de l'export précédent sont libérés avant d'en créer de nouveaux.
    liensExport.forEach(URL.revokeObjectURL);
    liensExport = [];
    const lien = blob => { const url = URL.createObjectURL(blob); liensExport.push(url); return url; };
    const urlArchive = lien(resultat.archive.blob);
    $('#resultatExport').innerHTML = `<div class="liens-export">
      <strong>${resultat.fichiers.length} fichier(s) généré(s). Le téléchargement du ZIP démarre ; fichiers individuels :</strong>
      ${resultat.fichiers.map(f => `<a href="${lien(f.blob)}" download="${esc(f.nom)}">${esc(f.nom)}</a>`).join('')}
      <a href="${urlArchive}" download="${esc(resultat.archive.nom)}"><b>Tout télécharger (${esc(resultat.archive.nom)})</b></a></div>`;
    const a = document.createElement('a');
    a.href = urlArchive; a.download = resultat.archive.nom;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (err) {
    $('#resultatExport').innerHTML = `<div class="bandeau bandeau-erreur">Export impossible : ${esc(err.message)}</div>`;
    btn.disabled = false;
  }
});

// ---------- Démarrage ----------

if (restaurer()) afficher();
