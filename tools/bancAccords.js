/*
 * Banc de nommage d'accord — OUTIL de développement, hors portique.
 *
 * ## Pourquoi il existe
 *
 * Le contrat PMDI (docs/12) transporte `{root, quality}` pour chaque accord.
 * Ces deux champs ne sont pas produits ici : ils viennent de Beat Studio, où
 * `_detectChordName` nomme l'accord et où deux points d'export en dérivent la
 * qualité. PULSAR les CONSOMME — la rotation de teinte d'ADR-015 lit `root`,
 * et une scène future lira `quality`. Une erreur de nommage côté hôte devient
 * donc une erreur de couleur ici, sans qu'aucun test de ce dépôt ne la voie.
 *
 * Quatre lots successifs ont corrigé cette chaîne (quinte exigée à tort,
 * fondamentale prise sur le premier élément du tableau, `m7` au lieu de
 * `min7`, `sus47` au lieu de `7sus4`), chacun vérifié par une sonde jetable.
 * Rien ne protégeait les lots précédents des suivants. Ce banc est ce filet.
 *
 * ## Pourquoi ce n'est PAS un test vitest
 *
 * Il mesure un fichier EXTERNE au dépôt — la lignée `Beat_Studio_CDJ_MOBILE_
 * alpha*.html`, dont `docs/20` donne le fichier canonique. Un test qui échoue
 * quand ce fichier est absent ferait tomber le portique sur toute machine qui
 * ne l'a pas, et un test qui se contente de sauter mentirait sur sa
 * couverture. C'est donc un outil, lancé à la main quand la chaîne d'accords
 * bouge :
 *
 *     npm run banc:accords -- <fichier.html>              détail d'une version
 *     npm run banc:accords -- <f1.html> <f2.html> ...     comparaison
 *
 * ## Ce qu'il teste vraiment
 *
 * Il EXTRAIT du fichier livré le texte des fonctions (gabarits, choix de
 * fondamentale, nommage, normalisation), lit les drapeaux tels qu'ils y sont
 * posés, puis exécute la chaîne. Rien n'est retapé : recopier la logique dans
 * un test n'aurait prouvé que la fidélité de la frappe. Les versions
 * anciennes n'ont pas toutes les pièces — leur extraction est facultative,
 * sans quoi le banc ne saurait mesurer que la dernière version, c'est-à-dire
 * tout sauf une régression.
 *
 * Code de sortie : 0 si la DERNIÈRE version passée est saine, 1 sinon —
 * jamais l'état des versions anciennes, qui sont là pour montrer d'où l'on
 * vient, pas pour faire échouer la livraison du jour.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * La table de vérité. Chaque ligne dit ce que NOUS avons décidé, pas ce qu'un
 * traité d'harmonie exigerait — deux conventions y sont des choix assumés :
 * un renversement est nommé par sa fondamentale et non en accord barré
 * (`C/E`), et une dyade conserve la lecture d'avant, faute de preuve.
 */
const TABLE = [
  { notes: ['C4', 'E4', 'G4'], nom: 'C', qualite: 'maj', quoi: 'triade majeure' },
  { notes: ['A3', 'C4', 'E4'], nom: 'Am', qualite: 'min', quoi: 'triade mineure' },
  { notes: ['A3', 'C4', 'E4', 'G4'], nom: 'Am7', qualite: 'min7', quoi: 'mineur septieme' },
  { notes: ['C4', 'E4', 'G4', 'B4'], nom: 'Cmaj7', qualite: 'maj7', quoi: 'majeur septieme' },
  { notes: ['G3', 'B3', 'F4'], nom: 'G7', qualite: '7', quoi: 'V7 SANS QUINTE' },
  { notes: ['E3', 'G3', 'C4'], nom: 'C', qualite: 'maj', quoi: '1er renversement' },
  { notes: ['G3', 'C4', 'E4'], nom: 'C', qualite: 'maj', quoi: '2e renversement' },
  { notes: ['E4', 'F#3', 'A3'], nom: 'F#m7', qualite: 'min7', quoi: 'tableau NON trie' },
  { notes: ['D4', 'G4', 'A#4'], nom: 'Gm', qualite: 'min', quoi: 'fondamentale en 2e' },
  { notes: ['C4', 'F4', 'G4', 'A#4'], nom: 'C7sus4', qualite: '7sus4', quoi: 'suspendue + 7e' },
  { notes: ['C4', 'D4', 'G4', 'A#4'], nom: 'C7sus2', qualite: '7sus2', quoi: 'suspendue + 7e' },
  { notes: ['C4', 'F4', 'G4'], nom: 'Csus4', qualite: 'sus4', quoi: 'suspendue' },
  { notes: ['C4', 'G4'], nom: 'C5', qualite: '5', quoi: 'quinte a vide' },
  { notes: ['E4', 'G#4', 'A3'], nom: 'Amaj7', qualite: 'maj7', quoi: '7e SANS tierce' },
  { notes: ['G#4', 'C4'], nom: 'G#', qualite: 'maj', quoi: 'dyade (on ne devine pas)' },
];

const FLAGS = ['_CHORD_DETECT_V2', '_CHORD_ROOT_V3', '_PMDI_QUALITY_NORM_V1', '_CHORD_SUS_ORDER_V1'];

/** Construit, pour un fichier, la chaîne de nommage isolée dans son propre scope. */
function chargerChaine(fichier) {
  const src = fs.readFileSync(fichier, 'utf8');
  const extraire = (motif, nom, optionnel) => {
    const m = src.match(motif);
    if (!m) {
      if (optionnel) return '';
      throw new Error(`${path.basename(fichier)} : ${nom} introuvable`);
    }
    return m[0];
  };
  const drapeaux = {};
  const declarations = FLAGS.map((f) => {
    const m = src.match(new RegExp(`const ${f}=(true|false);`));
    drapeaux[f] = m ? m[1] === 'true' : null;
    return `var ${f} = ${m ? m[1] : 'false'};`;
  }).join('\n');

  const corps = [
    declarations,
    extraire(/const _CHORD_TEMPLATES=\[[\s\S]*?\];/, '_CHORD_TEMPLATES', true),
    extraire(/function _chordNoteNamesToPitchClasses\(names\)\{[\s\S]*?\n\}/, '_chordNoteNamesToPitchClasses'),
    extraire(/function _chordRootFromNames\(names,pcs\)\{[\s\S]*?\n\}/, '_chordRootFromNames', true),
    extraire(/function _detectChordName\(names\)\{[\s\S]*?\n\}/, '_detectChordName'),
    extraire(/function _pmdiNormalizeQuality\(q\)\{[\s\S]*?\n\}/, '_pmdiNormalizeQuality', true),
    'return { detect: _detectChordName, norm: (typeof _pmdiNormalizeQuality === "function") ? _pmdiNormalizeQuality : null };',
  ].filter(Boolean).join('\n');

  const api = new Function(corps)();
  const normalise = drapeaux._PMDI_QUALITY_NORM_V1 === true && api.norm;

  /** Reproduit ce que font les DEUX points d'export pour obtenir `quality`. */
  const qualite = (nom) => {
    const m = /^([A-G]#?)/.exec(nom);
    const racine = m ? m[1] : '';
    let q = nom.startsWith(racine) ? nom.slice(racine.length) : nom;
    if (q === '') q = 'maj';
    else if (normalise) q = api.norm(q);
    else if (q === 'm') q = 'min';
    return q;
  };

  return {
    label: path.basename(fichier).replace(/^Beat_Studio_CDJ_MOBILE_/, '').replace(/\.html$/, ''),
    drapeaux,
    resultats: TABLE.map((c) => {
      const nom = api.detect(c.notes);
      const q = qualite(nom);
      return { nom, q, nomOk: nom === c.nom, qOk: q === c.qualite, ok: nom === c.nom && q === c.qualite };
    }),
  };
}

/** Marqueur compact : `ok`, le nom faux, ou `»qualite` quand seule l'orthographe cloche. */
function marqueur(r) {
  if (r.ok) return 'ok';
  return r.nomOk ? `»${r.q}` : r.nom;
}

const fichiers = process.argv.slice(2);
if (!fichiers.length) {
  console.error('usage : npm run banc:accords -- <fichier.html> [autres.html ...]');
  console.error('Le fichier canonique de la lignée Beat Studio est indiqué dans docs/20_FEUILLE_DE_ROUTE_SESSIONS.md.');
  process.exit(2);
}

const versions = fichiers.map(chargerChaine);
let faux = 0;

if (versions.length === 1) {
  const v = versions[0];
  console.log(`fichier : ${v.label}`);
  console.log('drapeaux : ' + FLAGS.map((f) => `${f.replace(/^_/, '')}=${v.drapeaux[f] === null ? 'absent' : v.drapeaux[f]}`).join(' ') + '\n');
  console.log(`  ${'accord'.padEnd(30)} ${'nom'.padEnd(9)} ${'attendu'.padEnd(9)} ${'quality'.padEnd(9)} attendu`);
  TABLE.forEach((c, i) => {
    const r = v.resultats[i];
    if (!r.ok) faux++;
    console.log(`  ${r.ok ? ' ' : 'X'} ${JSON.stringify(c.notes).padEnd(28)} ${r.nom.padEnd(9)} ${c.nom.padEnd(9)} ${r.q.padEnd(9)} ${c.qualite}`);
  });
  console.log(faux === 0 ? `\nTOUS JUSTES (${TABLE.length} accords)` : `\n${faux} ACCORD(S) FAUX sur ${TABLE.length}`);
} else {
  const larg = Math.max(9, ...versions.map((v) => v.label.length + 1));
  console.log(`${'cas'.padEnd(26)} ${versions.map((v) => v.label.padEnd(larg)).join('')}`);
  console.log('-'.repeat(26 + larg * versions.length));
  TABLE.forEach((c, i) => {
    console.log(`${c.quoi.padEnd(26)} ${versions.map((v) => marqueur(v.resultats[i]).padEnd(larg)).join('')}`);
  });
  console.log('-'.repeat(26 + larg * versions.length));
  console.log(`${'FAUX sur ' + TABLE.length}`.padEnd(26) + ' ' +
    versions.map((v) => String(v.resultats.filter((r) => !r.ok).length).padEnd(larg)).join(''));
  console.log('\n« ok » = nom ET quality justes · « »xxx » = nom juste, orthographe de quality fausse · sinon le nom rendu.');
  faux = versions[versions.length - 1].resultats.filter((r) => !r.ok).length;
}

process.exit(faux === 0 ? 0 : 1);
