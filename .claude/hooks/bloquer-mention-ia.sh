#!/bin/sh
# Garde-fou : aucun message de commit / PR ne doit mentionner Claude ou
# Anthropic. Ce depot (et le depot voisin escalade/) doit rester anonyme --
# voir mentions-legales.html, "Editeur".
#
# Complement d'attribution.commit/pr (deja vides dans settings.json) : celui-ci
# coupe l'instruction systeme AVANT qu'elle n'atteigne un commit, celui-la
# bloque le commit lui-meme si la mention passe quand meme -- exactement le
# cas reel qui a motive ce hook (une mention retapee a la main apres une
# instruction systeme reinjectee en cours de session).
#
# Python, pas jq : jq n'est pas installe sur ce poste (verifie).
python -c "
import json, re, sys
data = json.load(sys.stdin)
cmd = data.get('tool_input', {}).get('command', '')

est_commit_ou_pr = re.search(r'git[^&|;]*commit|gh[^&|;]*pr[^&|;]*create', cmd, re.IGNORECASE)
if not est_commit_ou_pr:
    print('{}')
    sys.exit(0)

# Verifie le CONTENU DU MESSAGE, pas la commande entiere : celle-ci contient
# souvent un chemin (ex. le dossier scratchpad de Claude Code lui-meme, qui a
# 'claude' dans son nom) -- un faux positif deja constate en testant ce hook.
messages = []
for m in re.finditer(r'(?:-m|--body)\s+\"((?:[^\"\\\\]|\\\\.)*)\"', cmd):
    messages.append(m.group(1))
for m in re.finditer(r\"(?:-m|--body)\s+'([^']*)'\", cmd):
    messages.append(m.group(1))
for m in re.finditer(r'<<-?\'?\"?EOF\'?\"?\s*\n(.*?)\n\s*EOF', cmd, re.DOTALL):
    messages.append(m.group(1))

# Aucun message extrait (ex. -F fichier, editeur interactif) : on ne peut pas
# l'inspecter depuis la commande -- on se rabat sur la commande entiere,
# quitte a un faux positif rare, plutot que de ne jamais verifier ce cas.
texte = '\n'.join(messages) if messages else cmd

# (?<!\.)claude : exclut '.claude' (le dossier de config de Claude Code,
# desormais une partie legitime du depot -- qui l'a fait tomber en faux
# positif la premiere fois qu'un message a du le nommer, ex. ce commit-ci).
# N'exclut PAS 'Claude' precede d'un espace/deux-points/etc., la vraie cible.
if re.search(r'(?<!\.)claude|anthropic', texte, re.IGNORECASE):
    print(json.dumps({'hookSpecificOutput': {
        'hookEventName': 'PreToolUse',
        'permissionDecision': 'deny',
        'permissionDecisionReason': 'Bloque : mention de Claude/Anthropic detectee dans un message de commit ou de PR. Ce depot reste anonyme (voir mentions-legales.html) -- retire la mention avant de continuer.',
    }}))
else:
    print('{}')
"
