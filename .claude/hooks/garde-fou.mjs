#!/usr/bin/env node
/**
 * GARDE-FOU PULSAR VISUALIZER — hook PreToolUse sur l'outil Bash.
 *
 * Deuxième ligne de défense, MÉCANIQUE, derrière les règles `deny` de settings.json.
 * Elle existe parce que les règles `deny` raisonnent sur des préfixes de commande et
 * peuvent être contournées par une composition (`a && rm -rf b`), une substitution
 * (`$(echo rm) -rf`) ou un alias. Ce hook, lui, inspecte la chaîne complète.
 *
 * Contrat du hook :
 *   - reçoit sur stdin un JSON  { tool_name, tool_input: { command, ... }, cwd, ... }
 *   - exit 0            → laisse le flux de permission normal se dérouler
 *   - exit 2 + stderr   → BLOQUE la commande, stderr est renvoyé au modèle
 *
 * Installation :
 *   .claude/hooks/garde-fou.mjs  (ce fichier)
 *   référencé depuis .claude/settings.json → hooks.PreToolUse
 *
 * Test manuel :
 *   echo '{"tool_input":{"command":"rm -rf /"}}' | node .claude/hooks/garde-fou.mjs; echo "exit=$?"
 *   → doit afficher un refus et exit=2
 */

const RACINE = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Motifs interdits. Chaque entrée : [regex, raison]. */
const INTERDITS = [
  // --- suppression ---
  [/(^|[;&|(`]\s*|\s)(rm|rmdir|unlink|shred|srm)\s/i,
    "suppression de fichiers (rm/rmdir/unlink/shred)"],
  [/(^|[;&|(`]\s*|\s)(del|erase|rd)\s+\/[sqf]/i,
    "suppression Windows (del/rd)"],
  [/Remove-Item|Clear-Content/i,
    "suppression PowerShell"],
  [/-delete\b/,
    "find -delete"],
  [/-exec\s+rm\b/,
    "find -exec rm"],
  [/\|\s*xargs\s+(-\S+\s+)*rm\b/,
    "xargs rm"],
  [/(^|\s)truncate\s+-s\s*0/i,
    "truncate -s 0"],

  // --- élévation de privilèges ---
  [/(^|[;&|(`]\s*|\s)(sudo|doas|su)\s/i,
    "élévation de privilèges"],
  [/Start-Process[^\n]*-Verb\s+RunAs/i,
    "élévation Windows"],

  // --- gestionnaires de paquets système / installations globales ---
  [/(^|[;&|(`]\s*|\s)(apt|apt-get|brew|choco|winget|snap|dnf|yum|pacman|port)\s/i,
    "gestionnaire de paquets système"],
  [/(npm|pnpm|yarn|bun)\s+(install|i|add|uninstall|remove|rm)\b[^\n]*(\s-g\b|\s--global\b)/i,
    "installation ou désinstallation globale"],
  [/(npm|pnpm|yarn|bun)\s+(uninstall|remove)\b/i,
    "désinstallation de dépendance (passe par l'utilisateur)"],
  [/(npm|pnpm|yarn|bun)\s+cache\s+clean/i,
    "purge de cache du gestionnaire de paquets"],
  [/pip\s+(install|uninstall)/i,
    "pip hors venv du projet"],

  // --- destruction d'historique git ---
  [/git\s+clean\b/i, "git clean"],
  [/git\s+reset\s+--hard/i, "git reset --hard"],
  [/git\s+checkout\s+--\s/i, "git checkout -- (écrase les modifications)"],
  [/git\s+push\s+(--force|-f)\b/i, "git push --force"],
  [/git\s+branch\s+-D\b/i, "git branch -D"],
  [/git\s+(rebase|filter-branch|reflog\s+expire)/i, "réécriture d'historique git"],

  // --- exécution de code téléchargé ---
  [/(curl|wget|iwr|Invoke-WebRequest)[^\n]*\|\s*(ba)?sh/i,
    "téléchargement piped vers un shell"],
  [/(curl|wget)[^\n]*\|\s*(node|python3?|perl|ruby)/i,
    "téléchargement piped vers un interpréteur"],
  [/\|\s*iex\b/i, "pipe vers Invoke-Expression"],
  [/(^|\s)eval\s/i, "eval"],

  // --- système de fichiers bas niveau ---
  [/(^|\s)(dd|mkfs|diskpart|fdisk|format|parted)\s/i,
    "opération disque bas niveau"],
  [/(^|\s)(chmod|chown|icacls|attrib)\s/i,
    "modification de permissions"],

  // --- processus et services ---
  [/(^|[;&|(`]\s*|\s)(kill|killall|pkill|taskkill)\s/i,
    "arrêt de processus"],
  [/(^|\s)(systemctl|launchctl|service|net\s+stop|sc\s+stop)\s/i,
    "gestion de services système"],

  // --- registre et environnement ---
  [/(^|\s)(reg|regedit|setx)\s/i, "modification du registre / de l'environnement"],
  [/export\s+PATH=/i, "modification du PATH"],

  // --- secrets ---
  [/\.env\b|id_rsa|\.pem\b|credentials|\.ssh\//i,
    "accès à des secrets"],
];

/** Chemins hors projet — bloqués quel que soit le verbe. */
const HORS_PROJET = [
  [/(^|\s)\/(?!tmp\/|dev\/null)[A-Za-z]/, "chemin absolu Unix hors projet"],
  [/(^|\s)~\//, "chemin dans le répertoire personnel (~)"],
  [/[A-Za-z]:\\/, "chemin absolu Windows"],
  [/%(APPDATA|USERPROFILE|PROGRAMFILES|SYSTEMROOT|WINDIR)%/i, "variable système Windows"],
  [/\$(HOME|USERPROFILE)\b/, "variable $HOME"],
  [/\/Applications\/|\/Program Files|\/System\/|\/Library\//i, "dossier d'applications système"],
  [/(\.\.\/){3,}/, "remontée de répertoires suspecte"],
];

function refuser(raison, detail) {
  process.stderr.write(
    `\n⛔ GARDE-FOU PULSAR — COMMANDE BLOQUÉE\n\n` +
    `   Motif   : ${raison}\n` +
    `   Détail  : ${detail}\n\n` +
    `   Cette catégorie de commande est interdite par CLAUDE.md.\n` +
    `   NE CONTOURNE PAS. N'essaie pas une autre formulation.\n\n` +
    `   Pour « supprimer » un fichier, la procédure est :\n` +
    `       mkdir -p _corbeille && mv <fichier> _corbeille/\n` +
    `   puis signale à l'utilisateur ce que tu as déplacé.\n\n` +
    `   Pour toute autre opération de cette liste : ARRÊTE-TOI et demande.\n`
  );
  process.exit(2);
}

let brut = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (brut += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(brut || "{}")?.tool_input?.command ?? "";
  } catch {
    process.exit(0); // entrée illisible : on ne bloque pas, le flux normal reprend
  }
  if (!cmd) process.exit(0);

  // On travaille sur la commande brute ET sur une version sans guillemets,
  // pour attraper les tentatives d'obfuscation par citation partielle.
  const variantes = [cmd, cmd.replace(/['"`\\]/g, "")];

  for (const [re, raison] of INTERDITS) {
    for (const v of variantes) {
      if (re.test(v)) refuser(raison, cmd.slice(0, 200));
    }
  }
  for (const [re, raison] of HORS_PROJET) {
    for (const v of variantes) {
      if (re.test(v)) refuser(`${raison} — hors de ${RACINE}`, cmd.slice(0, 200));
    }
  }

  process.exit(0);
});
