# 13 — FORMAT DE PROJET

## Deux supports, un même modèle

| Support | Usage | Contenu |
|---|---|---|
| **IndexedDB** | travail courant, reprise automatique | projet + audio + analyse en cache |
| **Fichier `.pvproj`** | sauvegarde, partage, archivage | projet ; audio référencé ou embarqué |

---

## Modèle

```ts
interface Project {
  format: "pvproj";
  version: 1;

  meta: {
    id: string;                 // UUID
    name: string;
    createdAt: string;
    modifiedAt: string;
    app: string;                // "pulsar-visualizer@1.0.0"
  };

  audio: {
    ref: AudioRef;              // même type que dans le PMDI
    title?: string;
    artist?: string;
    duration: number;
  };

  music: {
    mode: "analysis" | "pmdi";
    analysisProfile?: "fast" | "balanced" | "precise";
    cacheKey?: string;          // hash audio + version d'analyse → réutilisation du cache
    pmdi?: PmdiDocument;        // embarqué uniquement en mode "pmdi"
  };

  visual: {
    presetId: string;
    presetVersion: number;
    overrides: PresetDiff;      // DIFF, jamais une copie complète.
                                // Les macros N'ONT PAS de champ dédié : elles sont
                                // un sous-arbre du diff ("macros.glow": 0.85).
                                // Deux emplacements pour la même valeur = deux
                                // sources de vérité et un conflit à la sauvegarde.
    palette?: string | PaletteOverride;
  };

  export: {
    format: "16:9" | "9:16" | "1:1";
    resolution: [number, number];
    fps: 30 | 60;
    bitrateMbps: number;
    codec: "h264" | "av1";
  };

  prefs: {
    reducedFlashing: boolean;
    quality: "auto" | "low" | "medium" | "high" | "ultra";
    debugOverlay: boolean;
  };

  seed: number;                 // graine du PRNG — garantit un rendu reproductible

  ext?: Record<string, unknown>; // champs inconnus préservés par les migrations
}
```

---

## Trois décisions qui comptent

### 1. Les surcharges sont un diff, pas une copie

```jsonc
// ❌ copie complète — 4 ko, figée à la version du preset du jour de création
"visual": { "preset": { /* tout le preset, dupliqué */ } }

// ✅ diff — 120 octets, bénéficie des améliorations du preset
"visual": {
  "presetId": "trap-dark", "presetVersion": 1,
  "overrides": {
    "macros.glow": 0.85,
    "layers.particles.count": 3200,
    "palette.accent": "#00E5FF"
  }
}
```

Conséquence directe : quand un preset est amélioré dans une mise à jour, **tous les projets
existants en profitent**, sauf sur les points explicitement modifiés par l'utilisateur. Une copie
complète figerait chaque projet dans le passé.

Contrepartie assumée : si un preset change de structure, la migration doit traduire les chemins de
diff obsolètes. `presetVersion` est là pour ça.

### 2. L'analyse n'est pas stockée dans le fichier

Un document PMDI complet pèse 2 à 5 Mo en JSON (les pistes de features dominent : 10 pistes à 172 Hz
sur 4 minutes représentent ≈ 413 000 valeurs). L'embarquer dans
chaque `.pvproj` gonflerait les fichiers sans nécessité, puisque l'analyse est **reproductible à
l'identique** à partir du même audio et de la même version du moteur.

```
cacheKey = sha256( hash_audio + version_moteur_analyse + profil )
```

- Cache présent dans IndexedDB → réutilisé immédiatement, ouverture instantanée.
- Absent → réanalyse (quelques secondes), avec indication à l'utilisateur.
- **Exception** : en `mode: "pmdi"`, le document *est* embarqué, car il n'est pas reproductible :
  il vient de PULSAR et ne peut pas être recalculé depuis l'audio.

### 3. La graine est sauvegardée

```
seed: 1847362910
```

Sans cette graine, deux ouvertures du même projet produiraient deux vidéos différentes — puisque
tout l'aléatoire du moteur est seedé. La sauvegarder rend le projet **rigoureusement reproductible**,
ce qui compte dès qu'on réexporte en plusieurs formats, ou qu'on retouche un projet livré à un client.

Un bouton « Nouvelle variante » régénère simplement la graine : un seul entier, et la même
configuration produit une composition différente. Effet fort, coût nul.

**Implémenté à l'Étape 15/P13** (`src/project/Project.ts`, `src/project/diff.ts`,
`src/ui/App.ts`). Écart assumé sur `visual.overrides` : le diff calculé par l'UI ne couvre que
`macros`/`style`/`prefs.reducedFlashing` — pas les champs `mapping`/`palette`/`classification`
qu'un preset édité via l'éditeur JSON (Étape 14/P12) peut modifier. Un tel preset personnalisé
reste actif pendant la session mais n'est PAS restauré fidèlement après fermeture/réouverture :
seuls macros/style/sécurité survivent. Documenté, pas corrigé — `computePresetDiff`/
`applyPresetDiff` (génériques, testés) le permettraient, mais calculer le diff correct contre la
bonne base (le preset édité lui-même, pas le preset catalogue d'origine) demande une refonte de
`ui/App.ts` hors budget de cette étape.

---

## Fichier `.pvproj`

Archive ZIP (compatible avec l'écosystème, inspectable) :

```
projet.pvproj
├── project.json          # le modèle ci-dessus
├── thumbnail.jpg         # image à 25 % de la durée, pour la liste des projets
├── music.pmdi.json       # uniquement en mode "pmdi"
└── audio/                # uniquement si l'utilisateur choisit d'embarquer
    └── track.mp3
```

Deux modes de sauvegarde proposés :

| Mode | Taille | Usage |
|---|---|---|
| **Léger** (défaut) | 5 à 40 ko | l'audio est référencé par nom + hash ; redemandé à l'ouverture s'il est absent |
| **Complet** | taille de l'audio + 40 ko | tout embarqué ; pour archiver ou transmettre |

Le mode léger avec vérification par hash évite le piège classique : l'utilisateur renomme son MP3, le
projet ne le retrouve plus. Ici, on redemande le fichier avec son nom d'origine, et on vérifie que
c'est bien le bon.

**Implémenté à l'Étape 15/P13** (`src/project/zip.ts`, `src/project/pvproj.ts`). ZIP maison, méthode
STORE uniquement (aucune compression — voir l'en-tête de `zip.ts` pour le raisonnement, même logique
qu'ADR-003/ADR-007 : pas de dépendance tierce pour un gain marginal). `music.pmdi.json` est bien une
entrée séparée de `project.json` (`writePvproj` extrait `project.music.pmdi`, `readPvproj` le
réinjecte avant validation) — jamais dupliqué. Seul le mode « Léger » a une UI complète (référence
par hash, redemande à l'ouverture) ; le mode « Complet » (audio embarqué) est géré par le format et
`readPvproj`/`restoreProject`, mais l'UI de sauvegarde (`btn-project-save-pvproj`) ne propose que le
mode Léger — pas de case à cocher pour embarquer l'audio. Écart assumé, documenté ci-dessous
(docs/JOURNAL.md, Étape 15/P13).

---

## Persistance IndexedDB

```
Base : pulsar-visualizer  (version 1)

Magasins :
  projects     clé: id            → Project + thumbnail
  audioCache   clé: hash          → Blob (LRU, plafond 500 Mo)
  analysisCache clé: cacheKey     → PmdiDocument sérialisé (LRU, plafond 200 Mo)
  settings     clé: "app"         → préférences globales
```

Sauvegarde automatique par diff toutes les 5 secondes après une modification. Les caches sont purgés
en LRU quand le quota approche, et l'utilisateur peut les vider depuis les préférences avec
l'indication de l'espace occupé.

**Point de vigilance** : le stockage navigateur peut être effacé par le système ou l'utilisateur.
`navigator.storage.persist()` est demandé au premier enregistrement, et l'interface indique clairement
que les projets vivent dans le navigateur. Un utilisateur qui perd un mois de travail parce qu'il a
vidé son cache n'accusera pas son navigateur.

**Implémenté à l'Étape 15/P13** (`src/project/storage/db.ts`, `src/project/lru.ts`). Les 4 magasins,
l'éviction LRU (logique de sélection pure et testée, isolée de l'accès IndexedDB lui-même —
`indexedDB` n'existe pas en environnement Node/Vitest, même limite que `AudioEngine`/le Worker
d'analyse) et `navigator.storage.persist()` sont en place. Écart : « demandé au premier
enregistrement » est simplifié en « demandé une fois au démarrage de l'app » (`App.ts`) plutôt que
déclenché par le tout premier `saveProject()` — plus simple, sans conséquence pratique (l'utilisateur
voit la même invite navigateur, juste un peu plus tôt). Pas d'UI pour vider les caches ni afficher
l'espace occupé (`getCacheUsage`/`clearCaches` existent dans `db.ts` mais ne sont appelés par
aucun bouton) — reporté, hors du strict nécessaire pour les deux critères d'acceptation de docs/14.

---

## Migration de version

```ts
const MIGRATIONS: Record<number, (p: any) => any> = {
  1: (p) => p,
  // 2: (p) => ({ ...p, version: 2, /* transformation */ }),
};

function migrate(raw: any): Project {
  if (raw.format !== "pvproj") throw new ProjectError("FORMAT_UNKNOWN");
  if (raw.version > CURRENT_VERSION) throw new ProjectError("VERSION_TOO_RECENT");
  let p = raw;
  for (let v = raw.version; v < CURRENT_VERSION; v++) p = MIGRATIONS[v + 1](p);
  return p as Project;
}
```

Règles :

- une migration ne perd **jamais** de données ; les champs inconnus sont conservés dans `ext` ;
- chaque migration a un test unitaire avec un projet réel de la version précédente ;
- un fichier issu d'une version plus récente est **refusé explicitement**, jamais lu partiellement —
  lire à moitié un format inconnu produit des bugs bien pires qu'un refus clair.

**Implémenté à l'Étape 15/P13** (`src/project/migrate.ts`) : le pseudocode ci-dessus presque mot
pour mot. `MIGRATIONS` est vide aujourd'hui — `CURRENT_PROJECT_VERSION` vaut 1, la toute première
version du format, rien à migrer depuis. La première vraie entrée (et son test avec un projet réel)
attendra que le format évolue.

---

## Ce qui n'est pas dans le format (et pourquoi)

| Absent | Raison |
|---|---|
| Automation par images clés | V2 — l'ajouter maintenant complexifierait le format sans utilisateur pour l'exiger |
| Sorties multiples par projet | V2 — le champ `export` deviendra un tableau, migration triviale |
| Historique d'annulation | volatil, non persisté |
| Vignettes d'aperçu vidéo | recalculables |
| Position de lecture | volatile |

Le format est délibérément **petit**. Chaque champ ajouté est un champ à migrer pendant des années.
Ce qui peut être recalculé n'est pas stocké.
