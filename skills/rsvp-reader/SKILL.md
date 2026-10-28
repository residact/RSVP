---
name: rsvp-reader
description: Envoie un texte, ou la dernière réponse de l'assistant, au lecteur RSVP auto-hébergé de l'utilisateur pour le lire mot par mot, et consulte sa bibliothèque de livres. À utiliser quand l'utilisateur demande de lire quelque chose en RSVP, de lire vite, d'envoyer un texte au lecteur ("lis ça en RSVP", "envoie ça sur mon lecteur", "speed read this").
---

# Lecteur RSVP

L'utilisateur héberge un lecteur RSVP (affichage d'un mot à la fois). Ce skill y envoie un texte : le lecteur
s'ouvre tout seul sur ses appareils, sans copier-coller.

## Envoyer un texte

1. **Si un outil MCP `rsvp_send` est disponible**, utilise-le : `text` (obligatoire), `title` et `wpm` (facultatifs).
2. **Sinon**, utilise le script de ce skill, depuis le dossier du skill (celui qui contient ce fichier) :

   ```bash
   bun scripts/send.ts --title "Titre court" <<'RSVP_EOF'
   Le texte complet à lire, en markdown si besoin.
   RSVP_EOF
   ```

   Options : `--file chemin.md` pour lire un fichier, `--wpm 400` pour fixer la vitesse, `--json` pour une sortie JSON.
   Sans `bun`, envoie la même requête avec `curl` (voir plus bas).

3. Réponds à l'utilisateur en une phrase : titre, nombre de mots, et le lien affiché par le script.

### Règles

- Envoie le texte **complet**, tel que l'utilisateur doit le lire. Ne le résume pas, sauf s'il le demande.
- Le markdown est accepté (titres, listes, gras, tableaux, code). Les blocs de code sont lus comme « [code] » :
  n'envoie pas de longs blocs de code au lecteur.
- Pour « lis ta dernière réponse », envoie le texte de ta réponse précédente, sans les appels d'outils.
- Si l'utilisateur donne une vitesse (« à 450 mots par minute »), passe-la avec `--wpm` / `wpm`.

## Bibliothèque de livres

Le lecteur a une bibliothèque (EPUB, PDF, MOBI, TXT, Markdown) avec reprise de lecture. L'outil MCP `rsvp_books`
liste les livres et leur progression. L'import de fichiers se fait dans l'interface web (page « Livres »).

## Configuration et dépannage

Le script lit `RSVP_URL` et `RSVP_TOKEN` dans l'environnement, sinon `~/.config/rsvp-reader/config.json`
(`{"url": "http://localhost:8787", "token": "..."}`), créé par `bun skills/install.ts`.

- `401` : le jeton ne correspond plus à `RSVP_TOKEN` du fichier `.env` du serveur. Relancer l'installation du skill.
- « fetch failed » / connexion refusée : le conteneur ne tourne pas (`docker compose up -d` dans le dépôt RSVP).

Équivalent `curl` :

```bash
curl -sS -X POST "$RSVP_URL/api/texts" \
  -H "Authorization: Bearer $RSVP_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Titre","text":"Texte à lire"}'
```
