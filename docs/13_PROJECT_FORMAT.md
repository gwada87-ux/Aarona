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
