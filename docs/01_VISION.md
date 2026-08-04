# 01 — VISION

## Le produit en une phrase

**PULSAR VISUALIZER transforme un morceau en vidéo musicale synchronisée, en local, dans le
navigateur, en moins de deux minutes.**

## Le problème réel

Un beatmaker qui publie sur YouTube, TikTok ou Instagram a besoin d'une vidéo. Aujourd'hui il a trois
options, toutes mauvaises :

| Option | Problème |
|---|---|
| Image fixe + waveform | générique, indifférenciable des 10 000 autres beats du jour |
| After Effects | 2 à 6 heures par morceau, compétence rare, licence mensuelle |
| Visualizers en ligne | rendu daté, watermark, upload obligatoire, synchronisation approximative |

La synchronisation est le point où tous échouent. Un visualizer qui « bouge avec le son » est
immédiatement perçu comme amateur. Un visualizer qui frappe **exactement** sur le kick est perçu
comme professionnel, même avec des formes simples. **La synchronisation est le produit ; les formes
sont l'habillage.**

## Le positionnement

| Axe | Notre position |
|---|---|
| Traitement | 100 % local, aucun upload, aucun compte requis pour produire |
| Vitesse | import → export en moins de 2 minutes |
| Qualité de sync | événements horodatés avec confiance, pas une réaction FFT |
| Identité visuelle | peu de styles, chacun avec une véritable signature |
| Extension | passerelle native vers PULSAR (données musicales exactes) |

## L'avantage décisif à moyen terme

Tout concurrent partant d'un MP3 est limité par la même barrière : **on ne peut pas retrouver
parfaitement une partition depuis un mixdown masterisé.** Les meilleurs algorithmes plafonnent
autour de 90 % sur les beats et échouent sur les notes.

PULSAR, lui, **compose** la musique. Il connaît la grille au sample près, chaque hit, chaque note,
chaque section, avant même que le son n'existe. Quand les deux produits se rejoignent, PULSAR
VISUALIZER ne fera plus d'estimation : il recevra la vérité.

C'est pourquoi l'architecture est conçue **Mode B d'abord** : le contrat de données (PMDI) est
dimensionné pour l'information exacte, et l'analyse audio du Mode A n'est qu'un *estimateur* qui
remplit ce même contrat avec des confiances inférieures à 1. Quand le Mode B arrivera, **aucune
ligne du moteur visuel ne changera**.

```
Mode A  →  estimation  →  ┐
                          ├─→  PMDI  →  MusicTimeline  →  moteur visuel (inchangé)
Mode B  →  vérité      →  ┘
```

## Les trois utilisateurs cibles

1. **Le beatmaker qui publie** (cœur de cible) — veut une vidéo propre en 2 minutes, sans apprendre
   un outil. Mode Simple, presets par genre, export vertical.
2. **L'artiste qui sort un single** — veut une identité visuelle cohérente sur toute une sortie.
   Mode Avancé, palettes, projets réutilisables.
3. **Le VJ / créateur de contenu** — veut du contrôle, des sorties multi-formats, de la répétabilité.
   Presets exportables, projets versionnés, futur mode live.

## Ce que le produit n'est pas

- Pas un éditeur vidéo. Pas de montage, pas de pistes multiples, pas de transitions manuelles.
- Pas un outil de motion design. On ne dessine pas image par image.
- Pas une plateforme sociale. Pas de compte, pas de galerie, pas de cloud au MVP.
- Pas un outil temps réel de scène (V3 au plus tôt).

## Critères de réussite du MVP

- Un beatmaker qui n'a jamais vu l'outil produit une vidéo publiable en **moins de 3 minutes**,
  sans aide.
- Le rendu est jugé « pro » par des producteurs sur une comparaison à l'aveugle.
- La synchronisation ne se voit pas — ce qui, ici, est le plus grand compliment possible.
- Zéro upload, zéro dépendance serveur pour produire.
- Le code permet de brancher PULSAR sans toucher au moteur visuel.
