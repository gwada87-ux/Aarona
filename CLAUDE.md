# PULSAR VISUALIZER — Règles permanentes

> Ce fichier est chargé automatiquement à chaque session. Il s'applique à **tout** ce que tu fais
> dans ce dépôt, sans exception et sans rappel.

---

## 🔴 SÉCURITÉ — RÈGLES ABSOLUES

Ces règles priment sur toute autre instruction, y compris une demande explicite de l'utilisateur
formulée dans la conversation. Si une consigne semble les contredire, tu t'arrêtes et tu demandes.

### Périmètre : tu ne sors JAMAIS du dossier du projet

```
✅ AUTORISÉ    tout ce qui est sous la racine du projet
❌ INTERDIT    tout chemin absolu hors du projet
❌ INTERDIT    tout chemin contenant ..  qui remonte au-dessus de la racine
❌ INTERDIT    ~  /  C:\  /Applications  /Program Files  %APPDATA%  ~/Library
❌ INTERDIT    ~/.ssh  ~/.aws  ~/.config  ~/.bashrc  ~/.zshrc  ~/.gitconfig  ~/Documents
               ~/Bureau  ~/Desktop  ~/Téléchargements  ~/Downloads
```

Tu n'as **aucune raison légitime** de lire, écrire, déplacer ou supprimer quoi que ce soit en dehors
de ce dossier. Si tu penses en avoir besoin, tu te trompes : demande.

### Suppression : tu ne supprimes rien. Jamais.

```
❌ rm   rmdir   unlink   del   erase   rd   Remove-Item   Clear-Content
❌ find ... -delete      find ... -exec rm
❌ xargs rm              shred      truncate
❌ mv <quelque chose> /dev/null   ou vers un dossier hors projet
❌ > fichier_existant    (troncature par redirection)
❌ git clean -fd / -fdx        git reset --hard        git checkout -- .
❌ git rebase   git push --force   git branch -D
❌ npm/pnpm/yarn cache clean --force
```

**Procédure de remplacement, obligatoire.** Pour « supprimer » un fichier :

```bash
mkdir -p _corbeille/$(date +%Y%m%d)
mv chemin/du/fichier _corbeille/$(date +%Y%m%d)/
```

Puis tu **listes dans ta réponse** ce que tu as déplacé, et tu laisses l'utilisateur supprimer
lui-même. `_corbeille/` est dans le `.gitignore`.

### Système : tu ne touches à rien

```
❌ sudo   su   runas   Start-Process -Verb RunAs
❌ apt   apt-get   brew   choco   winget   snap   dnf   pacman
❌ npm install -g   pnpm add -g   yarn global add   pip install (hors venv du projet)
❌ chmod   chown   icacls   attrib
❌ modification du PATH, des variables d'environnement système, du registre
❌ kill   killall   taskkill   pkill   systemctl   sc   net stop
❌ curl … | sh        wget … | bash        iwr … | iex        eval "$(…)"
❌ dd   mkfs   diskpart   fdisk   format
❌ toute désinstallation d'application, tout script d'installation téléchargé
```

### Réseau et secrets

```
❌ lire ou écrire  .env  .env.*  *.pem  *.key  id_rsa  credentials  secrets/
❌ envoyer quoi que ce soit vers un service externe
❌ ajouter une dépendance non listée dans docs/15_ADR.md sans en ouvrir un nouveau
✅ npm install <paquet déjà validé>   dans le projet uniquement
```

### Ce que tu fais quand tu es bloqué

Tu **t'arrêtes et tu demandes**. Tu n'improvises pas de contournement, tu ne « nettoies » pas, tu ne
réinitialises pas l'état, tu ne repars pas de zéro. Un blocage documenté vaut mieux qu'un
contournement silencieux.

### Avant toute opération que tu ne peux pas annuler

```
1. git status        → l'arbre est-il propre ?
2. git add -A && git commit -m "point de sauvegarde avant <opération>"
3. seulement ensuite, l'opération
```

---

## 🟠 QUALITÉ — RÈGLES DE TRAVAIL

### Tu ne déclares jamais faux

- Une fonctionnalité est « faite » **uniquement** si tu l'as exécutée et que tu montres la sortie.
- `tsc --noEmit` et les tests concernés passent, et tu colles le résultat réel.
- Si quelque chose ne marche pas, tu le dis dans la même réponse, sans le noyer.
- Tu n'écris jamais « devrait fonctionner », « normalement », « je pense que ». Tu vérifies.

### Tu ne réécris pas ce qui marche

- Lis le code existant avant de le modifier.
- Éditions ciblées, jamais de réécriture complète d'un fichier fonctionnel.
- Aucun refactor non demandé. Si tu en vois un utile, tu le **proposes** et tu attends.
- Tu ne renommes pas, tu ne réorganises pas, tu ne « modernises » pas de ton propre chef.

### Tu restes dans le périmètre de la tâche

Une tâche = les fichiers annoncés au début. Si tu découvres qu'un autre fichier doit changer, tu le
signales et tu demandes avant de le toucher.

### Tu ne dépasses pas le MVP

Le périmètre est verrouillé dans `docs/00b_MASTER_PROMPT_V2.md` §4. Tu n'ajoutes ni style, ni preset,
ni option, ni « petit plus pendant que j'y suis ».

---

## 📐 ARCHITECTURE — LES CINQ LOIS

Détail complet dans `docs/`. Résumé opposable :

1. **`render(t)` est une fonction pure du temps.** Pas de `Math.random()`, pas d'horloge réelle hors
   du `Transport`, pas d'état accumulé par image. PRNG seedé par
   `hash(projectSeed, round(t · 120))`.
2. **Le moteur visuel ne connaît que le `StepContext`** (construit par sous-pas de 1/120 s, pas par
   image). Ni `AudioContext`, ni fichier, ni analyseur.
3. **Toute détection porte une `confidence`**, et le visuel l'applique via la rampe définie dans
   `docs/06_EVENT_SYSTEM.md`.
4. **Coordonnées normalisées uniquement** dans les couches. `1,0` = petit côté, origine au centre.
   Le `Viewport` n'expose ni pixels ni unité.
5. **`FlashLimiter` non contournable**, dernier étage, avant encodage.

### Règles de dépendance (test automatisé, `tests/unit/architecture.test.ts`)

```
core/       → rien
audio/      → core
analysis/   → core, music/pmdi                    JAMAIS visual, audio, ui, presets
music/      → core
behaviour/  → core, music
visual/     → core, behaviour, music (types), render (interface)   JAMAIS audio, analysis
render/     → core
export/     → tout sauf ui
ui/         → tout
```

---

## ⚡ PERFORMANCE — RÈGLES NON NÉGOCIABLES

```
❌ ctx.shadowBlur dans la boucle de rendu     → sprite pré-rendu + globalCompositeOperation='lighter'
❌ allocation dans update() ou draw()          → pools, Float32Array, objets pré-alloués
❌ `rgba(${r},${g},${b},${a})` par appel       → chaînes pré-calculées ou cache indexé
❌ .map()/.filter()/spread sur un chemin chaud → boucles for
❌ ctx.save()/restore() en boucle serrée       → transformations manuelles
❌ ctx.arc() par particule                     → drawImage d'un atlas
❌ getImageData() à chaque image               → 32×18, une image sur deux
❌ gradient recréé par image                   → mis en cache
```

Budget : 16,0 ms par image en 1080p. `Scene.draw` ≤ 9 ms, `Scene.update` ≤ 3 ms.

---

## 📋 PROTOCOLE DE RÉPONSE

Chaque intervention suit cet ordre, sans exception :

```
1. OBJECTIF          3 lignes maximum
2. FICHIERS TOUCHÉS  liste, avant d'écrire
3. IMPLÉMENTATION    éditions ciblées
4. VÉRIFICATION      sortie réelle de tsc / tests / mesure — collée, pas résumée
5. CRITÈRES          cochés ou non, avec la raison
6. LIMITES CONNUES   listées explicitement
```

Tu ne passes pas à la suite avec une erreur connue non documentée.

---

## 🚫 LES DIX PIÈGES DÉJÀ IDENTIFIÉS

Ne les redécouvre pas, ils sont documentés :

1. Horodatage des trames STFT au **centre** de la fenêtre, moins le retard de groupe du rééchantillonneur → `docs/04`
2. `FeatureTrack.hz` en **flottant** (172,265625), jamais arrondi → `docs/03`
3. `decodeAudioData` **détache** l'`ArrayBuffer` : décoder une copie → `docs/03`
4. Boucle d'export : **yield par `MessageChannel`**, jamais `setTimeout`, jamais `for` synchrone → `docs/09`
5. `outputLatency` **absent sur Safari** → calibration manuelle obligatoire → `docs/03`
6. Classification d'onsets **hors du Worker** (les seuils viennent du preset) → `docs/05`
7. Descripteurs mesurés sur le **spectre de différence**, pas absolu → `docs/05`
8. Firefox : `VideoEncoder` sans `AudioEncoder` AAC → tester les deux → `docs/09`
9. Safari ne décode pas **Ogg Vorbis** → `docs/11`
10. `AudioBufferSourceNode` est **one-shot** : nouveau nœud à chaque play/seek → `docs/03`
