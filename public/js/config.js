// Paramètres de l'application (anciennement config.json).
const CONFIG = {
  tauxTVA: 0.021,
  codesBlocageExclus: ['C', 'E*', 'AUT'],
  // Export ANSM publié avec le site par la tâche GitHub Actions (.github/workflows/deploy.yml).
  fichierANSM: 'data/ansm_export.xls',
  metaANSM: 'data/ansm_meta.json',
  // Au-delà de ce délai, un bandeau signale que l'export ANSM n'est plus à jour.
  ageMaxANSMHeures: 36,
  statutsANSMActifs: [
    'Rupture de stock',
    "Tension d'approvisionnement",
    'Remise à disposition',
    'Arrêt de commercialisation'
  ]
};
